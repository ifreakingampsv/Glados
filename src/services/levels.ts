import { db, type Config, type UserSkill } from "@/lib/db";
import { resolveSkillId } from "@/lib/skill-resolution";

// Bands + point tables are CONFIG ROWS (D28 philosophy), seeded by db:seed.
export const DEFAULT_BANDS = [
  { level: 0, min: 0 },
  { level: 1, min: 5 },
  { level: 2, min: 20 },
  { level: 3, min: 50 },
  { level: 4, min: 100 },
  { level: 5, min: 200 },
];

export const DEFAULT_POINTS: Record<string, number> = {
  skill_tagged: 0,
  project_added: 0,
  manual_evidence: 3,
  interview_passed: 10,
  quiz_completed: 2,
  system_adjustment: 0,
  repo_imported: 5,
  work_experience_added: 4,
  work_experience_confirmed: 2,
  resume_imported: 0,
  certificate_added: 5,
  post_drafted: 0,
};

export const DEFAULT_SOURCE_WEIGHTS: Record<string, number> = {
  web: 1,
  system: 1,
  agent_plugin: 0.5,
  extension: 0.5,
};

// D46(5) / D78a: Structural cap — single-source evidence from cap-limited
// buckets cannot exceed L3 until a second source type corroborates.
export const CORROBORATION_CAP_LEVEL = 3;

export type EvidenceSourceBucket =
  "repo" | "work_experience" | "certificate" | "quiz" | "interview";

export function classifyEventSourceBucket(
  type: string
): EvidenceSourceBucket | null {
  switch (type) {
    case "repo_imported":
    case "manual_evidence":
      return "repo";
    case "work_experience_added":
    case "work_experience_confirmed":
      return "work_experience";
    case "certificate_added":
      return "certificate";
    case "quiz_completed":
      return "quiz";
    case "interview_passed":
      return "interview";
    default:
      return null;
  }
}

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row: Config | null = await db.config.findUnique({ where: { key } });
  return (row?.value as T) ?? fallback;
}

export function scoreForEvents(
  events: Array<{ points: number; occurredAt: Date }>,
  now: Date = new Date()
): number {
  return events.reduce((score, event) => {
    const ageDays = Math.max(
      0,
      (now.getTime() - event.occurredAt.getTime()) / 86_400_000
    );
    return score + event.points * Math.pow(0.5, ageDays / 90);
  }, 0);
}

export function levelForScoreWithBands(
  score: number,
  bands: Array<{ level: number; min: number }>
): number {
  let level = 0;
  for (const band of bands) {
    if (score >= band.min) level = band.level;
  }
  return level;
}

export async function levelForScore(score: number): Promise<number> {
  const bands = await getConfig("levels.bands", DEFAULT_BANDS);
  return levelForScoreWithBands(score, bands);
}

export function computeCorroboratedLevel(
  rawLevel: number,
  events: Array<{ type: string; points: number; occurredAt: Date }>,
  now: Date = new Date()
): {
  level: number;
  clamped: boolean;
  activeBuckets: EvidenceSourceBucket[];
} {
  const byBucket = new Map<
    EvidenceSourceBucket,
    Array<{ points: number; occurredAt: Date }>
  >();

  for (const ev of events) {
    const bucket = classifyEventSourceBucket(ev.type);
    if (!bucket) continue;
    const list = byBucket.get(bucket) ?? [];
    list.push({ points: ev.points, occurredAt: ev.occurredAt });
    byBucket.set(bucket, list);
  }

  const activeBuckets: EvidenceSourceBucket[] = [];
  for (const [bucket, bucketEvents] of byBucket.entries()) {
    const bucketScore = scoreForEvents(bucketEvents, now);
    if (bucketScore > 1e-9) {
      activeBuckets.push(bucket);
    }
  }

  const hasUncappedSource = activeBuckets.includes("interview");
  const isCorroborated = hasUncappedSource || activeBuckets.length >= 2;

  if (!isCorroborated && rawLevel > CORROBORATION_CAP_LEVEL) {
    return {
      level: CORROBORATION_CAP_LEVEL,
      clamped: true,
      activeBuckets,
    };
  }

  return {
    level: rawLevel,
    clamped: false,
    activeBuckets,
  };
}

export async function getReferencedSkillIds(
  skillId: string
): Promise<string[]> {
  const canonicalId = await resolveSkillId(skillId);

  // Event rows store the skill id AT WRITE TIME (D33b): rows referencing
  // retired ids that merge into this canonical skill still count, so collect
  // the transitive alias closure and match against all of them.
  const referencedIds = [canonicalId];
  let frontier = [canonicalId];
  while (frontier.length > 0) {
    const retired = await db.skill.findMany({
      where: { aliasOfId: { in: frontier } },
      select: { id: true },
    });
    frontier = retired
      .map((r) => r.id)
      .filter((id) => !referencedIds.includes(id));
    referencedIds.push(...frontier);
  }
  return referencedIds;
}

export async function getDecayedQuizContribution(
  userId: string,
  skillId: string,
  now: Date = new Date()
): Promise<number> {
  const referencedIds = await getReferencedSkillIds(skillId);
  const quizEvents = await db.eventLog.findMany({
    where: {
      userId,
      type: "quiz_completed",
      skills: { hasSome: referencedIds },
    },
    select: { points: true, occurredAt: true },
  });
  return Math.max(0, scoreForEvents(quizEvents, now));
}

export function clampQuizDelta(
  rawDelta: number,
  currentDecayedQuizScore: number
): number {
  const rounded = Math.round(rawDelta);
  if (rounded >= 0) return rounded;
  const maxNegativeFloor = -Math.floor(
    Math.max(0, currentDecayedQuizScore) + 1e-9
  );
  return Math.max(rounded, maxNegativeFloor);
}

export async function clampQuizDeltaForSkill(
  userId: string,
  skillId: string,
  rawDelta: number,
  now: Date = new Date()
): Promise<number> {
  const decayedQuiz = await getDecayedQuizContribution(userId, skillId, now);
  return clampQuizDelta(rawDelta, decayedQuiz);
}

export interface ScoringConfigOverride {
  pointsTypes?: Record<string, number>;
  sourceWeights?: Record<string, number>;
  levelBands?: Array<{ level: number; min: number }>;
}

export interface ComputedUserSkillState {
  canonicalSkillId: string;
  score: number;
  rawLevel: number;
  level: number;
  clamped: boolean;
  activeBuckets: EvidenceSourceBucket[];
  lastEvidencedAt: Date | null;
}

export function effectiveEventPointsUnderConfig(
  ev: { type: string; source: string; points: number },
  pointsTypes: Record<string, number>,
  sourceWeights: Record<string, number>
): number {
  if (ev.points === 0) return 0;
  // Signed-delta quiz events carry session-specific raw deltas; scale only if sourceWeight changed
  if (ev.type === "quiz_completed") {
    const defSw = DEFAULT_SOURCE_WEIGHTS[ev.source] ?? 1;
    const curSw = sourceWeights[ev.source] ?? defSw;
    return defSw > 0 ? ev.points * (curSw / defSw) : ev.points;
  }

  const defBase =
    (DEFAULT_POINTS[ev.type] ?? 0) * (DEFAULT_SOURCE_WEIGHTS[ev.source] ?? 1);
  const cfgBase =
    (pointsTypes[ev.type] ?? DEFAULT_POINTS[ev.type] ?? 0) *
    (sourceWeights[ev.source] ?? DEFAULT_SOURCE_WEIGHTS[ev.source] ?? 1);

  if (defBase > 0) {
    if (Math.abs(ev.points - Math.round(defBase)) < 1e-9) {
      return Math.round(cfgBase);
    }
    return ev.points * (cfgBase / defBase);
  }
  return ev.points;
}

export async function computeUserSkillState(
  userId: string,
  skillId: string,
  now: Date = new Date(),
  override?: ScoringConfigOverride
): Promise<ComputedUserSkillState> {
  const referencedIds = await getReferencedSkillIds(skillId);
  const canonicalSkillId = referencedIds[0];

  const [events, dbPointsTypes, dbSourceWeights, dbBands] = await Promise.all([
    db.eventLog.findMany({
      where: { userId, skills: { hasSome: referencedIds } },
      select: { type: true, source: true, points: true, occurredAt: true },
    }),
    override?.pointsTypes
      ? Promise.resolve(override.pointsTypes)
      : getConfig("points.types", DEFAULT_POINTS),
    override?.sourceWeights
      ? Promise.resolve(override.sourceWeights)
      : getConfig("points.sourceWeights", DEFAULT_SOURCE_WEIGHTS),
    override?.levelBands
      ? Promise.resolve(override.levelBands)
      : getConfig("levels.bands", DEFAULT_BANDS),
  ]);

  const pointsTypes = { ...DEFAULT_POINTS, ...dbPointsTypes };
  const sourceWeights = { ...DEFAULT_SOURCE_WEIGHTS, ...dbSourceWeights };
  const bands = dbBands.length > 0 ? dbBands : DEFAULT_BANDS;

  const adjustedEvents = events.map((ev) => ({
    type: ev.type,
    points: effectiveEventPointsUnderConfig(ev, pointsTypes, sourceWeights),
    occurredAt: ev.occurredAt,
  }));

  const score = Math.max(0, scoreForEvents(adjustedEvents, now));
  const rawLevel = levelForScoreWithBands(score, bands);
  const { level, clamped, activeBuckets } = computeCorroboratedLevel(
    rawLevel,
    adjustedEvents,
    now
  );
  const lastEvidencedAt = events.reduce<Date | null>(
    (latest, event) =>
      !latest || event.occurredAt > latest ? event.occurredAt : latest,
    null
  );

  return {
    canonicalSkillId,
    score,
    rawLevel,
    level,
    clamped,
    activeBuckets,
    lastEvidencedAt,
  };
}

// THE single writer (D24): rebuilds one user_skills row purely from the log —
// replay-safe, decay included, merged skill ids resolved to canonical first.
export async function recomputeUserSkill(
  userId: string,
  skillId: string,
  now: Date = new Date()
): Promise<UserSkill> {
  const state = await computeUserSkillState(userId, skillId, now);
  return db.userSkill.upsert({
    where: {
      userId_skillId: { userId, skillId: state.canonicalSkillId },
    },
    update: {
      score: state.score,
      level: state.level,
      lastEvidencedAt: state.lastEvidencedAt,
    },
    create: {
      userId,
      skillId: state.canonicalSkillId,
      score: state.score,
      level: state.level,
      lastEvidencedAt: state.lastEvidencedAt,
    },
  });
}

// T10: the nightly sweep — quiet users' levels decay even with no new events.
// Same single-writer path as appendEvent's recompute; the cron route is a
// thin wrapper around this.
export async function runDecaySweep(now: Date = new Date()): Promise<number> {
  const rows = await db.userSkill.findMany({
    select: { userId: true, skillId: true },
  });
  for (const row of rows) {
    await recomputeUserSkill(row.userId, row.skillId, now);
  }
  return rows.length;
}
