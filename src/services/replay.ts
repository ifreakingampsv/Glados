import { Prisma } from "@prisma/client";
import { assertAdmin } from "@/lib/auth";
import { db, type User } from "@/lib/db";
import { FeatureDisabledError } from "@/services/gateway";
import {
  computeUserSkillState,
  DEFAULT_BANDS,
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
  getConfig,
  recomputeUserSkill,
  type ScoringConfigOverride,
} from "@/services/levels";

export const REPLAY_WHAT_IF_FLAG = "replay.whatIf";
export const REPLAY_APPLY_FLAG = "replay.apply";

export interface ReplayFeatureFlags {
  whatIfEnabled: boolean;
  applyEnabled: boolean;
}

export interface ReplayCellDiff {
  userId: string;
  skillId: string;
  skillDisplay: string;
  currentScore: number;
  hypotheticalScore: number;
  scoreDelta: number;
  currentRawLevel: number;
  currentLevel: number;
  currentClamped: boolean;
  hypotheticalRawLevel: number;
  hypotheticalLevel: number;
  hypotheticalClamped: boolean;
  levelDelta: number;
  clampPreventedLevelChange: boolean;
}

export interface ReplaySkillDiffRow {
  skillId: string;
  skillDisplay: string;
  userCount: number;
  avgCurrentScore: number;
  avgHypotheticalScore: number;
  avgScoreDelta: number;
  levelChangedUsers: number;
  clampedUsersCurrent: number;
  clampedUsersHypothetical: number;
}

export interface ReplayClampEffectRow {
  userId: string;
  skillId: string;
  skillDisplay: string;
  hypotheticalScore: number;
  unclampedLevel: number;
  clampedLevel: number;
  activeSources: string[];
  reason: string;
}

export interface WhatIfReplayResult {
  candidateConfig: {
    pointsTypes: Record<string, number>;
    sourceWeights: Record<string, number>;
    levelBands: Array<{ level: number; min: number }>;
  };
  totalCellsEvaluated: number;
  perSkillDiffs: ReplaySkillDiffRow[];
  clampEffectRows: ReplayClampEffectRow[];
  cellDiffs: ReplayCellDiff[];
}

export interface ApplyReplayMaintenanceResult {
  rebuiltUserSkillCount: number;
  persistedConfigKeys: string[];
}

export async function getReplayFeatureFlags(): Promise<ReplayFeatureFlags> {
  const [whatIfFlag, applyFlag] = await Promise.all([
    db.featureFlag.findUnique({ where: { key: REPLAY_WHAT_IF_FLAG } }),
    db.featureFlag.findUnique({ where: { key: REPLAY_APPLY_FLAG } }),
  ]);
  return {
    whatIfEnabled: whatIfFlag ? whatIfFlag.enabled : false,
    applyEnabled: applyFlag ? applyFlag.enabled : false,
  };
}

export async function setReplayFeatureFlags(
  actor: User,
  input: {
    whatIfEnabled?: boolean;
    applyEnabled?: boolean;
  }
): Promise<ReplayFeatureFlags> {
  assertAdmin(actor);

  if (typeof input.whatIfEnabled === "boolean") {
    await db.featureFlag.upsert({
      where: { key: REPLAY_WHAT_IF_FLAG },
      update: { enabled: input.whatIfEnabled },
      create: { key: REPLAY_WHAT_IF_FLAG, enabled: input.whatIfEnabled },
    });
  }

  if (typeof input.applyEnabled === "boolean") {
    await db.featureFlag.upsert({
      where: { key: REPLAY_APPLY_FLAG },
      update: { enabled: input.applyEnabled },
      create: { key: REPLAY_APPLY_FLAG, enabled: input.applyEnabled },
    });
  }

  return getReplayFeatureFlags();
}

export async function runWhatIfReplay(
  actor: User,
  candidateConfig: ScoringConfigOverride,
  options: {
    userIds?: string[];
    skillIds?: string[];
    now?: Date;
  } = {}
): Promise<WhatIfReplayResult> {
  assertAdmin(actor);

  const flags = await getReplayFeatureFlags();
  if (!flags.whatIfEnabled) {
    throw new FeatureDisabledError(
      `What-if replay is disabled (${REPLAY_WHAT_IF_FLAG} is off)`
    );
  }

  const now = options.now ?? new Date();

  const [curPoints, curWeights, curBands, skills] = await Promise.all([
    getConfig("points.types", DEFAULT_POINTS),
    getConfig("points.sourceWeights", DEFAULT_SOURCE_WEIGHTS),
    getConfig("levels.bands", DEFAULT_BANDS),
    db.skill.findMany({ select: { id: true, display: true } }),
  ]);

  const skillDisplayById = new Map(skills.map((s) => [s.id, s.display]));

  const mergedCandidatePoints = {
    ...DEFAULT_POINTS,
    ...curPoints,
    ...(candidateConfig.pointsTypes ?? {}),
  };
  const mergedCandidateWeights = {
    ...DEFAULT_SOURCE_WEIGHTS,
    ...curWeights,
    ...(candidateConfig.sourceWeights ?? {}),
  };
  const mergedCandidateBands =
    candidateConfig.levelBands && candidateConfig.levelBands.length > 0
      ? candidateConfig.levelBands
      : curBands;

  const userSkillWhere: {
    userId?: { in: string[] };
    skillId?: { in: string[] };
  } = {};
  if (options.userIds) userSkillWhere.userId = { in: options.userIds };
  if (options.skillIds) userSkillWhere.skillId = { in: options.skillIds };

  const pairs = await db.userSkill.findMany({
    where: userSkillWhere,
    select: { userId: true, skillId: true },
  });

  const cellDiffs: ReplayCellDiff[] = [];
  const clampEffectRows: ReplayClampEffectRow[] = [];

  for (const pair of pairs) {
    const [currentState, hypotheticalState] = await Promise.all([
      computeUserSkillState(pair.userId, pair.skillId, now, {
        pointsTypes: curPoints,
        sourceWeights: curWeights,
        levelBands: curBands,
      }),
      computeUserSkillState(pair.userId, pair.skillId, now, {
        pointsTypes: mergedCandidatePoints,
        sourceWeights: mergedCandidateWeights,
        levelBands: mergedCandidateBands,
      }),
    ]);

    const skillDisplay = skillDisplayById.get(pair.skillId) ?? pair.skillId;
    const currentScore = Number(currentState.score.toFixed(4));
    const hypotheticalScore = Number(hypotheticalState.score.toFixed(4));
    const scoreDelta = Number(
      (hypotheticalState.score - currentState.score).toFixed(4)
    );
    const levelDelta = hypotheticalState.level - currentState.level;
    const clampPreventedLevelChange =
      hypotheticalState.clamped &&
      hypotheticalState.rawLevel !== hypotheticalState.level;

    cellDiffs.push({
      userId: pair.userId,
      skillId: pair.skillId,
      skillDisplay,
      currentScore,
      hypotheticalScore,
      scoreDelta,
      currentRawLevel: currentState.rawLevel,
      currentLevel: currentState.level,
      currentClamped: currentState.clamped,
      hypotheticalRawLevel: hypotheticalState.rawLevel,
      hypotheticalLevel: hypotheticalState.level,
      hypotheticalClamped: hypotheticalState.clamped,
      levelDelta,
      clampPreventedLevelChange,
    });

    if (hypotheticalState.clamped) {
      clampEffectRows.push({
        userId: pair.userId,
        skillId: pair.skillId,
        skillDisplay,
        hypotheticalScore,
        unclampedLevel: hypotheticalState.rawLevel,
        clampedLevel: hypotheticalState.level,
        activeSources: hypotheticalState.activeBuckets,
        reason: `Score ${hypotheticalScore.toFixed(1)} reaches L${hypotheticalState.rawLevel}, clamped at L${hypotheticalState.level} by single-source corroboration cap (${hypotheticalState.activeBuckets.join(", ") || "single source"}).`,
      });
    }
  }

  // Group into per-skill summary rows
  const bySkill = new Map<string, ReplayCellDiff[]>();
  for (const cell of cellDiffs) {
    const list = bySkill.get(cell.skillId) ?? [];
    list.push(cell);
    bySkill.set(cell.skillId, list);
  }

  const perSkillDiffs: ReplaySkillDiffRow[] = [];
  for (const [skillId, cells] of bySkill.entries()) {
    const count = cells.length;
    const curSum = cells.reduce((s, c) => s + c.currentScore, 0);
    const hypSum = cells.reduce((s, c) => s + c.hypotheticalScore, 0);
    const avgCurrentScore = Number((curSum / count).toFixed(2));
    const avgHypotheticalScore = Number((hypSum / count).toFixed(2));
    const avgScoreDelta = Number(((hypSum - curSum) / count).toFixed(2));
    const levelChangedUsers = cells.filter((c) => c.levelDelta !== 0).length;
    const clampedUsersCurrent = cells.filter((c) => c.currentClamped).length;
    const clampedUsersHypothetical = cells.filter(
      (c) => c.hypotheticalClamped
    ).length;

    perSkillDiffs.push({
      skillId,
      skillDisplay: skillDisplayById.get(skillId) ?? skillId,
      userCount: count,
      avgCurrentScore,
      avgHypotheticalScore,
      avgScoreDelta,
      levelChangedUsers,
      clampedUsersCurrent,
      clampedUsersHypothetical,
    });
  }

  perSkillDiffs.sort(
    (a, b) =>
      Math.abs(b.avgScoreDelta) - Math.abs(a.avgScoreDelta) ||
      b.levelChangedUsers - a.levelChangedUsers
  );

  return {
    candidateConfig: {
      pointsTypes: mergedCandidatePoints,
      sourceWeights: mergedCandidateWeights,
      levelBands: mergedCandidateBands,
    },
    totalCellsEvaluated: cellDiffs.length,
    perSkillDiffs,
    clampEffectRows,
    cellDiffs,
  };
}

// D47 / D68: Guarded maintenance job that persists the tuned config rows and
// runs a bulk user_skills rebuild (the decay-sweep pattern) explicitly outside
// the per-event appendEvent path. Never writes event_log rows.
export async function applyReplayMaintenanceJob(
  actor: User,
  candidateConfig: ScoringConfigOverride,
  options: {
    userIds?: string[];
    skillIds?: string[];
    now?: Date;
  } = {}
): Promise<ApplyReplayMaintenanceResult> {
  assertAdmin(actor);

  const flags = await getReplayFeatureFlags();
  if (!flags.applyEnabled) {
    throw new FeatureDisabledError(
      `Replay apply is disabled (${REPLAY_APPLY_FLAG} is off)`
    );
  }

  const now = options.now ?? new Date();
  const persistedConfigKeys: string[] = [];

  if (candidateConfig.pointsTypes) {
    const existing = await getConfig("points.types", DEFAULT_POINTS);
    const merged = {
      ...DEFAULT_POINTS,
      ...existing,
      ...candidateConfig.pointsTypes,
    };
    await db.config.upsert({
      where: { key: "points.types" },
      update: { value: merged as Prisma.InputJsonValue },
      create: { key: "points.types", value: merged as Prisma.InputJsonValue },
    });
    persistedConfigKeys.push("points.types");
  }

  if (candidateConfig.sourceWeights) {
    const existing = await getConfig(
      "points.sourceWeights",
      DEFAULT_SOURCE_WEIGHTS
    );
    const merged = {
      ...DEFAULT_SOURCE_WEIGHTS,
      ...existing,
      ...candidateConfig.sourceWeights,
    };
    await db.config.upsert({
      where: { key: "points.sourceWeights" },
      update: { value: merged as Prisma.InputJsonValue },
      create: {
        key: "points.sourceWeights",
        value: merged as Prisma.InputJsonValue,
      },
    });
    persistedConfigKeys.push("points.sourceWeights");
  }

  if (candidateConfig.levelBands && candidateConfig.levelBands.length > 0) {
    await db.config.upsert({
      where: { key: "levels.bands" },
      update: { value: candidateConfig.levelBands as Prisma.InputJsonValue },
      create: {
        key: "levels.bands",
        value: candidateConfig.levelBands as Prisma.InputJsonValue,
      },
    });
    persistedConfigKeys.push("levels.bands");
  }

  const userSkillWhere: {
    userId?: { in: string[] };
    skillId?: { in: string[] };
  } = {};
  if (options.userIds) userSkillWhere.userId = { in: options.userIds };
  if (options.skillIds) userSkillWhere.skillId = { in: options.skillIds };

  const rows = await db.userSkill.findMany({
    where: userSkillWhere,
    select: { userId: true, skillId: true },
  });

  for (const row of rows) {
    await recomputeUserSkill(row.userId, row.skillId, now);
  }

  return {
    rebuiltUserSkillCount: rows.length,
    persistedConfigKeys,
  };
}
