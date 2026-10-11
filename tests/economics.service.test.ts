import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type Skill, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { appendEvent } from "@/services/events";
import { createJobDescription } from "@/services/jd";
import {
  getAdminEconomicsDashboard,
  getAdminEvidenceReadouts,
} from "@/services/economics";

describe("Admin economics dashboard & evidence readouts service (T16: actuals by feature/day, routing-table projections, break-even price floor, level distribution, source mix, divergence placeholder, top movers, JD count)", () => {
  let admin: User;
  let regularUser: User;
  let tsSkill: Skill;
  let pgSkill: Skill;
  const marker = `t16_econ_${Date.now()}`;

  beforeAll(async () => {
    process.env.PLATFORM_GOOGLE_API_KEY = "test-google-key-t16";

    await seedConfig();
    await seedRoutes();
    await seedCanonicalSkills();

    [admin, regularUser] = await Promise.all([
      db.user.create({
        data: { clerkId: `${marker}_admin`, role: "ADMIN" },
      }),
      db.user.create({
        data: { clerkId: `${marker}_user`, role: "USER" },
      }),
    ]);

    const [ts, pg] = await Promise.all([
      db.skill.findUniqueOrThrow({ where: { name: "typescript" } }),
      db.skill.findUniqueOrThrow({ where: { name: "postgresql" } }),
    ]);
    tsSkill = ts;
    pgSkill = pg;

    // Seed evidence events and JD for readouts
    await appendEvent({
      userId: regularUser.id,
      source: "web",
      type: "repo_imported",
      skills: [tsSkill.id, pgSkill.id],
      payload: { repo: "ada/engine" },
    });
    await appendEvent({
      userId: regularUser.id,
      source: "web",
      type: "work_experience_added",
      skills: [tsSkill.id],
      payload: { employer: "Analytical Engine Corp" },
      pointsOverride: 6,
    });

    await createJobDescription(
      regularUser.id,
      {
        title: "Senior Backend Engineer",
        rawText: "TypeScript and PostgreSQL distributed systems.",
      },
      {
        skipDailyCap: true,
        gatewayFetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      title: "Senior Backend Engineer",
                      requirements: [
                        { name: "TypeScript", expectedLevel: 3 },
                        { name: "PostgreSQL", expectedLevel: 3 },
                      ],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 40 },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          ),
      }
    );

    // Reset Usage rows for regularUser and seed exact actuals fixture
    await db.usage.deleteMany({ where: { userId: regularUser.id } });
    await db.usage.createMany({
      data: [
        {
          userId: regularUser.id,
          feature: "resume_parse",
          provider: "google",
          model: "gemini-2.0-flash",
          inputTokens: 1200,
          outputTokens: 600,
          costUsd: 0.0018,
          via: "platform",
        },
        {
          userId: regularUser.id,
          feature: "jd_extract",
          provider: "google",
          model: "gemini-2.0-flash",
          inputTokens: 800,
          outputTokens: 400,
          costUsd: 0.0012,
          via: "platform",
        },
        {
          userId: regularUser.id,
          feature: "linkedin_review",
          provider: "google",
          model: "gemini-2.0-flash",
          inputTokens: 1500,
          outputTokens: 900,
          costUsd: 0.0036,
          via: "platform",
        },
      ],
    });
  });

  afterAll(async () => {
    await db.providerRoute.deleteMany({ where: { feature: "smoke" } });
    await db.gatewayCache.deleteMany({ where: { feature: "jd_extract" } });
    await db.jobDescription.deleteMany({ where: { userId: regularUser.id } });
    await db.eventLog.deleteMany({ where: { userId: regularUser.id } });
    await db.userSkill.deleteMany({ where: { userId: regularUser.id } });
    await db.usage.deleteMany({ where: { userId: regularUser.id } });
    await db.dailyCounter.deleteMany({ where: { userId: regularUser.id } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("enforces assertAdmin on both economics and evidence readout services", async () => {
    await expect(getAdminEconomicsDashboard(regularUser)).rejects.toThrow(
      /forbidden/i
    );
    await expect(getAdminEvidenceReadouts(regularUser)).rejects.toThrow(
      /forbidden/i
    );
  });

  it("computes actual spend by feature/day, routing-table projections, fixed server cost, break-even price floor, and JD storage count", async () => {
    const dashboard = await getAdminEconomicsDashboard(admin, {
      userIds: [regularUser.id],
    });

    // 1. Actuals
    expect(dashboard.actuals.totalSpendUsd).toBeCloseTo(0.0066, 5);
    expect(dashboard.actuals.totalCalls).toBe(3);
    expect(dashboard.actuals.byFeatureDay.length).toBeGreaterThanOrEqual(3);

    const resumeRow = dashboard.actuals.byFeatureDay.find(
      (r) => r.feature === "resume_parse"
    );
    expect(resumeRow).toBeDefined();
    expect(resumeRow?.spendUsd).toBeCloseTo(0.0018, 5);
    expect(resumeRow?.calls).toBe(1);

    // 2. Projections from config assumptions x routing-table unit costs
    expect(dashboard.projections.assumptions.activeUsers).toBeGreaterThan(0);
    expect(dashboard.projections.fixedServerCostUsd).toBeGreaterThanOrEqual(5);
    expect(dashboard.projections.projectedMonthlyAiSpendUsd).toBeGreaterThan(0);
    expect(dashboard.projections.totalMonthlyCostUsd).toBeCloseTo(
      dashboard.projections.fixedServerCostUsd +
        dashboard.projections.projectedMonthlyAiSpendUsd,
      4
    );

    // 3. Break-even price floor at target margin
    expect(dashboard.breakEven.targetMargin).toBeGreaterThan(0);
    expect(dashboard.breakEven.costPerUserUsd).toBeGreaterThan(0);
    expect(dashboard.breakEven.priceFloorPerPaidUserUsd).toBeGreaterThan(
      dashboard.breakEven.costPerUserUsd
    );

    // 4. D61 JD storage watch count
    expect(dashboard.jdStorage.totalJdCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.jdStorage.softCapPerUser).toBeGreaterThanOrEqual(20);
  });

  it("computes evidence readouts: level distribution, source mix, empty quiz divergence placeholder, and top movers", async () => {
    const readouts = await getAdminEvidenceReadouts(admin, {
      userIds: [regularUser.id],
    });

    // Level distribution per skill
    const tsDist = readouts.levelDistribution.find(
      (s) => s.skillId === tsSkill.id
    );
    expect(tsDist).toBeDefined();
    expect(tsDist?.totalUsers).toBe(1);

    // Source mix
    expect(readouts.sourceMix.length).toBeGreaterThanOrEqual(2);
    const repoMix = readouts.sourceMix.find((m) => m.type === "repo_imported");
    expect(repoMix?.count).toBe(1);

    // Evidence-vs-quiz divergence placeholder (empty until S1.5)
    expect(readouts.evidenceVsQuizDivergence.rows).toEqual([]);
    expect(readouts.evidenceVsQuizDivergence.note).toMatch(/S1\.5/i);

    // Top movers
    expect(readouts.topMovers.length).toBeGreaterThanOrEqual(1);
    expect(readouts.topMovers[0].skillId).toBe(tsSkill.id);
    expect(readouts.topMovers[0].score).toBeGreaterThan(0);
  });
});
