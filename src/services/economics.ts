import { assertAdmin } from "@/lib/auth";
import { db, type User } from "@/lib/db";
import { getJdSoftCap } from "@/services/jd";
import { getConfig } from "@/services/levels";
import { DEFAULT_ECONOMICS_ASSUMPTIONS } from "@/services/seed-config";

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

export interface AdminEvidenceReadouts {
  levelDistribution: SkillLevelDistributionRow[];
  sourceMix: SourceMixRow[];
  evidenceVsQuizDivergence: {
    rows: Array<{
      skillId: string;
      skillDisplay: string;
      evidencedLevel: number;
      quizLevel: number;
    }>;
    note: string;
  };
  topMovers: TopMoverRow[];
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

  // Estimate ~1.5k tokens per parse/extract call and ~2.0k tokens per review call
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

  const [userSkills, skills, events] = await Promise.all([
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

  // 3. Top movers
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
      rows: [],
      note: "Renders empty until S1.5 skill quizzes and calibration banks land.",
    },
    topMovers,
  };
}
