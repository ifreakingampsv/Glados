import {
  db,
  type EventLog,
  type QuizQuestion,
  type QuizSession,
  type Skill,
  type UserSkill,
} from "@/lib/db";
import { appendEvent } from "@/services/events";
import {
  clampQuizDeltaForSkill,
  getConfig,
  getReferencedSkillIds,
} from "@/services/levels";
import {
  assertCanonicalLeafSkill,
  ensureQuizBanksForSkill,
  normalizeQuizBand,
  QUIZ_BANDS,
  type QuizBand,
} from "@/services/quiz-banks";
import {
  DEFAULT_QUIZ_BANDS,
  DEFAULT_QUIZ_SCORING,
  DEFAULT_TELEMETRY_ALERT_THRESHOLD,
} from "@/services/seed-config";

const DAY_MS = 86_400_000;

export interface QuizQuestionClientView {
  id: string;
  prompt: string;
  options: string[];
  band: QuizBand;
  tags: string[];
}

export interface StartBandPlacement {
  band: QuizBand;
  claimedLevel: number | null;
  evidencedLevel: number;
  reason: string;
}

export interface QuizCooldownStatus {
  onCooldown: boolean;
  nextRetakeAt: Date | null;
  lastCompletedAt: Date | null;
}

export interface StartQuizSessionResult {
  session: QuizSession;
  skill: Skill;
  startBand: QuizBand;
  startReason: string;
  currentBand: QuizBand;
  roundNumber: number;
  roundSize: number;
  cap: number;
  currentRoundQuestions: QuizQuestionClientView[];
}

export interface RoundAnswerInput {
  questionId: string;
  selectedIndex: number;
  ms?: number;
}

export type SubmitQuizRoundResult =
  | {
      status: "continue";
      session: QuizSession;
      previousBand: QuizBand;
      previousRoundCorrect: number;
      currentBand: QuizBand;
      stepDirection: "up" | "down";
      roundNumber: number;
      currentRoundQuestions: QuizQuestionClientView[];
    }
  | {
      status: "completed";
      session: QuizSession;
      settledBand: QuizBand;
      roundCorrect: number;
      roundTotal: number;
      rawPoints: number;
      previousRawPoints: number;
      rawDelta: number;
      pointsDelta: number;
      perBand: Record<QuizBand, { correct: number; total: number }>;
      event: EventLog;
      userSkill: UserSkill;
    };

function toClientQuestion(
  q: QuizQuestion,
  band: QuizBand
): QuizQuestionClientView {
  const options = Array.isArray(q.options)
    ? (q.options as unknown[]).map(String)
    : [];
  return {
    id: q.id,
    prompt: q.prompt,
    options,
    band,
    tags: q.tags,
  };
}

export async function levelToQuizBand(level: number): Promise<QuizBand> {
  const bandsConfig = await getConfig<
    Array<{ band: string; minLevel: number; maxLevel: number }>
  >("quiz.bands", DEFAULT_QUIZ_BANDS);

  for (const entry of bandsConfig) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.minLevel === "number" &&
      typeof entry.maxLevel === "number"
    ) {
      if (level >= entry.minLevel && level <= entry.maxLevel) {
        return normalizeQuizBand(entry.band);
      }
    }
  }

  if (level >= 4) return "L4-5";
  if (level >= 2) return "L2-3";
  return "L0-1";
}

export async function resolveStartBandForUserSkill(
  userId: string,
  skillId: string
): Promise<StartBandPlacement> {
  const skill = await assertCanonicalLeafSkill(skillId);
  const userSkill = await db.userSkill.findUnique({
    where: { userId_skillId: { userId, skillId: skill.id } },
  });

  const claimedLevel = userSkill?.claimedLevel ?? null;
  const evidencedLevel = userSkill?.level ?? 0;
  const higherLevel = Math.max(claimedLevel ?? 0, evidencedLevel);
  const band = await levelToQuizBand(higherLevel);

  let reason: string;
  if ((claimedLevel ?? 0) === 0 && evidencedLevel === 0) {
    reason = `Starting in ${band} (default entry band when no prior claim or evidenced level exists).`;
  } else if ((claimedLevel ?? 0) > evidencedLevel) {
    reason = `Starting in ${band} based on your claimed Level ${claimedLevel} (placement hint only; claims never enter your score).`;
  } else {
    reason = `Starting in ${band} based on your current evidenced Level ${evidencedLevel}.`;
  }

  return {
    band,
    claimedLevel,
    evidencedLevel,
    reason,
  };
}

export async function getQuizCooldownStatus(
  userId: string,
  skillId: string,
  now: Date = new Date()
): Promise<QuizCooldownStatus> {
  const skill = await assertCanonicalLeafSkill(skillId);
  const cooldownDays = await getConfig<number>("quiz.cooldownDays", 7);

  const lastCompleted = await db.quizSession.findFirst({
    where: {
      userId,
      skillId: skill.id,
      outcome: "completed",
      endedAt: { not: null },
    },
    orderBy: { endedAt: "desc" },
  });

  if (!lastCompleted || !lastCompleted.endedAt) {
    return {
      onCooldown: false,
      nextRetakeAt: null,
      lastCompletedAt: null,
    };
  }

  const nextRetakeAt = new Date(
    lastCompleted.endedAt.getTime() + cooldownDays * DAY_MS
  );
  const onCooldown = now.getTime() < nextRetakeAt.getTime();

  return {
    onCooldown,
    nextRetakeAt: onCooldown ? nextRetakeAt : null,
    lastCompletedAt: lastCompleted.endedAt,
  };
}

async function getPreviousRawQuizPoints(
  userId: string,
  skillId: string
): Promise<number> {
  const referencedIds = await getReferencedSkillIds(skillId);
  const priorQuizEvents = await db.eventLog.findMany({
    where: {
      userId,
      type: "quiz_completed",
      skills: { hasSome: referencedIds },
    },
    orderBy: { occurredAt: "desc" },
  });

  if (priorQuizEvents.length === 0) {
    return 0;
  }

  const latest = priorQuizEvents[0];
  if (
    latest.payload &&
    typeof latest.payload === "object" &&
    !Array.isArray(latest.payload)
  ) {
    const payloadObj = latest.payload as Record<string, unknown>;
    if (typeof payloadObj.rawPoints === "number") {
      return payloadObj.rawPoints;
    }
  }

  // Fallback if prior quiz event was written directly via appendEvent in a test
  return Math.max(
    0,
    priorQuizEvents.reduce((sum, ev) => sum + ev.points, 0)
  );
}

async function checkAndFlagBrokenQuestions(
  questionIds: string[]
): Promise<void> {
  if (questionIds.length === 0) return;
  const alertCfg = await getConfig<{
    minAnswers?: number;
    maxSuccessRate?: number;
  }>("telemetry.alertThreshold", DEFAULT_TELEMETRY_ALERT_THRESHOLD);
  const minAnswers =
    alertCfg.minAnswers ?? DEFAULT_TELEMETRY_ALERT_THRESHOLD.minAnswers;
  const maxSuccessRate =
    alertCfg.maxSuccessRate ?? DEFAULT_TELEMETRY_ALERT_THRESHOLD.maxSuccessRate;

  const uniqueIds = Array.from(new Set(questionIds));
  for (const questionId of uniqueIds) {
    const [total, correctCount] = await Promise.all([
      db.quizAnswer.count({ where: { questionId } }),
      db.quizAnswer.count({ where: { questionId, correct: true } }),
    ]);
    if (total >= minAnswers) {
      const rate = correctCount / total;
      if (rate < maxSuccessRate) {
        const q = await db.quizQuestion.findUnique({
          where: { id: questionId },
        });
        if (q && !q.tags.includes("alert:broken")) {
          await db.quizQuestion.update({
            where: { id: questionId },
            data: { tags: [...q.tags, "alert:broken"] },
          });
        }
      }
    }
  }
}

export async function startQuizSession(
  input: {
    userId: string;
    skillId: string;
    now?: Date;
  },
  fetchImpl: typeof fetch = fetch
): Promise<StartQuizSessionResult> {
  const now = input.now ?? new Date();
  const skill = await assertCanonicalLeafSkill(input.skillId);

  const cooldown = await getQuizCooldownStatus(input.userId, skill.id, now);
  if (cooldown.onCooldown && cooldown.nextRetakeAt) {
    throw new Error(
      `Quiz cooldown active for ${skill.display}. Next retake available on ${cooldown.nextRetakeAt.toISOString()}`
    );
  }

  const [banks, placement, roundSize, cap] = await Promise.all([
    ensureQuizBanksForSkill(skill.id, input.userId, fetchImpl),
    resolveStartBandForUserSkill(input.userId, skill.id),
    getConfig<number>("quiz.roundSize", 6),
    getConfig<number>("quiz.cap", 18),
  ]);

  const startBank = banks.find(
    (b) => normalizeQuizBand(b.band) === placement.band && b.status === "live"
  );
  if (!startBank || startBank.questions.length < roundSize) {
    throw new Error(
      `Quiz bank for ${skill.display} (${placement.band}) is not live yet (awaiting admin review)`
    );
  }

  const roundQuestions = startBank.questions
    .slice(0, roundSize)
    .map((q) => toClientQuestion(q, placement.band));

  const session = await db.quizSession.create({
    data: {
      userId: input.userId,
      skillId: skill.id,
      bankVersion: startBank.version,
      bandStart: placement.band,
      startedAt: now,
      outcome: "in_progress",
      questionsAsked: 0,
      correctCount: 0,
    },
  });

  return {
    session,
    skill,
    startBand: placement.band,
    startReason: placement.reason,
    currentBand: placement.band,
    roundNumber: 1,
    roundSize,
    cap,
    currentRoundQuestions: roundQuestions,
  };
}

export async function submitQuizRound(input: {
  sessionId: string;
  userId: string;
  answers: RoundAnswerInput[];
  now?: Date;
}): Promise<SubmitQuizRoundResult> {
  const now = input.now ?? new Date();
  const session = await db.quizSession.findFirst({
    where: { id: input.sessionId, userId: input.userId },
    include: {
      answers: { orderBy: { position: "asc" } },
    },
  });
  if (!session) {
    throw new Error("Quiz session not found");
  }
  if (session.outcome !== "in_progress") {
    throw new Error(`Quiz session is already ${session.outcome}`);
  }

  const [roundSize, cap, stepUp, stepDown, scoringConfig] = await Promise.all([
    getConfig<number>("quiz.roundSize", 6),
    getConfig<number>("quiz.cap", 18),
    getConfig<number>("quiz.stepUp", 5),
    getConfig<number>("quiz.stepDown", 2),
    getConfig<Record<string, number>>("quiz.scoring", DEFAULT_QUIZ_SCORING),
  ]);

  if (input.answers.length !== roundSize) {
    throw new Error(
      `Expected ${roundSize} answers for a complete round, received ${input.answers.length}`
    );
  }

  const questionIds = input.answers.map((a) => a.questionId);
  const dbQuestions = await db.quizQuestion.findMany({
    where: { id: { in: questionIds } },
    include: { bank: true },
  });
  const questionById = new Map(dbQuestions.map((q) => [q.id, q]));

  let roundCorrect = 0;
  let currentBand: QuizBand = normalizeQuizBand(session.bandStart);
  const startPosition = session.answers.length + 1;

  const createdAnswerRows: Array<{
    questionId: string;
    band: QuizBand;
    correct: boolean;
    ms: number;
    position: number;
  }> = [];

  input.answers.forEach((ans, idx) => {
    const q = questionById.get(ans.questionId);
    if (!q) {
      throw new Error(`Question ${ans.questionId} not found in quiz bank`);
    }
    const band = normalizeQuizBand(q.bank.band);
    currentBand = band;
    const isCorrect = ans.selectedIndex === q.correctIndex;
    if (isCorrect) roundCorrect += 1;
    createdAnswerRows.push({
      questionId: q.id,
      band,
      correct: isCorrect,
      ms: Math.max(0, Math.round(ans.ms ?? 5000)),
      position: startPosition + idx,
    });
  });

  await db.quizAnswer.createMany({
    data: createdAnswerRows.map((row) => ({
      sessionId: session.id,
      questionId: row.questionId,
      band: row.band,
      correct: row.correct,
      ms: row.ms,
      position: row.position,
    })),
  });

  await checkAndFlagBrokenQuestions(questionIds);

  const newQuestionsAsked = session.questionsAsked + createdAnswerRows.length;
  const newCorrectCount = session.correctCount + roundCorrect;

  // Determine staircase transition
  const bandIdx = QUIZ_BANDS.indexOf(currentBand);
  let nextBand: QuizBand = currentBand;
  let shouldSettle = false;
  let stepDirection: "up" | "down" | null = null;

  if (roundCorrect >= stepUp) {
    if (bandIdx < QUIZ_BANDS.length - 1) {
      nextBand = QUIZ_BANDS[bandIdx + 1];
      stepDirection = "up";
    } else {
      // Already at highest band L4-5 and scored >= stepUp -> settle at L4-5
      shouldSettle = true;
    }
  } else if (roundCorrect <= stepDown) {
    if (bandIdx > 0) {
      nextBand = QUIZ_BANDS[bandIdx - 1];
      stepDirection = "down";
    } else {
      // Already at lowest band L0-1 and scored <= stepDown -> settle at L0-1
      shouldSettle = true;
    }
  } else {
    shouldSettle = true;
  }

  // Enforce hard cap (18 questions)
  if (newQuestionsAsked >= cap) {
    shouldSettle = true;
  }

  if (!shouldSettle && stepDirection) {
    // Try to draw next round from nextBand
    const nextBank = await db.quizBank.findFirst({
      where: {
        skillId: session.skillId,
        band: nextBand,
        status: "live",
      },
      orderBy: { version: "desc" },
      include: { questions: true },
    });

    const alreadyAskedIds = new Set([
      ...session.answers.map((a) => a.questionId),
      ...createdAnswerRows.map((a) => a.questionId),
    ]);
    const availableQuestions = (nextBank?.questions ?? []).filter(
      (q) => !alreadyAskedIds.has(q.id)
    );

    if (availableQuestions.length >= roundSize) {
      const updatedSession = await db.quizSession.update({
        where: { id: session.id },
        data: {
          questionsAsked: newQuestionsAsked,
          correctCount: newCorrectCount,
        },
      });
      const roundNumber = Math.floor(newQuestionsAsked / roundSize) + 1;
      return {
        status: "continue",
        session: updatedSession,
        previousBand: currentBand,
        previousRoundCorrect: roundCorrect,
        currentBand: nextBand,
        stepDirection,
        roundNumber,
        currentRoundQuestions: availableQuestions
          .slice(0, roundSize)
          .map((q) => toClientQuestion(q, nextBand)),
      };
    }
    // If nextBand lacks enough unasked questions, settle cleanly
    shouldSettle = true;
  }

  const settledBand: QuizBand =
    stepDirection === "down" ? nextBand : currentBand;

  const allAnswers = [
    ...session.answers.map((a) => ({
      band: normalizeQuizBand(a.band),
      correct: a.correct,
    })),
    ...createdAnswerRows.map((a) => ({
      band: a.band,
      correct: a.correct,
    })),
  ];

  const perBand: Record<QuizBand, { correct: number; total: number }> = {
    "L0-1": { correct: 0, total: 0 },
    "L2-3": { correct: 0, total: 0 },
    "L4-5": { correct: 0, total: 0 },
  };

  let rawPoints = 0;
  for (const ans of allAnswers) {
    perBand[ans.band].total += 1;
    if (ans.correct) {
      perBand[ans.band].correct += 1;
      const weight =
        scoringConfig[ans.band] ?? DEFAULT_QUIZ_SCORING[ans.band] ?? 1;
      rawPoints += weight;
    }
  }
  rawPoints = Math.round(rawPoints);

  const previousRawPoints = await getPreviousRawQuizPoints(
    input.userId,
    session.skillId
  );
  const rawDelta = Math.round(rawPoints - previousRawPoints);
  const pointsDelta = await clampQuizDeltaForSkill(
    input.userId,
    session.skillId,
    rawDelta,
    now
  );

  const completedSession = await db.quizSession.update({
    where: { id: session.id },
    data: {
      bandSettled: settledBand,
      endedAt: now,
      outcome: "completed",
      questionsAsked: newQuestionsAsked,
      correctCount: newCorrectCount,
    },
  });

  const event = await appendEvent({
    userId: input.userId,
    source: "web",
    type: "quiz_completed",
    skills: [session.skillId],
    occurredAt: now,
    now,
    pointsOverride: pointsDelta,
    payload: {
      settledBand,
      perBand,
      sessionId: completedSession.id,
      bankVersion: completedSession.bankVersion,
      rawPoints,
      previousRawPoints,
      rawDelta,
      pointsDelta,
    },
  });

  const userSkill = await db.userSkill.findUniqueOrThrow({
    where: {
      userId_skillId: {
        userId: input.userId,
        skillId: session.skillId,
      },
    },
  });

  return {
    status: "completed",
    session: completedSession,
    settledBand,
    roundCorrect,
    roundTotal: roundSize,
    rawPoints,
    previousRawPoints,
    rawDelta,
    pointsDelta,
    perBand,
    event,
    userSkill,
  };
}

export async function abandonQuizSession(input: {
  sessionId: string;
  userId: string;
  partialAnswers?: RoundAnswerInput[];
  now?: Date;
}): Promise<{
  outcome: "abandoned";
  recorded: boolean;
  questionsAnswered: number;
}> {
  const now = input.now ?? new Date();
  const session = await db.quizSession.findFirst({
    where: { id: input.sessionId, userId: input.userId },
    include: { answers: true },
  });
  if (!session) {
    throw new Error("Quiz session not found");
  }
  if (session.outcome !== "in_progress") {
    return {
      outcome: "abandoned",
      recorded: session.outcome === "abandoned",
      questionsAnswered: session.questionsAsked,
    };
  }

  const abandonThreshold = await getConfig<number>("quiz.abandonThreshold", 3);
  const partialCount = input.partialAnswers?.length ?? 0;
  const totalAnswered = session.answers.length + partialCount;

  // D76b: Abandoned sessions (< half the first round answered) write NOTHING
  // and consume no cooldown.
  if (totalAnswered < abandonThreshold) {
    await db.quizSession.delete({ where: { id: session.id } });
    return {
      outcome: "abandoned",
      recorded: false,
      questionsAnswered: totalAnswered,
    };
  }

  if (input.partialAnswers && input.partialAnswers.length > 0) {
    const qIds = input.partialAnswers.map((a) => a.questionId);
    const dbQuestions = await db.quizQuestion.findMany({
      where: { id: { in: qIds } },
      include: { bank: true },
    });
    const qById = new Map(dbQuestions.map((q) => [q.id, q]));
    const startPos = session.answers.length + 1;

    let extraCorrect = 0;
    const rows = input.partialAnswers
      .map((ans, idx) => {
        const q = qById.get(ans.questionId);
        if (!q) return null;
        const isCorrect = ans.selectedIndex === q.correctIndex;
        if (isCorrect) extraCorrect += 1;
        return {
          sessionId: session.id,
          questionId: q.id,
          band: normalizeQuizBand(q.bank.band),
          correct: isCorrect,
          ms: Math.max(0, Math.round(ans.ms ?? 5000)),
          position: startPos + idx,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      await db.quizAnswer.createMany({ data: rows });
      await checkAndFlagBrokenQuestions(rows.map((r) => r.questionId));
    }

    await db.quizSession.update({
      where: { id: session.id },
      data: {
        outcome: "abandoned",
        endedAt: now,
        questionsAsked: session.questionsAsked + rows.length,
        correctCount: session.correctCount + extraCorrect,
      },
    });
  } else {
    await db.quizSession.update({
      where: { id: session.id },
      data: {
        outcome: "abandoned",
        endedAt: now,
        questionsAsked: session.answers.length,
      },
    });
  }

  return {
    outcome: "abandoned",
    recorded: true,
    questionsAnswered: totalAnswered,
  };
}
