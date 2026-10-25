import { assertAdmin } from "@/lib/auth";
import { db, type User } from "@/lib/db";
import { getJdSoftCap } from "@/services/jd";
import { getConfig } from "@/services/levels";
import {
  listAdminBankSpotReviewQueue,
  normalizeQuizBand,
  type SpotReviewQueueItem,
  type QuizBand,
} from "@/services/quiz-banks";
import {
  DEFAULT_ECONOMICS_ASSUMPTIONS,
  DEFAULT_TELEMETRY_ALERT_THRESHOLD,
  DEFAULT_TELEMETRY_MINIMUMS,
} from "@/services/seed-config";

const DAY_MS = 86_400_000;

export interface FeatureDaySpend {
  feature: string;
  date: string;
  calls: number;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface EconomicsAssumptions {
  activeUsers: number;
  scansPerUserPerDay: number;
  reviewsPerUserPerDay: number;
  fixedServerCostUsd: number;
  targetMargin: number;
}

export interface AdminEconomicsDashboard {
  actuals: {
    totalSpendUsd: number;
    totalCalls: number;
    byFeatureDay: FeatureDaySpend[];
  };
  projections: {
    assumptions: EconomicsAssumptions;
    unitCostsByFeature: Record<string, number>;
    projectedMonthlyAiSpendUsd: number;
    fixedServerCostUsd: number;
    totalMonthlyCostUsd: number;
  };
  breakEven: {
    targetMargin: number;
    costPerUserUsd: number;
    priceFloorPerPaidUserUsd: number;
  };
  jdStorage: {
    totalJdCount: number;
    softCapPerUser: number;
  };
}

export interface SkillLevelDistributionRow {
  skillId: string;
  skillDisplay: string;
  levels: Record<number, number>;
  totalUsers: number;
  isFlat: boolean;
}

export interface SourceMixRow {
  type: string;
  source: string;
  count: number;
  totalPoints: number;
}

export interface TopMoverRow {
  userId: string;
  skillId: string;
  skillDisplay: string;
  score: number;
  level: number;
}

export interface DivergenceRow {
  skillId: string;
  skillDisplay: string;
  userCount: number;
  evidencedLevel: number;
  quizLevel: number;
  divergenceDelta: number;
  settledBands: Record<QuizBand, number>;
}

export interface AdminEvidenceReadouts {
  levelDistribution: SkillLevelDistributionRow[];
  sourceMix: SourceMixRow[];
  evidenceVsQuizDivergence: {
    sufficientSample: boolean;
    minimumUsersPerSkill: number;
    rows: DivergenceRow[];
    note: string;
  };
  topMovers: TopMoverRow[];
}

export interface TelemetryMinimumsConfig {
  perQuestionAnswers: number;
  completionSessionsPerBank: number;
  dropOffSessions: number;
  timePerQuestionAnswers: number;
  retakeWindowDays: number;
  divergenceMinUsers: number;
}

export interface AdminQuizTelemetry {
  minimums: TelemetryMinimumsConfig;
  completionRate: {
    sufficientSample: boolean;
    minimumRequired: number;
    statusNote: string;
    hiddenBelowMinimumCount: number;
    rows: Array<{
      skillId: string;
      skillDisplay: string;
      bankVersion: number;
      totalSessions: number;
      completedSessions: number;
      abandonedSessions: number;
      completionRate: number;
    }>;
  };
  dropOffIndex: {
    sufficientSample: boolean;
    minimumRequired: number;
    totalSessionsSampled: number;
    statusNote: string;
    rows: Array<{
      questionIndex: number;
      droppedSessions: number;
      shareOfAbandons: number;
    }>;
  };
  perQuestionSuccess: {
    sufficientSample: boolean;
    minimumRequired: number;
    statusNote: string;
    hiddenBelowMinimumCount: number;
    rows: Array<{
      questionId: string;
      skillId: string;
      skillDisplay: string;
      band: QuizBand;
      prompt: string;
      answerCount: number;
      correctCount: number;
      successRate: number;
      flaggedBroken: boolean;
    }>;
  };
  retakeFrequency: {
    sufficientSample: boolean;
    minimumRequired: number;
    windowDays: number;
    statusNote: string;
    data: {
      totalCompletedSessions: number;
      uniqueSkillTakers: number;
      retakeSessions: number;
      retakeRate: number;
    } | null;
  };
  timePerQuestion: {
    sufficientSample: boolean;
    minimumRequired: number;
    totalAnswersSampled: number;
    statusNote: string;
    overallAvgMs: number | null;
    byBand: Array<{
      band: QuizBand;
      answerCount: number;
      avgMs: number;
    }>;
  };
  brokenQuestionAlerts: Array<{
    questionId: string;
    bankId: string;
    skillId: string;
    skillDisplay: string;
    band: QuizBand;
    prompt: string;
    answerCount: number;
    correctCount: number;
    successRate: number;
  }>;
  spotReviewQueue: SpotReviewQueueItem[];
}

function settledBandToRepresentativeLevel(band: QuizBand): number {
  if (band === "L4-5") return 4.5;
  if (band === "L2-3") return 2.5;
  return 0.5;
}

export async function getTelemetryMinimums(): Promise<TelemetryMinimumsConfig> {
  const raw = await getConfig<Partial<TelemetryMinimumsConfig>>(
    "telemetry.minimums",
    DEFAULT_TELEMETRY_MINIMUMS
  );
  return {
    perQuestionAnswers:
      raw.perQuestionAnswers ?? DEFAULT_TELEMETRY_MINIMUMS.perQuestionAnswers,
    completionSessionsPerBank:
      raw.completionSessionsPerBank ??
      DEFAULT_TELEMETRY_MINIMUMS.completionSessionsPerBank,
    dropOffSessions:
      raw.dropOffSessions ?? DEFAULT_TELEMETRY_MINIMUMS.dropOffSessions,
    timePerQuestionAnswers:
      raw.timePerQuestionAnswers ??
      DEFAULT_TELEMETRY_MINIMUMS.timePerQuestionAnswers,
    retakeWindowDays:
      raw.retakeWindowDays ?? DEFAULT_TELEMETRY_MINIMUMS.retakeWindowDays,
    divergenceMinUsers:
      raw.divergenceMinUsers ?? DEFAULT_TELEMETRY_MINIMUMS.divergenceMinUsers,
  };
}

export async function getAdminEconomicsDashboard(
  actor: User,
  options: { userIds?: string[] } = {}
): Promise<AdminEconomicsDashboard> {
  assertAdmin(actor);

  const userFilter = options.userIds ? { userId: { in: options.userIds } } : {};

  const [
    usageRows,
    rawAssumptions,
    activeRoutes,
    totalJdCount,
    softCapPerUser,
  ] = await Promise.all([
    db.usage.findMany({
      where: {
        via: "platform",
        ...userFilter,
      },
      orderBy: { createdAt: "desc" },
    }),
    getConfig<Partial<EconomicsAssumptions>>(
      "economics.assumptions",
      DEFAULT_ECONOMICS_ASSUMPTIONS
    ),
    db.providerRoute.findMany({
      where: { isActive: true },
    }),
    db.jobDescription.count({
      where: userFilter,
    }),
    getJdSoftCap(),
  ]);

  const byFeatureDayMap = new Map<string, FeatureDaySpend>();
  let totalSpendUsd = 0;

  for (const row of usageRows) {
    totalSpendUsd += row.costUsd;
    const date = row.createdAt.toISOString().slice(0, 10);
    const key = `${row.feature}::${date}`;
    const current = byFeatureDayMap.get(key) ?? {
      feature: row.feature,
      date,
      calls: 0,
      spendUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    current.calls += 1;
    current.spendUsd = Number((current.spendUsd + row.costUsd).toFixed(6));
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    byFeatureDayMap.set(key, current);
  }

  const byFeatureDay = Array.from(byFeatureDayMap.values()).sort(
    (a, b) => b.date.localeCompare(a.date) || a.feature.localeCompare(b.feature)
  );

  const assumptions: EconomicsAssumptions = {
    activeUsers:
      rawAssumptions.activeUsers ?? DEFAULT_ECONOMICS_ASSUMPTIONS.activeUsers,
    scansPerUserPerDay:
      rawAssumptions.scansPerUserPerDay ??
      DEFAULT_ECONOMICS_ASSUMPTIONS.scansPerUserPerDay,
    reviewsPerUserPerDay:
      rawAssumptions.reviewsPerUserPerDay ??
      DEFAULT_ECONOMICS_ASSUMPTIONS.reviewsPerUserPerDay,
    fixedServerCostUsd:
      rawAssumptions.fixedServerCostUsd ??
      DEFAULT_ECONOMICS_ASSUMPTIONS.fixedServerCostUsd,
    targetMargin:
      rawAssumptions.targetMargin ?? DEFAULT_ECONOMICS_ASSUMPTIONS.targetMargin,
  };

  const unitCostsByFeature: Record<string, number> = {};
  for (const r of activeRoutes) {
    const existing = unitCostsByFeature[r.feature];
    if (existing === undefined || r.costPer1kUsd > existing) {
      unitCostsByFeature[r.feature] = r.costPer1kUsd;
    }
  }

  const resumeCostPer1k = unitCostsByFeature["resume_parse"] ?? 0.001;
  const jdCostPer1k = unitCostsByFeature["jd_extract"] ?? 0.001;
  const linkedinCostPer1k = unitCostsByFeature["linkedin_review"] ?? 0.0015;

  const monthlyScanVolume =
    assumptions.activeUsers * assumptions.scansPerUserPerDay * 30;
  const monthlyReviewVolume =
    assumptions.activeUsers * assumptions.reviewsPerUserPerDay * 30;

  const projectedMonthlyAiSpendUsd = Number(
    (
      monthlyScanVolume * (resumeCostPer1k + jdCostPer1k) * 1.5 +
      monthlyReviewVolume * linkedinCostPer1k * 2.0
    ).toFixed(4)
  );

  const fixedServerCostUsd = assumptions.fixedServerCostUsd;
  const totalMonthlyCostUsd = Number(
    (fixedServerCostUsd + projectedMonthlyAiSpendUsd).toFixed(4)
  );

  const costPerUserUsd = Number(
    (totalMonthlyCostUsd / Math.max(1, assumptions.activeUsers)).toFixed(4)
  );
  const marginDenominator = Math.max(0.05, 1 - assumptions.targetMargin);
  const priceFloorPerPaidUserUsd = Number(
    (costPerUserUsd / marginDenominator).toFixed(4)
  );

  return {
    actuals: {
      totalSpendUsd: Number(totalSpendUsd.toFixed(6)),
      totalCalls: usageRows.length,
      byFeatureDay,
    },
    projections: {
      assumptions,
      unitCostsByFeature,
      projectedMonthlyAiSpendUsd,
      fixedServerCostUsd,
      totalMonthlyCostUsd,
    },
    breakEven: {
      targetMargin: assumptions.targetMargin,
      costPerUserUsd,
      priceFloorPerPaidUserUsd,
    },
    jdStorage: {
      totalJdCount,
      softCapPerUser,
    },
  };
}

export async function getAdminEvidenceReadouts(
  actor: User,
  options: { userIds?: string[] } = {}
): Promise<AdminEvidenceReadouts> {
  assertAdmin(actor);

  const userFilter = options.userIds ? { userId: { in: options.userIds } } : {};

  const [userSkills, skills, events, completedSessions, minimums] =
    await Promise.all([
      db.userSkill.findMany({
        where: userFilter,
        orderBy: [{ score: "desc" }, { level: "desc" }],
      }),
      db.skill.findMany({
        select: { id: true, display: true },
      }),
      db.eventLog.findMany({
        where: userFilter,
        orderBy: { occurredAt: "desc" },
      }),
      db.quizSession.findMany({
        where: {
          ...userFilter,
          outcome: "completed",
          bandSettled: { not: null },
        },
        orderBy: { endedAt: "desc" },
      }),
      getTelemetryMinimums(),
    ]);

  const skillDisplayById = new Map(skills.map((s) => [s.id, s.display]));

  // 1. Level distribution per skill
  const distBySkill = new Map<string, SkillLevelDistributionRow>();
  for (const us of userSkills) {
    const display = skillDisplayById.get(us.skillId) ?? us.skillId;
    const row = distBySkill.get(us.skillId) ?? {
      skillId: us.skillId,
      skillDisplay: display,
      levels: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      totalUsers: 0,
      isFlat: true,
    };
    const lvl = Math.max(0, Math.min(5, us.level));
    row.levels[lvl] = (row.levels[lvl] ?? 0) + 1;
    row.totalUsers += 1;
    distBySkill.set(us.skillId, row);
  }

  const levelDistribution = Array.from(distBySkill.values())
    .map((r) => {
      const populatedBands = Object.values(r.levels).filter(
        (c) => c > 0
      ).length;
      return {
        ...r,
        isFlat: populatedBands <= 1,
      };
    })
    .sort((a, b) => b.totalUsers - a.totalUsers);

  // 2. Source mix from EventLog
  const mixMap = new Map<string, SourceMixRow>();
  for (const ev of events) {
    const key = `${ev.type}::${ev.source}`;
    const current = mixMap.get(key) ?? {
      type: ev.type,
      source: ev.source,
      count: 0,
      totalPoints: 0,
    };
    current.count += 1;
    current.totalPoints += ev.points;
    mixMap.set(key, current);
  }
  const sourceMix = Array.from(mixMap.values()).sort(
    (a, b) => b.count - a.count || b.totalPoints - a.totalPoints
  );

  // 3. Evidence-vs-quiz divergence (D68 / D77):
  // Only for skills with >= divergenceMinUsers (default 3) users holding BOTH
  // evidenced UserSkill data and a completed quiz settled band.
  const latestQuizByUserSkill = new Map<string, QuizBand>();
  for (const sess of completedSessions) {
    if (!sess.bandSettled) continue;
    const key = `${sess.userId}::${sess.skillId}`;
    if (!latestQuizByUserSkill.has(key)) {
      latestQuizByUserSkill.set(key, normalizeQuizBand(sess.bandSettled));
    }
  }

  const pairsBySkill = new Map<
    string,
    Array<{ evidencedLevel: number; settledBand: QuizBand }>
  >();

  for (const us of userSkills) {
    const key = `${us.userId}::${us.skillId}`;
    const settledBand = latestQuizByUserSkill.get(key);
    if (!settledBand) continue;
    const list = pairsBySkill.get(us.skillId) ?? [];
    list.push({
      evidencedLevel: us.level,
      settledBand,
    });
    pairsBySkill.set(us.skillId, list);
  }

  const divergenceRows: DivergenceRow[] = [];
  for (const [skillId, pairs] of pairsBySkill.entries()) {
    if (pairs.length < minimums.divergenceMinUsers) {
      continue;
    }
    const settledBands: Record<QuizBand, number> = {
      "L0-1": 0,
      "L2-3": 0,
      "L4-5": 0,
    };
    let evidencedSum = 0;
    let quizSum = 0;
    for (const p of pairs) {
      settledBands[p.settledBand] += 1;
      evidencedSum += p.evidencedLevel;
      quizSum += settledBandToRepresentativeLevel(p.settledBand);
    }
    const evidencedLevel = Number((evidencedSum / pairs.length).toFixed(2));
    const quizLevel = Number((quizSum / pairs.length).toFixed(2));
    const divergenceDelta = Number((evidencedLevel - quizLevel).toFixed(2));

    divergenceRows.push({
      skillId,
      skillDisplay: skillDisplayById.get(skillId) ?? skillId,
      userCount: pairs.length,
      evidencedLevel,
      quizLevel,
      divergenceDelta,
      settledBands,
    });
  }

  divergenceRows.sort(
    (a, b) =>
      Math.abs(b.divergenceDelta) - Math.abs(a.divergenceDelta) ||
      b.userCount - a.userCount
  );

  // 4. Top movers
  const topMovers: TopMoverRow[] = userSkills.slice(0, 10).map((us) => ({
    userId: us.userId,
    skillId: us.skillId,
    skillDisplay: skillDisplayById.get(us.skillId) ?? us.skillId,
    score: Number(us.score.toFixed(2)),
    level: us.level,
  }));

  return {
    levelDistribution,
    sourceMix,
    evidenceVsQuizDivergence: {
      sufficientSample: divergenceRows.length > 0,
      minimumUsersPerSkill: minimums.divergenceMinUsers,
      rows: divergenceRows,
      note:
        divergenceRows.length > 0
          ? `Showing aggregate divergence across ${divergenceRows.length} skill(s) with at least ${minimums.divergenceMinUsers} calibrated users.`
          : `Not enough data yet (requires at least ${minimums.divergenceMinUsers} users holding both evidenced level and S1.5 quiz-settled band per skill).`,
    },
    topMovers,
  };
}

export async function getAdminQuizTelemetry(
  actor: User,
  options: {
    userIds?: string[];
    skillIds?: string[];
    now?: Date;
  } = {}
): Promise<AdminQuizTelemetry> {
  assertAdmin(actor);
  const now = options.now ?? new Date();

  const [minimums, alertCfg, skills] = await Promise.all([
    getTelemetryMinimums(),
    getConfig<{ minAnswers?: number; maxSuccessRate?: number }>(
      "telemetry.alertThreshold",
      DEFAULT_TELEMETRY_ALERT_THRESHOLD
    ),
    db.skill.findMany({ select: { id: true, display: true } }),
  ]);

  const alertMinAnswers =
    alertCfg.minAnswers ?? DEFAULT_TELEMETRY_ALERT_THRESHOLD.minAnswers;
  const alertMaxSuccessRate =
    alertCfg.maxSuccessRate ?? DEFAULT_TELEMETRY_ALERT_THRESHOLD.maxSuccessRate;

  const skillDisplayById = new Map(skills.map((s) => [s.id, s.display]));

  const sessionWhere: {
    userId?: { in: string[] };
    skillId?: { in: string[] };
  } = {};
  if (options.userIds) sessionWhere.userId = { in: options.userIds };
  if (options.skillIds) sessionWhere.skillId = { in: options.skillIds };

  const sessions = await db.quizSession.findMany({
    where: sessionWhere,
    orderBy: { startedAt: "desc" },
  });

  const sessionIds = sessions.map((s) => s.id);
  const answers =
    sessionIds.length > 0
      ? await db.quizAnswer.findMany({
          where: { sessionId: { in: sessionIds } },
        })
      : [];

  const uniqueQuestionIds = Array.from(
    new Set(answers.map((a) => a.questionId))
  );
  const questions =
    uniqueQuestionIds.length > 0
      ? await db.quizQuestion.findMany({
          where: { id: { in: uniqueQuestionIds } },
          include: { bank: true },
        })
      : [];
  const questionById = new Map(questions.map((q) => [q.id, q]));

  // 1. Completion rate per bank (skillId + bankVersion), gated by minimums.completionSessionsPerBank
  const bankSessionStats = new Map<
    string,
    {
      skillId: string;
      bankVersion: number;
      total: number;
      completed: number;
      abandoned: number;
    }
  >();
  for (const s of sessions) {
    if (s.outcome === "in_progress") continue;
    const key = `${s.skillId}::v${s.bankVersion}`;
    const entry = bankSessionStats.get(key) ?? {
      skillId: s.skillId,
      bankVersion: s.bankVersion,
      total: 0,
      completed: 0,
      abandoned: 0,
    };
    entry.total += 1;
    if (s.outcome === "completed") entry.completed += 1;
    if (s.outcome === "abandoned") entry.abandoned += 1;
    bankSessionStats.set(key, entry);
  }

  let hiddenCompletionBanks = 0;
  const completionRows: AdminQuizTelemetry["completionRate"]["rows"] = [];
  for (const entry of bankSessionStats.values()) {
    if (entry.total < minimums.completionSessionsPerBank) {
      hiddenCompletionBanks += 1;
      continue;
    }
    completionRows.push({
      skillId: entry.skillId,
      skillDisplay: skillDisplayById.get(entry.skillId) ?? entry.skillId,
      bankVersion: entry.bankVersion,
      totalSessions: entry.total,
      completedSessions: entry.completed,
      abandonedSessions: entry.abandoned,
      completionRate: Number((entry.completed / entry.total).toFixed(4)),
    });
  }

  // 2. Drop-off question index, gated by minimums.dropOffSessions
  const finishedOrAbandonedSessions = sessions.filter(
    (s) => s.outcome === "completed" || s.outcome === "abandoned"
  );
  const dropOffSufficient =
    finishedOrAbandonedSessions.length >= minimums.dropOffSessions;
  const dropOffRows: AdminQuizTelemetry["dropOffIndex"]["rows"] = [];

  if (dropOffSufficient) {
    const abandoned = finishedOrAbandonedSessions.filter(
      (s) => s.outcome === "abandoned"
    );
    const totalAbandoned = Math.max(1, abandoned.length);
    const byIndex = new Map<number, number>();
    for (const s of abandoned) {
      const idx = Math.max(1, s.questionsAsked);
      byIndex.set(idx, (byIndex.get(idx) ?? 0) + 1);
    }
    for (const [questionIndex, droppedSessions] of Array.from(
      byIndex.entries()
    ).sort(([a], [b]) => a - b)) {
      dropOffRows.push({
        questionIndex,
        droppedSessions,
        shareOfAbandons: Number((droppedSessions / totalAbandoned).toFixed(4)),
      });
    }
  }

  // 3. Per-question success rate (gated by minimums.perQuestionAnswers) + Broken-question alert (>= 20 answers & < 20% success)
  const questionStats = new Map<
    string,
    {
      questionId: string;
      bankId: string;
      skillId: string;
      band: QuizBand;
      prompt: string;
      tags: string[];
      answerCount: number;
      correctCount: number;
    }
  >();

  for (const ans of answers) {
    const q = questionById.get(ans.questionId);
    if (!q) continue;
    const entry = questionStats.get(q.id) ?? {
      questionId: q.id,
      bankId: q.bankId,
      skillId: q.bank.skillId,
      band: normalizeQuizBand(q.bank.band),
      prompt: q.prompt,
      tags: q.tags,
      answerCount: 0,
      correctCount: 0,
    };
    entry.answerCount += 1;
    if (ans.correct) entry.correctCount += 1;
    questionStats.set(q.id, entry);
  }

  let hiddenQuestionsBelowMin = 0;
  const perQuestionRows: AdminQuizTelemetry["perQuestionSuccess"]["rows"] = [];
  const brokenQuestionAlerts: AdminQuizTelemetry["brokenQuestionAlerts"] = [];

  for (const stat of questionStats.values()) {
    const successRate = Number(
      (stat.correctCount / stat.answerCount).toFixed(4)
    );
    const isBroken =
      stat.answerCount >= alertMinAnswers && successRate < alertMaxSuccessRate;

    if (isBroken) {
      // Auto-flag into spot-review queue if not already tagged
      if (!stat.tags.includes("alert:broken")) {
        await db.quizQuestion.update({
          where: { id: stat.questionId },
          data: { tags: [...stat.tags, "alert:broken"] },
        });
      }
      brokenQuestionAlerts.push({
        questionId: stat.questionId,
        bankId: stat.bankId,
        skillId: stat.skillId,
        skillDisplay: skillDisplayById.get(stat.skillId) ?? stat.skillId,
        band: stat.band,
        prompt: stat.prompt,
        answerCount: stat.answerCount,
        correctCount: stat.correctCount,
        successRate,
      });
    }

    if (stat.answerCount < minimums.perQuestionAnswers) {
      hiddenQuestionsBelowMin += 1;
      continue;
    }

    perQuestionRows.push({
      questionId: stat.questionId,
      skillId: stat.skillId,
      skillDisplay: skillDisplayById.get(stat.skillId) ?? stat.skillId,
      band: stat.band,
      prompt: stat.prompt,
      answerCount: stat.answerCount,
      correctCount: stat.correctCount,
      successRate,
      flaggedBroken: isBroken || stat.tags.includes("alert:broken"),
    });
  }

  perQuestionRows.sort(
    (a, b) => a.successRate - b.successRate || b.answerCount - a.answerCount
  );

  // 4. Retake frequency over 30-day window (gated by minimums.completionSessionsPerBank)
  const windowStart = new Date(
    now.getTime() - minimums.retakeWindowDays * DAY_MS
  );
  const completedInWindow = sessions.filter(
    (s) =>
      s.outcome === "completed" &&
      (s.endedAt ?? s.startedAt).getTime() >= windowStart.getTime() &&
      (s.endedAt ?? s.startedAt).getTime() <= now.getTime()
  );

  const retakeSufficient =
    completedInWindow.length >= minimums.completionSessionsPerBank;
  let retakeData: AdminQuizTelemetry["retakeFrequency"]["data"] = null;
  if (retakeSufficient) {
    const countsByUserSkill = new Map<string, number>();
    for (const s of completedInWindow) {
      const k = `${s.userId}::${s.skillId}`;
      countsByUserSkill.set(k, (countsByUserSkill.get(k) ?? 0) + 1);
    }
    let retakeSessions = 0;
    for (const c of countsByUserSkill.values()) {
      if (c > 1) retakeSessions += c - 1;
    }
    retakeData = {
      totalCompletedSessions: completedInWindow.length,
      uniqueSkillTakers: countsByUserSkill.size,
      retakeSessions,
      retakeRate: Number(
        (retakeSessions / completedInWindow.length).toFixed(4)
      ),
    };
  }

  // 5. Time per question (gated by minimums.timePerQuestionAnswers)
  const timeSufficient = answers.length >= minimums.timePerQuestionAnswers;
  let overallAvgMs: number | null = null;
  const byBandRows: AdminQuizTelemetry["timePerQuestion"]["byBand"] = [];

  if (timeSufficient) {
    let totalMs = 0;
    const bandTotals = new Map<QuizBand, { count: number; ms: number }>();
    for (const ans of answers) {
      const band = normalizeQuizBand(ans.band);
      totalMs += ans.ms;
      const cur = bandTotals.get(band) ?? { count: 0, ms: 0 };
      cur.count += 1;
      cur.ms += ans.ms;
      bandTotals.set(band, cur);
    }
    overallAvgMs = Math.round(totalMs / answers.length);
    for (const [band, stat] of bandTotals.entries()) {
      byBandRows.push({
        band,
        answerCount: stat.count,
        avgMs: Math.round(stat.ms / stat.count),
      });
    }
  }

  const spotReviewQueue = await listAdminBankSpotReviewQueue(actor);

  return {
    minimums,
    completionRate: {
      sufficientSample: completionRows.length > 0,
      minimumRequired: minimums.completionSessionsPerBank,
      statusNote:
        completionRows.length > 0
          ? `Showing ${completionRows.length} bank(s) with at least ${minimums.completionSessionsPerBank} sessions.`
          : `Not enough data (requires at least ${minimums.completionSessionsPerBank} sessions per bank).`,
      hiddenBelowMinimumCount: hiddenCompletionBanks,
      rows: completionRows,
    },
    dropOffIndex: {
      sufficientSample: dropOffSufficient,
      minimumRequired: minimums.dropOffSessions,
      totalSessionsSampled: finishedOrAbandonedSessions.length,
      statusNote: dropOffSufficient
        ? `Showing drop-off distribution across ${finishedOrAbandonedSessions.length} sessions.`
        : `Not enough data (requires at least ${minimums.dropOffSessions} sessions; currently ${finishedOrAbandonedSessions.length}).`,
      rows: dropOffRows,
    },
    perQuestionSuccess: {
      sufficientSample: perQuestionRows.length > 0,
      minimumRequired: minimums.perQuestionAnswers,
      statusNote:
        perQuestionRows.length > 0
          ? `Showing ${perQuestionRows.length} question(s) with at least ${minimums.perQuestionAnswers} answers.`
          : `Not enough data (requires at least ${minimums.perQuestionAnswers} answers per question).`,
      hiddenBelowMinimumCount: hiddenQuestionsBelowMin,
      rows: perQuestionRows,
    },
    retakeFrequency: {
      sufficientSample: retakeSufficient,
      minimumRequired: minimums.completionSessionsPerBank,
      windowDays: minimums.retakeWindowDays,
      statusNote: retakeSufficient
        ? `Showing retake rate over the last ${minimums.retakeWindowDays} days.`
        : `Not enough data (requires at least ${minimums.completionSessionsPerBank} completed sessions in the last ${minimums.retakeWindowDays} days).`,
      data: retakeData,
    },
    timePerQuestion: {
      sufficientSample: timeSufficient,
      minimumRequired: minimums.timePerQuestionAnswers,
      totalAnswersSampled: answers.length,
      statusNote: timeSufficient
        ? `Showing average duration across ${answers.length} recorded answers.`
        : `Not enough data (requires at least ${minimums.timePerQuestionAnswers} answers; currently ${answers.length}).`,
      overallAvgMs,
      byBand: byBandRows,
    },
    brokenQuestionAlerts,
    spotReviewQueue,
  };
}
