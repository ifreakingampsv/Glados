import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { recomputeUserSkill } from "@/services/levels";
import { type QuizBand } from "@/services/quiz-banks";
import {
  abandonQuizSession,
  getQuizCooldownStatus,
  resolveStartBandForUserSkill,
  startQuizSession,
  submitQuizRound,
  type QuizQuestionClientView,
  type RoundAnswerInput,
} from "@/services/quiz";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";

const TEST_PREFIX = "test-quiz-session-";
const createdUserIds: string[] = [];

async function makeUser(suffix: string) {
  const id = `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createdUserIds.push(id);
  return db.user.create({
    data: {
      id,
      clerkId: `clerk_${id}`,
      email: `${id}@example.test`,
      role: "USER",
    },
  });
}

function makeStubFetch() {
  let callCount = 0;
  const fetchFn: typeof fetch = async (_url, init) => {
    callCount += 1;
    const bodyStr = typeof init?.body === "string" ? init.body : "{}";
    let promptText = bodyStr;
    try {
      const parsed = JSON.parse(bodyStr) as {
        messages?: Array<{ content?: string }>;
      };
      promptText =
        parsed.messages?.map((m) => m.content ?? "").join("\n") ?? bodyStr;
    } catch {
      // ignore
    }

    if (promptText.includes("Generate one concise")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Go is a statically typed compiled systems programming language.",
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const bandMatch = promptText.match(/Target band:\s*(L0-1|L2-3|L4-5)/);
    const band: QuizBand = (bandMatch?.[1] as QuizBand) ?? "L0-1";

    const questions = Array.from({ length: 24 }, (_, idx) => ({
      prompt: `[${band}] Go question #${idx + 1}: What occurs in case ${idx + 1}?`,
      options: [
        `Correct option for ${band} Q${idx + 1}`,
        `Distractor B for ${band} Q${idx + 1}`,
        `Distractor C for ${band} Q${idx + 1}`,
        `Distractor D for ${band} Q${idx + 1}`,
      ],
      correctIndex: 0,
      tags: [band.toLowerCase(), `subtopic-${(idx % 4) + 1}`],
    }));

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ questions }),
            },
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 400 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  return {
    fetchFn,
    getCallCount: () => callCount,
  };
}

function buildRoundAnswers(
  questions: QuizQuestionClientView[],
  numCorrect: number,
  ms = 4200
): RoundAnswerInput[] {
  return questions.map((q, idx) => ({
    questionId: q.id,
    // Our stub sets correctIndex = 0 for all generated questions
    selectedIndex: idx < numCorrect ? 0 : 1,
    ms,
  }));
}

beforeAll(async () => {
  process.env.PLATFORM_GOOGLE_API_KEY = "test-platform-google-key";
  await seedCanonicalSkills();
  await seedConfig();
  await seedRoutes();
});

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({
      where: { id: { in: [...createdUserIds] } },
    });
    createdUserIds.length = 0;
  }
});

afterAll(async () => {
  const goSkill = await db.skill.findUnique({ where: { name: "go" } });
  if (goSkill) {
    await db.quizBank.deleteMany({ where: { skillId: goSkill.id } });
  }
});

describe("quiz session service (Ticket 03)", () => {
  it("resolves start band from the higher of claimedLevel and evidenced level (L0-1 default) without claims affecting score", async () => {
    const user = await makeUser("start-band");
    const skill = await db.skill.findUniqueOrThrow({ where: { name: "go" } });

    // 1. Neither claim nor evidence -> L0-1
    const defaultPlacement = await resolveStartBandForUserSkill(
      user.id,
      skill.id
    );
    expect(defaultPlacement.band).toBe("L0-1");

    // 2. Claimed level 4 (from self-assessment / resume parse), evidenced 0 -> starts at L4-5, score stays 0
    await db.userSkill.upsert({
      where: { userId_skillId: { userId: user.id, skillId: skill.id } },
      create: {
        userId: user.id,
        skillId: skill.id,
        level: 0,
        score: 0,
        claimedLevel: 4,
        claimOrigins: ["resume"],
      },
      update: {
        claimedLevel: 4,
        claimOrigins: ["resume"],
      },
    });

    const claimPlacement = await resolveStartBandForUserSkill(
      user.id,
      skill.id
    );
    expect(claimPlacement.band).toBe("L4-5");
    const usAfterClaim = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: skill.id } },
    });
    expect(usAfterClaim.score).toBe(0);
    expect(usAfterClaim.level).toBe(0);

    // 3. Evidenced level 3 > claimed level 1 -> starts at L2-3
    await db.userSkill.update({
      where: { userId_skillId: { userId: user.id, skillId: skill.id } },
      data: { claimedLevel: 1, level: 3, score: 35 },
    });
    const evidencedPlacement = await resolveStartBandForUserSkill(
      user.id,
      skill.id
    );
    expect(evidencedPlacement.band).toBe("L2-3");
  });

  it("steps up on >=5 correct, steps down on <=2 correct, settles on 3..4, and hard-caps at 18 questions with zero LLM grading calls", async () => {
    const user = await makeUser("staircase");
    const skill = await db.skill.findUniqueOrThrow({ where: { name: "go" } });
    const stub = makeStubFetch();

    // Start in L2-3 via claimedLevel = 2
    await db.userSkill.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        level: 0,
        score: 0,
        claimedLevel: 2,
        claimOrigins: ["self"],
      },
    });

    const t0 = new Date("2026-01-10T10:00:00.000Z");
    const startRes = await startQuizSession(
      { userId: user.id, skillId: skill.id, now: t0 },
      stub.fetchFn
    );
    expect(startRes.startBand).toBe("L2-3");
    expect(startRes.currentRoundQuestions).toHaveLength(6);

    const callsAfterBankEnsure = stub.getCallCount();

    // Round 1 (L2-3): 5/6 correct -> steps UP to L4-5
    const r1 = await submitQuizRound({
      sessionId: startRes.session.id,
      userId: user.id,
      answers: buildRoundAnswers(startRes.currentRoundQuestions, 5, 3500),
      now: new Date("2026-01-10T10:03:00.000Z"),
    });
    expect(r1.status).toBe("continue");
    if (r1.status !== "continue") throw new Error("Expected continue");
    expect(r1.stepDirection).toBe("up");
    expect(r1.currentBand).toBe("L4-5");
    expect(r1.roundNumber).toBe(2);

    // Round 2 (L4-5): 2/6 correct -> steps DOWN to L2-3
    const r2 = await submitQuizRound({
      sessionId: startRes.session.id,
      userId: user.id,
      answers: buildRoundAnswers(r1.currentRoundQuestions, 2, 4100),
      now: new Date("2026-01-10T10:06:00.000Z"),
    });
    expect(r2.status).toBe("continue");
    if (r2.status !== "continue") throw new Error("Expected continue");
    expect(r2.stepDirection).toBe("down");
    expect(r2.currentBand).toBe("L2-3");
    expect(r2.roundNumber).toBe(3);

    // Round 3 (L2-3): 5/6 correct -> hits 18-question hard cap and settles!
    const r3 = await submitQuizRound({
      sessionId: startRes.session.id,
      userId: user.id,
      answers: buildRoundAnswers(r2.currentRoundQuestions, 5, 3800),
      now: new Date("2026-01-10T10:09:00.000Z"),
    });
    expect(r3.status).toBe("completed");
    if (r3.status !== "completed") throw new Error("Expected completed");

    // Zero additional LLM calls happened during the 3 grading rounds
    expect(stub.getCallCount()).toBe(callsAfterBankEnsure);

    expect(r3.session.questionsAsked).toBe(18);
    expect(r3.session.correctCount).toBe(12);
    expect(r3.settledBand).toBe("L2-3");
    expect(r3.perBand["L2-3"]).toEqual({ correct: 10, total: 12 });
    expect(r3.perBand["L4-5"]).toEqual({ correct: 2, total: 6 });

    // Check raw points: L2-3 weight = 2 (10 * 2 = 20) + L4-5 weight = 4 (2 * 4 = 8) = 28
    expect(r3.rawPoints).toBe(28);
    expect(r3.pointsDelta).toBe(28);

    // Verify telemetry rows in quiz_answers
    const answerRows = await db.quizAnswer.findMany({
      where: { sessionId: startRes.session.id },
      orderBy: { position: "asc" },
    });
    expect(answerRows).toHaveLength(18);
    expect(answerRows[0].position).toBe(1);
    expect(answerRows[17].position).toBe(18);

    // Verify event payload
    const payload = r3.event.payload as Record<string, unknown>;
    expect(payload.settledBand).toBe("L2-3");
    expect(payload.sessionId).toBe(startRes.session.id);
    expect(payload.bankVersion).toBe(startRes.session.bankVersion);
    expect(payload.perBand).toEqual(r3.perBand);
  });

  it("enforces 7-day per-skill cooldown on completed sessions while abandoned sessions (<3 answers) write nothing and consume no cooldown", async () => {
    const user = await makeUser("cooldown");
    const skill = await db.skill.findUniqueOrThrow({ where: { name: "go" } });
    const stub = makeStubFetch();

    const t0 = new Date("2026-02-01T12:00:00.000Z");
    const s1 = await startQuizSession(
      { userId: user.id, skillId: skill.id, now: t0 },
      stub.fetchFn
    );

    // Abandon after only 2 answers (< 3 threshold)
    const abandonRes = await abandonQuizSession({
      sessionId: s1.session.id,
      userId: user.id,
      partialAnswers: buildRoundAnswers(
        s1.currentRoundQuestions.slice(0, 2),
        1
      ),
      now: new Date("2026-02-01T12:02:00.000Z"),
    });
    expect(abandonRes.recorded).toBe(false);

    // Session row was removed and cooldown is NOT active
    const deletedSession = await db.quizSession.findUnique({
      where: { id: s1.session.id },
    });
    expect(deletedSession).toBeNull();

    const cdAfterAbandon = await getQuizCooldownStatus(
      user.id,
      skill.id,
      new Date("2026-02-01T12:05:00.000Z")
    );
    expect(cdAfterAbandon.onCooldown).toBe(false);

    // Start again immediately and settle in 1 round (4/6 correct in L0-1)
    const s2 = await startQuizSession(
      {
        userId: user.id,
        skillId: skill.id,
        now: new Date("2026-02-01T12:10:00.000Z"),
      },
      stub.fetchFn
    );
    const finishT = new Date("2026-02-01T12:15:00.000Z");
    const done = await submitQuizRound({
      sessionId: s2.session.id,
      userId: user.id,
      answers: buildRoundAnswers(s2.currentRoundQuestions, 4),
      now: finishT,
    });
    expect(done.status).toBe("completed");

    // 3 days later -> on cooldown
    const threeDaysLater = new Date("2026-02-04T12:15:00.000Z");
    const cdActive = await getQuizCooldownStatus(
      user.id,
      skill.id,
      threeDaysLater
    );
    expect(cdActive.onCooldown).toBe(true);
    expect(cdActive.nextRetakeAt?.toISOString()).toBe(
      "2026-02-08T12:15:00.000Z"
    );

    await expect(
      startQuizSession(
        { userId: user.id, skillId: skill.id, now: threeDaysLater },
        stub.fetchFn
      )
    ).rejects.toThrow(/cooldown active/i);

    // Exactly 7 days later -> cooldown expired, retake allowed
    const sevenDaysLater = new Date("2026-02-08T12:15:00.000Z");
    const cdExpired = await getQuizCooldownStatus(
      user.id,
      skill.id,
      sevenDaysLater
    );
    expect(cdExpired.onCooldown).toBe(false);
  });

  it("writes signed deltas on retakes: same-level retake writes 0, and January +16 -> July worse retake clamps to decayed quiz contribution without touching repo evidence", async () => {
    const user = await makeUser("delta-decay");
    const skill = await db.skill.findUniqueOrThrow({ where: { name: "go" } });
    const stub = makeStubFetch();

    const jan1 = new Date("2026-01-01T00:00:00.000Z");

    // Non-quiz evidence: imported repo (+10 raw points on Jan 1)
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "repo_imported",
      skills: [skill.id],
      occurredAt: jan1,
      now: jan1,
      pointsOverride: 10,
    });

    // Put user at L2-3 start band
    await db.userSkill.update({
      where: { userId_skillId: { userId: user.id, skillId: skill.id } },
      data: { claimedLevel: 3 },
    });

    // Quiz 1 on Jan 1: start L2-3, get 5/6 (+10) -> step up to L4-5, get 1/6 (+4) -> step down to L2-3, get 1/6 (+2) -> total rawPoints = 16!
    const q1Start = await startQuizSession(
      { userId: user.id, skillId: skill.id, now: jan1 },
      stub.fetchFn
    );
    const q1R1 = await submitQuizRound({
      sessionId: q1Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q1Start.currentRoundQuestions, 5),
      now: jan1,
    });
    if (q1R1.status !== "continue") throw new Error("Expected continue");
    const q1R2 = await submitQuizRound({
      sessionId: q1Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q1R1.currentRoundQuestions, 1),
      now: jan1,
    });
    if (q1R2.status !== "continue") throw new Error("Expected continue");
    const q1R3 = await submitQuizRound({
      sessionId: q1Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q1R2.currentRoundQuestions, 1),
      now: jan1,
    });
    if (q1R3.status !== "completed") throw new Error("Expected completed");
    expect(q1R3.rawPoints).toBe(16);
    expect(q1R3.pointsDelta).toBe(16);

    // Same-level retake 8 days later (Jan 9): scoring rawPoints = 16 again writes delta = 0
    const jan9 = new Date("2026-01-09T00:00:00.000Z");
    const q2Start = await startQuizSession(
      { userId: user.id, skillId: skill.id, now: jan9 },
      stub.fetchFn
    );
    const q2R1 = await submitQuizRound({
      sessionId: q2Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q2Start.currentRoundQuestions, 5),
      now: jan9,
    });
    if (q2R1.status !== "continue") throw new Error("Expected continue");
    const q2R2 = await submitQuizRound({
      sessionId: q2Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q2R1.currentRoundQuestions, 1),
      now: jan9,
    });
    if (q2R2.status !== "continue") throw new Error("Expected continue");
    const q2R3 = await submitQuizRound({
      sessionId: q2Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q2R2.currentRoundQuestions, 1),
      now: jan9,
    });
    if (q2R3.status !== "completed") throw new Error("Expected completed");
    expect(q2R3.rawPoints).toBe(16);
    expect(q2R3.previousRawPoints).toBe(16);
    expect(q2R3.pointsDelta).toBe(0);

    // July retake (180 days after Jan 1 = two 90-day half-lives):
    // Jan 1 +16 quiz event has decayed to 16 * 0.25 = 4.0 points.
    // Repo event (+10 on Jan 1) has decayed to 10 * 0.25 = 2.5 points.
    // User now scores 0 on the July retake (rawDelta = 0 - 16 = -16).
    // Clamped delta must be -4 (flooring decayed quiz contribution at 0) so repo's 2.5 is untouched!
    const july1 = new Date(jan1.getTime() + 180 * 86_400_000);
    const q3Start = await startQuizSession(
      { userId: user.id, skillId: skill.id, now: july1 },
      stub.fetchFn
    );
    // Start band is L2-3; score 0/6 -> steps down to L0-1; score 0/6 in L0-1 -> settles at L0-1 with rawPoints = 0
    const q3R1 = await submitQuizRound({
      sessionId: q3Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q3Start.currentRoundQuestions, 0),
      now: july1,
    });
    if (q3R1.status !== "continue") throw new Error("Expected continue");
    const q3R2 = await submitQuizRound({
      sessionId: q3Start.session.id,
      userId: user.id,
      answers: buildRoundAnswers(q3R1.currentRoundQuestions, 0),
      now: july1,
    });
    if (q3R2.status !== "completed") throw new Error("Expected completed");
    expect(q3R2.rawPoints).toBe(0);
    expect(q3R2.rawDelta).toBe(-16);
    expect(q3R2.pointsDelta).toBe(-4);

    const recomputed = await recomputeUserSkill(user.id, skill.id, july1);
    expect(recomputed.score).toBeCloseTo(2.5, 5);
  });
});
