import { db, type Project } from "@/lib/db";
import { getConfig, recomputeUserSkill } from "@/services/levels";
import { deductEnergy, ensureDailyGrant } from "@/services/energy";
import {
  gatewayCall,
  hasByoForFeature,
  hashContentForCache,
} from "@/services/gateway";

// S2 interviews (D79/D80/D82/D84/D88). The interviewer asks from the VISIBLE
// SURFACE only; generation runs through the interview_turn routing row; the
// flat energy bar is charged once per session start, platform-keyed only.

export const INTERVIEW_TURN_FEATURE = "interview_turn";
export const BANK_CATEGORIES = [
  "architecture",
  "tradeoff",
  "failure",
  "scale",
] as const;

export type InterviewMode = "quick" | "deep";
export type InterviewOrigin = "web" | "mcp";
export type InterviewScope = "project" | "portfolio" | "application";

export class InsufficientEnergyError extends Error {
  constructor() {
    super("not enough energy bars for an interview");
  }
}

export interface InterviewBankQuestion {
  text: string;
  category: string;
  skillFocus?: string[];
}

export interface InterviewBank {
  questions: InterviewBankQuestion[];
}

export interface VisibleSurfacePack {
  scope: string;
  project?: {
    id: string;
    title: string;
    description: string;
    skills: string[];
    links: unknown;
  };
  projects?: Array<VisibleSurfacePack["project"]>;
  resume?: Array<{ kind: string; content: string }>;
  jd?: { title: string; requiredSkills: unknown };
}

// D79: visible surface ONLY — what a prepared interviewer could hold. No
// decision records, no quiz bands, no event-log data ever enters this pack.
export function buildVisibleSurfacePack(project: Project): VisibleSurfacePack {
  return {
    scope: "project",
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      skills: [...project.skills],
      links: project.links,
    },
  };
}

function projectSurface(
  p: Project
): NonNullable<VisibleSurfacePack["project"]> {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    skills: [...p.skills],
    links: p.links,
  };
}

export interface ScopeSelection {
  scope: InterviewScope;
  projectId?: string;
  projectIds?: string[];
  jdId?: string;
}

// D80: each scope emulates what the real interviewer is holding — one repo,
// up to three (portfolio), or the resume (+ optional JD) for application mode.
export async function buildPackForScope(
  userId: string,
  selection: ScopeSelection
): Promise<VisibleSurfacePack> {
  if (selection.scope === "project") {
    if (!selection.projectId)
      throw new Error("projectId required for project scope");
    const project = await db.project.findFirst({
      where: { id: selection.projectId, userId },
    });
    if (!project) throw new Error("project not found");
    return buildVisibleSurfacePack(project);
  }

  if (selection.scope === "portfolio") {
    const ids = [...new Set(selection.projectIds ?? [])];
    if (ids.length === 0)
      throw new Error("portfolio scope needs at least one project");
    const cap = await getConfig<number>("interview.portfolioCap", 3);
    if (ids.length > cap) {
      throw new Error(`portfolio scope allows at most ${cap} projects`);
    }
    const projects = await db.project.findMany({
      where: { userId, id: { in: ids } },
    });
    if (projects.length !== ids.length) throw new Error("project not found");
    return { scope: "portfolio", projects: projects.map(projectSurface) };
  }

  // application: the interviewer holds the resume (all current blocks) and
  // optionally the job description with its extracted canonical skills.
  const blocks = await db.resumeBlock.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
  if (blocks.length === 0)
    throw new Error("no resume blocks to interview against");
  const pack: VisibleSurfacePack = {
    scope: "application",
    resume: blocks.map((b) => ({ kind: b.kind, content: b.content })),
  };
  if (selection.jdId) {
    const jd = await db.jobDescription.findFirst({
      where: { id: selection.jdId, userId },
    });
    if (!jd) throw new Error("job description not found");
    pack.jd = { title: jd.title, requiredSkills: jd.requiredSkills };
  }
  return pack;
}

export function packContentVersion(pack: VisibleSurfacePack): string {
  return hashContentForCache("iv_surface", JSON.stringify(pack));
}

export async function questionCountForMode(
  mode: InterviewMode
): Promise<number> {
  const fallback = mode === "deep" ? 12 : 5;
  const key =
    mode === "deep" ? "interview.deepQuestions" : "interview.quickQuestions";
  return getConfig<number>(key, fallback);
}

export function lintInterviewBank(
  raw: unknown,
  expectedCount: number
): { ok: boolean; errors: string[]; bank: InterviewBank } {
  const errors: string[] = [];
  const list: unknown[] =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { questions?: unknown }).questions)
      ? ((raw as { questions: unknown[] }).questions ?? [])
      : [];
  if (list.length < expectedCount) {
    errors.push(`insufficient_questions: ${list.length} < ${expectedCount}`);
  }
  const questions: InterviewBankQuestion[] = [];
  for (const [idx, item] of list.entries()) {
    if (!item || typeof item !== "object") {
      errors.push(`q[${idx}]: invalid_object`);
      continue;
    }
    const q = item as { text?: unknown; category?: unknown };
    const text = typeof q.text === "string" ? q.text.trim() : "";
    if (!text) errors.push(`q[${idx}]: empty_text`);
    const category =
      typeof q.category === "string" &&
      (BANK_CATEGORIES as readonly string[]).includes(q.category)
        ? q.category
        : "";
    if (!category) errors.push(`q[${idx}]: invalid_category`);
    if (text && category) questions.push({ text, category });
  }
  return { ok: errors.length === 0, errors, bank: { questions } };
}

function parseBankContent(content: string): unknown {
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

export function interviewBankCacheKey(input: {
  userId: string;
  scope: string;
  contentVersion: string;
  mode: InterviewMode;
  count: number;
  attempt?: number;
}): string {
  return hashContentForCache(
    "interview_bank",
    JSON.stringify({
      userId: input.userId,
      scope: input.scope,
      contentVersion: input.contentVersion,
      mode: input.mode,
      count: input.count,
      attempt: input.attempt ?? 1,
    })
  );
}

export interface EnsureBankInput {
  userId: string;
  pack: VisibleSurfacePack;
  contentVersion: string;
  mode: InterviewMode;
  count: number;
  forcePlatform?: boolean;
  fetchImpl?: typeof fetch;
}

// D80/D88d: the ranked bank is built ONCE per user+scope+content version and
// cached (D4). BYO-eligible on web; the MCP path passes forcePlatform.
export async function ensureInterviewBank(input: EnsureBankInput): Promise<{
  bank: InterviewBank;
  cacheKey: string;
  cached: boolean;
}> {
  const baseKey = interviewBankCacheKey({
    userId: input.userId,
    scope: input.pack.scope,
    contentVersion: input.contentVersion,
    mode: input.mode,
    count: input.count,
  });

  let linted = {
    ok: false,
    errors: [] as string[],
    bank: { questions: [] } as InterviewBank,
  };
  let usedKey = baseKey;
  let cached = false;

  for (const attempt of [1, 2]) {
    usedKey =
      attempt === 1
        ? baseKey
        : interviewBankCacheKey({
            userId: input.userId,
            scope: input.pack.scope,
            contentVersion: input.contentVersion,
            mode: input.mode,
            count: input.count,
            attempt,
          });
    const gw = await gatewayCall(
      {
        userId: input.userId,
        feature: INTERVIEW_TURN_FEATURE,
        cacheKey: usedKey,
        interactive: true,
        skipEnergy: true, // the flat session bar (D84) is charged at start, not per call
        forcePlatform: input.forcePlatform,
        messages: [
          {
            role: "system",
            content:
              'You generate a ranked question bank for a startup-mode technical interview grounded ONLY in the supplied surface. Persona: a founding engineer who assumes the project is vibe-coded until proven otherwise. Categories: architecture (structural choices), tradeoff (X-over-Y decisions), failure (what broke / error handling), scale (limits under load). Questions probe specifics, never trivia. Scope rules: PROJECT — deep dive on the one project. PORTFOLIO — open with one cross-project question (which of these is your deepest work and why), then rotate focus across the projects. APPLICATION — probe the resume\'s claims like an interviewer who read it; when a job description is supplied, skew questions toward its required skills; every claim is fair game to test. Return JSON only: {"questions": [{"text": "...", "category": "architecture|tradeoff|failure|scale", "skillFocus": ["optional skill"]}]}',
          },
          {
            role: "user",
            content: JSON.stringify({
              project: input.pack.project,
              mode: input.mode,
              questionCount: input.count,
              attempt,
            }),
          },
        ],
      },
      input.fetchImpl
    );
    if (gw.status !== "ok") {
      throw new Error(
        `interview bank generation failed: ${gw.status === "byo_failed" ? gw.message : "unknown"}`
      );
    }
    cached = cached || Boolean(gw.cached);
    linted = lintInterviewBank(parseBankContent(gw.content), input.count);
    if (linted.ok) break;
  }

  if (!linted.ok) {
    throw new Error(`interview bank failed lint: ${linted.errors.join("; ")}`);
  }
  return { bank: linted.bank, cacheKey: usedKey, cached };
}

export interface StartInterviewInput {
  projectId?: string;
  projectIds?: string[];
  jdId?: string;
  scope?: InterviewScope;
  mode: InterviewMode;
  origin?: InterviewOrigin;
  forcePlatform?: boolean;
  fetchImpl?: typeof fetch;
}

export async function startInterviewSession(
  userId: string,
  input: StartInterviewInput
): Promise<{ sessionId: string; firstQuestion: string; bankSize: number }> {
  const scope: InterviewScope = input.scope ?? "project";
  const pack = await buildPackForScope(userId, {
    scope,
    projectId: input.projectId,
    projectIds: input.projectIds,
    jdId: input.jdId,
  });
  const contentVersion = packContentVersion(pack);
  const count = await questionCountForMode(input.mode);
  const pushCap = await getConfig<number>("interview.pushCap", 2);

  const { bank, cacheKey } = await ensureInterviewBank({
    userId,
    pack,
    contentVersion,
    mode: input.mode,
    count,
    forcePlatform: input.forcePlatform,
    fetchImpl: input.fetchImpl,
  });

  // D84: flat per-session bar, platform-keyed only (BYO pays with their key).
  const byo = await hasByoForFeature(userId, INTERVIEW_TURN_FEATURE);
  const bars = await getConfig<number>("interview.barsPerSession", 1);
  if (!byo && bars > 0) {
    const account = await ensureDailyGrant(userId);
    if (account.balance < bars) throw new InsufficientEnergyError();
  }

  const session = await db.$transaction(async (tx) => {
    if (!byo && bars > 0) {
      await deductEnergy(userId, bars, tx);
    }
    const created = await tx.interviewSession.create({
      data: {
        userId,
        scope,
        mode: input.mode,
        status: "active",
        origin: input.origin ?? "web",
        payload: {
          grounding: {
            projectId: input.projectId ?? null,
            projectIds: input.projectIds ?? [],
            jdId: input.jdId ?? null,
          },
          groundingPack: pack,
          contentVersion,
          bankCacheKey: cacheKey,
          questionCount: count,
          pushCap,
        } as never,
      },
    });
    await tx.interviewTurn.create({
      data: {
        sessionId: created.id,
        idx: 0,
        questionText: bank.questions[0].text,
      },
    });
    return created;
  });

  return {
    sessionId: session.id,
    firstQuestion: bank.questions[0].text,
    bankSize: bank.questions.length,
  };
}

export async function getInterviewSession(userId: string, sessionId: string) {
  return db.interviewSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { idx: "asc" } } },
  });
}

export async function listInterviewSessions(userId: string, limit = 20) {
  return db.interviewSession.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

// --- Turn loop (ticket 03 / D80 / D88f) -------------------------------------

export const ABANDON_SWEEP_QUEUE = "interview_abandon_sweep";
export const ABANDON_SWEEP_CRON = "30 3 * * *"; // daily, after the decay sweep

type SessionPayloadShape = {
  grounding?: {
    projectId?: string | null;
    projectIds?: string[];
    jdId?: string | null;
  };
  groundingPack?: VisibleSurfacePack;
  contentVersion?: string;
  bankCacheKey?: string;
  questionCount?: number;
  pushCap?: number;
  bankIndex?: number;
  pushesUsed?: number;
};

type TurnShape = {
  idx: number;
  questionText: string;
  answerText: string | null;
  pushesUsed: number;
};

interface SessionWithTurns {
  id: string;
  userId: string;
  status: string;
  scope: string;
  mode: string;
  payload: unknown;
  turns: TurnShape[];
}

async function loadSession(userId: string, sessionId: string) {
  const session = await db.interviewSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { idx: "asc" } } },
  });
  if (!session) throw new Error("session not found");
  return session as unknown as SessionWithTurns;
}

async function loadBank(
  session: SessionWithTurns,
  fetchImpl?: typeof fetch
): Promise<InterviewBank> {
  const payload = (session.payload ?? {}) as SessionPayloadShape;
  if (!payload.bankCacheKey) throw new Error("session has no bank reference");
  const cached = await db.gatewayCache.findUnique({
    where: { cacheKey: payload.bankCacheKey },
  });
  if (cached) {
    const linted = lintInterviewBank(
      parseBankContent(cached.content),
      payload.questionCount ?? 5
    );
    if (linted.ok) return linted.bank;
  }
  // Cache miss/eviction, lint failure, or stale content version: regenerate
  // from the visible surface and update BOTH bank reference and version.
  const grounding = payload.grounding ?? {};
  const selection: ScopeSelection = {
    scope:
      session.scope === "portfolio" || session.scope === "application"
        ? session.scope
        : "project",
    projectId: grounding.projectId ?? undefined,
    projectIds: grounding.projectIds ?? undefined,
    jdId: grounding.jdId ?? undefined,
  };
  const pack = await buildPackForScope(session.userId, selection);
  const contentVersion = packContentVersion(pack);
  const { bank, cacheKey } = await ensureInterviewBank({
    userId: session.userId,
    pack,
    contentVersion,
    mode: session.mode === "deep" ? "deep" : "quick",
    count:
      payload.questionCount ??
      (await questionCountForMode(session.mode === "deep" ? "deep" : "quick")),
    fetchImpl,
  });
  const nextPayload = {
    ...payload,
    bankCacheKey: cacheKey,
    contentVersion,
  };
  await db.interviewSession.update({
    where: { id: session.id },
    data: { payload: nextPayload as never },
  });
  session.payload = nextPayload;
  return bank;
}

export interface AdvanceResult {
  action: "push" | "next" | "complete";
  question?: string;
  sessionId: string;
}

// One gateway call decides push vs move-on; the scaffold stays deterministic:
// "next" always delivers the next BANK question, completion is decided by the
// bank index, and the push cap is enforced service-side (bounded adaptivity).
async function advanceOnce(
  session: SessionWithTurns,
  fetchImpl?: typeof fetch
): Promise<AdvanceResult> {
  const bank = await loadBank(session, fetchImpl);
  // re-read: loadBank may have regenerated the bank and updated the payload
  const payload = (session.payload ?? {}) as SessionPayloadShape;
  const bankIndex = payload.bankIndex ?? 0;
  const pushesUsed = payload.pushesUsed ?? 0;
  const pushCap = payload.pushCap ?? 2;
  const lastTurn = session.turns[session.turns.length - 1];
  if (!lastTurn || lastTurn.answerText === null) {
    throw new Error("answer the current question first");
  }

  const transcript = session.turns.map((t) => ({
    question: t.questionText,
    answer: t.answerText,
    pushesUsed: t.pushesUsed,
  }));

  const gw = await gatewayCall(
    {
      userId: session.userId,
      feature: INTERVIEW_TURN_FEATURE,
      interactive: true,
      skipEnergy: true,
      messages: [
        {
          role: "system",
          content:
            'You are the interviewer in a startup-mode technical interview. You assume the project is vibe-coded until proven otherwise. Given the question bank and the transcript, decide the next move. PUSH only when the last answer is vague or hand-wavy, and the push MUST name the exact vagueness (e.g. "easier than what? name the alternative") — never a generic \'elaborate\'. Otherwise NEXT. You may NOT push more than the stated remaining pushes. Return JSON only: {"action": "push" | "next", "question": "the push question, only if action is push"}',
        },
        {
          role: "user",
          content: JSON.stringify({
            bankRemaining: bank.questions.slice(bankIndex + 1),
            bankIndex,
            pushesRemaining: Math.max(0, pushCap - pushesUsed),
            transcript,
          }),
        },
      ],
    },
    fetchImpl
  );
  if (gw.status !== "ok") {
    throw new Error(
      `interview advance failed: ${gw.status === "byo_failed" ? gw.message : "unknown"}`
    );
  }
  const decision = parseBankContent(gw.content) as {
    action?: unknown;
    question?: unknown;
  } | null;
  const wantsPush =
    decision?.action === "push" &&
    typeof decision.question === "string" &&
    decision.question.trim().length > 0;

  if (wantsPush && pushesUsed < pushCap) {
    const pushQuestion = (decision as { question: string }).question.trim();
    const nextPayload = { ...payload, pushesUsed: pushesUsed + 1 };
    await db.$transaction(async (tx) => {
      await tx.interviewTurn.create({
        data: {
          sessionId: session.id,
          idx: lastTurn.idx + 1,
          questionText: pushQuestion,
          pushesUsed: pushesUsed + 1,
        },
      });
      await tx.interviewSession.update({
        where: { id: session.id },
        data: { payload: nextPayload as never },
      });
    });
    return { action: "push", question: pushQuestion, sessionId: session.id };
  }

  const nextIndex = bankIndex + 1;
  if (nextIndex >= (payload.questionCount ?? bank.questions.length)) {
    await db.interviewSession.update({
      where: { id: session.id },
      data: { status: "completed", completedAt: new Date() },
    });
    return { action: "complete", sessionId: session.id };
  }
  const nextQuestion = bank.questions[nextIndex];
  const nextPayload = { ...payload, bankIndex: nextIndex, pushesUsed: 0 };
  await db.$transaction(async (tx) => {
    await tx.interviewTurn.create({
      data: {
        sessionId: session.id,
        idx: lastTurn.idx + 1,
        questionText: nextQuestion.text,
        pushesUsed: 0,
      },
    });
    await tx.interviewSession.update({
      where: { id: session.id },
      data: { payload: nextPayload as never },
    });
  });
  return { action: "next", question: nextQuestion.text, sessionId: session.id };
}

// D88f: one automatic retry, then the session pauses (answer already saved —
// resuming simply calls advance again).
export async function advanceSession(
  userId: string,
  sessionId: string,
  fetchImpl?: typeof fetch
): Promise<AdvanceResult> {
  const session = await loadSession(userId, sessionId);
  if (session.status !== "active") {
    return { action: "complete", sessionId };
  }
  try {
    return await advanceOnce(session, fetchImpl);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("answer the current")) {
      throw err;
    }
    // one retry on gateway/transport failure, then surface the pause
    return await advanceOnce(await loadSession(userId, sessionId), fetchImpl);
  }
}

export async function submitAnswer(
  userId: string,
  sessionId: string,
  answerText: string,
  telemetry?: { durationMs?: number }
): Promise<void> {
  const trimmed = answerText.trim();
  if (!trimmed) throw new Error("empty answer");
  const session = await loadSession(userId, sessionId);
  if (session.status !== "active") throw new Error("session is not active");
  const lastTurn = session.turns[session.turns.length - 1];
  if (!lastTurn) throw new Error("session has no turns");
  if (lastTurn.answerText !== null) {
    return; // already answered — advance is the retryable half
  }
  await db.interviewTurn.update({
    where: { id: (lastTurn as unknown as { id: string }).id },
    data: {
      answerText: trimmed,
      ...(telemetry?.durationMs !== undefined
        ? { durationMs: Math.max(0, Math.round(telemetry.durationMs)) }
        : {}),
    },
  });
}

// D88f: on resume, if the spine content version changed, regenerate the bank
// (answered turns stay; remaining questions come from the fresh bank).
export async function resumeInterviewSession(
  userId: string,
  sessionId: string,
  fetchImpl?: typeof fetch
): Promise<{ regeneratedBank: boolean }> {
  const session = await loadSession(userId, sessionId);
  if (session.status !== "active") return { regeneratedBank: false };
  const payload = (session.payload ?? {}) as SessionPayloadShape;
  const grounding = payload.grounding ?? {};
  const selection: ScopeSelection = {
    scope:
      session.scope === "portfolio" || session.scope === "application"
        ? session.scope
        : "project",
    projectId: grounding.projectId ?? undefined,
    projectIds: grounding.projectIds ?? undefined,
    jdId: grounding.jdId ?? undefined,
  };
  let currentPack: VisibleSurfacePack;
  try {
    currentPack = await buildPackForScope(userId, selection);
  } catch {
    return { regeneratedBank: false }; // grounding objects vanished; keep bank
  }
  const currentVersion = packContentVersion(currentPack);
  if (payload.contentVersion === currentVersion) {
    return { regeneratedBank: false };
  }
  // Invalidate the stale bank first — a still-cached old bank would
  // short-circuit regeneration inside loadBank.
  if (payload.bankCacheKey) {
    await db.gatewayCache
      .delete({ where: { cacheKey: payload.bankCacheKey } })
      .catch(() => null);
  }
  await loadBank(session, fetchImpl); // version-keyed miss → regeneration + payload update
  return { regeneratedBank: true };
}

// D80: <half answered = abandoned writes nothing later (grading honors this).
export async function sweepAbandonedInterviews(now: Date = new Date()) {
  const days = await getConfig<number>("interview.abandonDays", 7);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const result = await db.interviewSession.updateMany({
    where: { status: "active", startedAt: { lt: cutoff } },
    data: { status: "abandoned", abandonedAt: now },
  });
  return result.count;
}

// D82 tombstone deletion: strip content, mark deleted, evidence stops
// counting (the recompute consults tombstoned sessions), levels fall visibly.
// Event ROWS stay — append-only holds; the log still says an interview
// happened on this date.
export async function deleteInterviewSession(
  userId: string,
  sessionId: string
): Promise<{ affectedSkills: string[] }> {
  const session = await db.interviewSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) throw new Error("session not found");

  const events = await db.eventLog.findMany({
    where: {
      userId,
      type: "interview_completed",
      payload: { path: ["sessionId"], equals: sessionId },
    },
    select: { skills: true },
  });
  const affectedSkills = [...new Set(events.flatMap((e) => e.skills))];

  await db.$transaction(async (tx) => {
    await tx.interviewTurn.deleteMany({ where: { sessionId } });
    await tx.interviewReport.updateMany({
      where: { sessionId },
      data: {
        techDepth: null,
        problemSolving: null,
        tradeoffs: null,
        communication: null,
        composure: null,
        readinessBand: null,
        payload: { deleted: true } as never,
      },
    });
    const payload = {
      ...((session.payload ?? {}) as Record<string, unknown>),
      deletedAt: new Date().toISOString(),
    };
    await tx.interviewSession.update({
      where: { id: sessionId },
      data: { status: "deleted", payload: payload as never },
    });
  });

  for (const skillId of affectedSkills) {
    await recomputeUserSkill(userId, skillId);
  }
  return { affectedSkills };
}
