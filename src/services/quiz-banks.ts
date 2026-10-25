import { Prisma } from "@prisma/client";
import { assertAdmin } from "@/lib/auth";
import {
  db,
  type QuizBank,
  type QuizQuestion,
  type Skill,
  type User,
} from "@/lib/db";
import { resolveSkillId } from "@/lib/skill-resolution";
import { gatewayCall, hashContentForCache } from "@/services/gateway";
import { getConfig } from "@/services/levels";
import {
  DEFAULT_QUIZ_BANDS,
  DEFAULT_TELEMETRY_ALERT_THRESHOLD,
} from "@/services/seed-config";
import { ensureSkillDefinition } from "@/services/skill-admin";

export const QUIZ_BANDS = ["L0-1", "L2-3", "L4-5"] as const;
export type QuizBand = (typeof QUIZ_BANDS)[number];

export const QUESTIONS_PER_BANK = 24;
export const MIN_QUESTIONS_FOR_LINT = 6;
export const STRICT_REVIEW_GATING_FLAG = "quiz.strictReviewGating";

const PARENT_CATEGORY_NAMES = new Set([
  "languages",
  "frontend",
  "backend",
  "database",
  "devops",
  "mobile",
  "tooling",
]);

export interface CandidateQuizQuestion {
  prompt?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  correctIndices?: unknown;
  tags?: unknown;
}

export interface ValidatedQuizQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
  tags: string[];
}

export interface BankLintResult {
  ok: boolean;
  errors: string[];
  questions: ValidatedQuizQuestion[];
}

export interface QuizBankWithQuestions extends QuizBank {
  questions: QuizQuestion[];
}

export interface SpotReviewQueueItem {
  bankId: string;
  skillId: string;
  skillDisplay: string;
  band: string;
  version: number;
  status: string;
  questionCount: number;
  generatedAt: Date;
  flaggedQuestions: Array<{
    questionId: string;
    prompt: string;
    answerCount: number;
    successRate: number;
  }>;
}

export function normalizeQuizBand(raw: string): QuizBand {
  const cleaned = raw.trim().replace(/[–—]/g, "-").toUpperCase();
  if (cleaned === "L0-1" || cleaned === "L0-2") return "L0-1";
  if (cleaned === "L2-3" || cleaned === "L3-4") return "L2-3";
  if (cleaned === "L4-5" || cleaned === "L5-6") return "L4-5";
  throw new Error(`Invalid quiz band: ${raw}`);
}

export async function isCanonicalLeafSkill(skillId: string): Promise<boolean> {
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill || skill.status !== "ACTIVE") return false;
  if (PARENT_CATEGORY_NAMES.has(skill.name)) return false;
  const childCount = await db.skill.count({ where: { parentId: skill.id } });
  return childCount === 0;
}

export async function assertCanonicalLeafSkill(
  skillId: string
): Promise<Skill> {
  let canonicalId = skillId;
  try {
    canonicalId = await resolveSkillId(skillId);
  } catch {
    canonicalId = skillId;
  }
  const skill = await db.skill.findUnique({ where: { id: canonicalId } });
  if (!skill || skill.status !== "ACTIVE") {
    throw new Error(
      "Calibration quizzes are only available for active canonical skills"
    );
  }
  if (PARENT_CATEGORY_NAMES.has(skill.name)) {
    throw new Error(
      `Parent category "${skill.display}" cannot have a quiz bank; choose a leaf skill`
    );
  }
  const childCount = await db.skill.count({ where: { parentId: skill.id } });
  if (childCount > 0) {
    throw new Error(
      `Parent skill "${skill.display}" has child skills; only leaf skills have quiz banks`
    );
  }
  return skill;
}

export async function isStrictReviewGatingEnabled(): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({
    where: { key: STRICT_REVIEW_GATING_FLAG },
  });
  if (flag) return flag.enabled;
  const cfg = await getConfig<boolean>(STRICT_REVIEW_GATING_FLAG, false);
  return Boolean(cfg);
}

export async function setQuizStrictReviewGating(admin: User, enabled: boolean) {
  assertAdmin(admin);
  return db.featureFlag.upsert({
    where: { key: STRICT_REVIEW_GATING_FLAG },
    update: { enabled },
    create: { key: STRICT_REVIEW_GATING_FLAG, enabled },
  });
}

export function lintQuestionBank(rawInput: unknown): BankLintResult {
  const errors: string[] = [];
  const list: unknown[] = Array.isArray(rawInput)
    ? rawInput
    : rawInput &&
        typeof rawInput === "object" &&
        Array.isArray((rawInput as { questions?: unknown }).questions)
      ? ((rawInput as { questions: unknown[] }).questions ?? [])
      : [];

  if (list.length < MIN_QUESTIONS_FOR_LINT) {
    errors.push(
      `insufficient_questions: expected at least ${MIN_QUESTIONS_FOR_LINT}, got ${list.length}`
    );
  }

  const seenPrompts = new Set<string>();
  const validated: ValidatedQuizQuestion[] = [];

  list.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      errors.push(`q[${idx}]: invalid_question_object`);
      return;
    }
    const q = item as CandidateQuizQuestion;
    const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
    if (!prompt) {
      errors.push(`q[${idx}]: empty_prompt`);
    } else {
      const normalizedPrompt = prompt.toLowerCase().replace(/\s+/g, " ");
      if (seenPrompts.has(normalizedPrompt)) {
        errors.push(`q[${idx}]: duplicate_prompt`);
      }
      seenPrompts.add(normalizedPrompt);
    }

    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const options = rawOptions
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter((o) => o.length > 0);

    if (
      options.length < 2 ||
      options.length > 6 ||
      options.length !== rawOptions.length
    ) {
      errors.push(`q[${idx}]: invalid_option_count`);
    } else {
      const uniqueOptions = new Set(options.map((o) => o.toLowerCase()));
      if (uniqueOptions.size !== options.length) {
        errors.push(`q[${idx}]: duplicate_options`);
      }
    }

    if (Array.isArray(q.correctIndices)) {
      if (q.correctIndices.length !== 1) {
        errors.push(`q[${idx}]: invalid_correct_option_count`);
      }
    }

    const correctIndex =
      typeof q.correctIndex === "number" && Number.isInteger(q.correctIndex)
        ? q.correctIndex
        : Array.isArray(q.correctIndices) &&
            q.correctIndices.length === 1 &&
            typeof q.correctIndices[0] === "number" &&
            Number.isInteger(q.correctIndices[0])
          ? (q.correctIndices[0] as number)
          : -1;

    if (correctIndex < 0 || correctIndex >= options.length) {
      errors.push(`q[${idx}]: invalid_correct_option_count`);
    }

    const rawTags = Array.isArray(q.tags) ? q.tags : [];
    const tags = rawTags
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t.length > 0);
    if (tags.length === 0) {
      errors.push(`q[${idx}]: missing_tags`);
    }

    if (
      prompt &&
      options.length >= 2 &&
      correctIndex >= 0 &&
      correctIndex < options.length &&
      tags.length > 0
    ) {
      validated.push({
        prompt,
        options,
        correctIndex,
        tags,
      });
    }
  });

  return {
    ok: errors.length === 0 && validated.length >= MIN_QUESTIONS_FOR_LINT,
    errors,
    questions: validated,
  };
}

function parseRawBankContent(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function buildDeterministicBankPayload(
  skillDisplay: string,
  band: QuizBand,
  count: number = QUESTIONS_PER_BANK
): { questions: ValidatedQuizQuestion[] } {
  const questions: ValidatedQuizQuestion[] = [];
  for (let i = 1; i <= count; i++) {
    const subtopic =
      i % 3 === 0 ? "debugging" : i % 2 === 0 ? "architecture" : "fundamentals";
    questions.push({
      prompt: `[${skillDisplay} ${band} Q${i}] Which statement accurately describes ${skillDisplay} ${subtopic} concept #${i}?`,
      options: [
        `Correct ${skillDisplay} ${band} behavior for concept #${i}`,
        `Distractor A for ${skillDisplay} concept #${i}`,
        `Distractor B for ${skillDisplay} concept #${i}`,
        `Distractor C for ${skillDisplay} concept #${i}`,
      ],
      correctIndex: 0,
      tags: [`band:${band}`, `topic:${subtopic}`],
    });
  }
  return { questions };
}

async function generateSingleBandBank(params: {
  skill: Skill;
  definition: string;
  band: QuizBand;
  version: number;
  userId: string;
  strictReviewGating: boolean;
  fetchImpl: typeof fetch;
}): Promise<QuizBankWithQuestions> {
  const {
    skill,
    definition,
    band,
    version,
    userId,
    strictReviewGating,
    fetchImpl,
  } = params;

  const bankRow = await db.quizBank.upsert({
    where: {
      skillId_band_version: {
        skillId: skill.id,
        band,
        version,
      },
    },
    update: { status: "generating" },
    create: {
      skillId: skill.id,
      band,
      version,
      status: "generating",
    },
  });

  let finalLint: BankLintResult = { ok: false, errors: [], questions: [] };

  // Deterministic lint before live: if attempt 1 fails lint, regenerate ONCE (attempt 2).
  for (const attempt of [1, 2]) {
    const cachePayload = JSON.stringify({
      skillId: skill.id,
      skillName: skill.name,
      definition,
      band,
      version,
      attempt,
    });
    const cacheKey = hashContentForCache("bank_gen", cachePayload);

    const gwRes = await gatewayCall(
      {
        userId,
        feature: "bank_gen",
        cacheKey,
        forcePlatform: true,
        skipEnergy: true,
        messages: [
          {
            role: "system",
            content: `Generate a multiple-choice calibration quiz bank of ${QUESTIONS_PER_BANK} questions for the requested skill and band. Ground every question in the canonical skill definition. Return JSON only: {"questions": [{"prompt": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "tags": ["difficulty:${band}", "subtopic:..."]}]}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              skill: skill.display,
              definition,
              band,
              version,
              attempt,
              questionCount: QUESTIONS_PER_BANK,
            }),
          },
        ],
      },
      fetchImpl
    );

    if (gwRes.status !== "ok") {
      throw new Error(`Quiz bank generation failed: ${gwRes.message}`);
    }

    const parsed = parseRawBankContent(gwRes.content);
    finalLint = lintQuestionBank(parsed);
    if (finalLint.ok) {
      break;
    }
  }

  const nextStatus = finalLint.ok
    ? strictReviewGating
      ? "needs_review"
      : "live"
    : "needs_review";

  return db.$transaction(async (tx) => {
    await tx.quizQuestion.deleteMany({ where: { bankId: bankRow.id } });

    for (const q of finalLint.questions) {
      await tx.quizQuestion.create({
        data: {
          bankId: bankRow.id,
          prompt: q.prompt,
          options: q.options as unknown as Prisma.InputJsonValue,
          correctIndex: q.correctIndex,
          tags: q.tags,
        },
      });
    }

    return tx.quizBank.update({
      where: { id: bankRow.id },
      data: {
        status: nextStatus,
        generatedAt: new Date(),
      },
      include: { questions: true },
    });
  });
}

export async function ensureQuizBanksForSkill(
  skillId: string,
  userId: string,
  fetchImpl: typeof fetch = fetch
): Promise<QuizBankWithQuestions[]> {
  const skill = await assertCanonicalLeafSkill(skillId);
  const definition = await ensureSkillDefinition(skill.id, userId, fetchImpl);
  const strictReviewGating = await isStrictReviewGatingEnabled();
  const configuredBands = await getConfig<Array<{ band: string } | string>>(
    "quiz.bands",
    DEFAULT_QUIZ_BANDS
  );

  const bands: QuizBand[] =
    configuredBands.length > 0
      ? configuredBands.map((b) =>
          normalizeQuizBand(typeof b === "string" ? b : b.band)
        )
      : [...QUIZ_BANDS];

  const results: QuizBankWithQuestions[] = [];

  for (const band of bands) {
    const existing = await db.quizBank.findFirst({
      where: {
        skillId: skill.id,
        band,
        status: { in: ["live", "needs_review"] },
      },
      orderBy: { version: "desc" },
      include: { questions: true },
    });

    if (existing) {
      results.push(existing);
      continue;
    }

    const latestAny = await db.quizBank.findFirst({
      where: { skillId: skill.id, band },
      orderBy: { version: "desc" },
    });
    const nextVersion =
      latestAny && latestAny.status === "retired"
        ? latestAny.version + 1
        : (latestAny?.version ?? 1);

    const generated = await generateSingleBandBank({
      skill,
      definition,
      band,
      version: nextVersion,
      userId,
      strictReviewGating,
      fetchImpl,
    });
    results.push(generated);
  }

  return results;
}

export async function getLiveQuizBanksForSkill(
  skillId: string,
  userId: string,
  fetchImpl: typeof fetch = fetch
): Promise<Map<QuizBand, QuizBankWithQuestions>> {
  const banks = await ensureQuizBanksForSkill(skillId, userId, fetchImpl);
  const liveMap = new Map<QuizBand, QuizBankWithQuestions>();
  for (const bank of banks) {
    if (bank.status === "live") {
      liveMap.set(normalizeQuizBand(bank.band), bank);
    }
  }
  return liveMap;
}

export async function adminGenerateQuizBanksNow(
  admin: User,
  skillId: string,
  fetchImpl: typeof fetch = fetch
): Promise<QuizBankWithQuestions[]> {
  assertAdmin(admin);
  return ensureQuizBanksForSkill(skillId, admin.id, fetchImpl);
}

export async function approveQuizBankReview(
  admin: User,
  bankId: string
): Promise<QuizBankWithQuestions> {
  assertAdmin(admin);
  const bank = await db.quizBank.findUnique({
    where: { id: bankId },
    include: { questions: true },
  });
  if (!bank) {
    throw new Error("Quiz bank not found");
  }
  if (bank.questions.length < MIN_QUESTIONS_FOR_LINT) {
    throw new Error(
      "Cannot publish a bank that failed lint without replacement"
    );
  }
  return db.quizBank.update({
    where: { id: bank.id },
    data: { status: "live" },
    include: { questions: true },
  });
}

export async function retireAndReplaceQuizBank(
  admin: User,
  target: { bankId?: string; skillId?: string; band?: string },
  fetchImpl: typeof fetch = fetch
): Promise<{
  retiredBank: QuizBank;
  replacementBank: QuizBankWithQuestions;
}> {
  assertAdmin(admin);

  let existingBank: QuizBank | null = null;
  if (target.bankId) {
    existingBank = await db.quizBank.findUnique({
      where: { id: target.bankId },
    });
  } else if (target.skillId && target.band) {
    const canonicalSkill = await assertCanonicalLeafSkill(target.skillId);
    const normalizedBand = normalizeQuizBand(target.band);
    existingBank = await db.quizBank.findFirst({
      where: {
        skillId: canonicalSkill.id,
        band: normalizedBand,
      },
      orderBy: { version: "desc" },
    });
  }

  if (!existingBank) {
    throw new Error("Target quiz bank not found to retire");
  }

  const retiredBank = await db.quizBank.update({
    where: { id: existingBank.id },
    data: { status: "retired" },
  });

  const skill = await assertCanonicalLeafSkill(existingBank.skillId);
  const definition = await ensureSkillDefinition(skill.id, admin.id, fetchImpl);
  const strictReviewGating = await isStrictReviewGatingEnabled();
  const latestForBand = await db.quizBank.findFirst({
    where: { skillId: skill.id, band: existingBank.band },
    orderBy: { version: "desc" },
  });
  const nextVersion = Math.max(
    existingBank.version + 1,
    (latestForBand?.version ?? 0) + 1
  );

  const replacementBank = await generateSingleBandBank({
    skill,
    definition,
    band: normalizeQuizBand(existingBank.band),
    version: nextVersion,
    userId: admin.id,
    strictReviewGating,
    fetchImpl,
  });

  return {
    retiredBank,
    replacementBank,
  };
}

export async function listAdminBankSpotReviewQueue(
  admin: User
): Promise<SpotReviewQueueItem[]> {
  assertAdmin(admin);

  const alertConfig = await getConfig<{
    minAnswers?: number;
    maxSuccessRate?: number;
  }>("telemetry.alertThreshold", DEFAULT_TELEMETRY_ALERT_THRESHOLD);
  const minAnswers =
    alertConfig.minAnswers ?? DEFAULT_TELEMETRY_ALERT_THRESHOLD.minAnswers;
  const maxSuccessRate =
    alertConfig.maxSuccessRate ??
    DEFAULT_TELEMETRY_ALERT_THRESHOLD.maxSuccessRate;

  const [banks, skills, answers] = await Promise.all([
    db.quizBank.findMany({
      where: { status: { in: ["live", "needs_review"] } },
      include: { questions: true },
      orderBy: [{ generatedAt: "desc" }],
    }),
    db.skill.findMany({ select: { id: true, display: true } }),
    db.quizAnswer.findMany({
      select: { questionId: true, correct: true },
    }),
  ]);

  const skillDisplayById = new Map(skills.map((s) => [s.id, s.display]));
  const statsByQuestion = new Map<string, { total: number; correct: number }>();
  for (const ans of answers) {
    const stat = statsByQuestion.get(ans.questionId) ?? {
      total: 0,
      correct: 0,
    };
    stat.total += 1;
    if (ans.correct) stat.correct += 1;
    statsByQuestion.set(ans.questionId, stat);
  }

  const queue: SpotReviewQueueItem[] = banks.map((bank) => {
    const flaggedQuestions: SpotReviewQueueItem["flaggedQuestions"] = [];
    for (const q of bank.questions) {
      const stat = statsByQuestion.get(q.id);
      const total = stat?.total ?? 0;
      const rate = total > 0 ? (stat?.correct ?? 0) / total : 1;
      const isBrokenByStats = total >= minAnswers && rate < maxSuccessRate;
      const isBrokenByTag = q.tags.includes("alert:broken");
      if (isBrokenByStats || isBrokenByTag) {
        flaggedQuestions.push({
          questionId: q.id,
          prompt: q.prompt,
          answerCount: total,
          successRate: Number(rate.toFixed(4)),
        });
      }
    }

    return {
      bankId: bank.id,
      skillId: bank.skillId,
      skillDisplay: skillDisplayById.get(bank.skillId) ?? bank.skillId,
      band: bank.band,
      version: bank.version,
      status: bank.status,
      questionCount: bank.questions.length,
      generatedAt: bank.generatedAt,
      flaggedQuestions,
    };
  });

  // Sort needs_review and broken-question-alerted banks to the top of the queue
  queue.sort((a, b) => {
    const aUrgent =
      a.status === "needs_review" || a.flaggedQuestions.length > 0 ? 1 : 0;
    const bUrgent =
      b.status === "needs_review" || b.flaggedQuestions.length > 0 ? 1 : 0;
    if (aUrgent !== bUrgent) return bUrgent - aUrgent;
    return b.generatedAt.getTime() - a.generatedAt.getTime();
  });

  return queue;
}
