import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { appendEvent, basePoints } from "@/services/events";
import { getConfig } from "@/services/levels";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";
import {
  ensureSkillDefinition,
  generateMissingSkillDefinitions,
} from "@/services/skill-admin";

describe("S1 spine plumbing (T05: event vocabulary, config rows, D70 skill definitions)", () => {
  let user: User;
  let admin: User;
  const marker = `t05_plumbing_${Date.now()}`;

  beforeAll(async () => {
    process.env.PLATFORM_GOOGLE_API_KEY = "test-google-key";
    await seedCanonicalSkills();
    await seedConfig();
    await seedRoutes();
    [user, admin] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_user`, role: "USER" } }),
      db.user.create({ data: { clerkId: `${marker}_admin`, role: "ADMIN" } }),
    ]);
  });

  afterAll(async () => {
    await db.usage.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.dailyCounter.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.energyAccount.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.eventLog.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.userSkill.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("extends event vocabulary with repo_imported, work_experience_added, work_experience_confirmed, and audit-only resume_imported", async () => {
    const rust = await db.skill.findUniqueOrThrow({ where: { name: "rust" } });

    expect(await basePoints("resume_imported", "web")).toBe(0);
    expect(await basePoints("repo_imported", "web")).toBeGreaterThan(0);
    expect(await basePoints("work_experience_added", "web")).toBeGreaterThan(0);
    expect(
      await basePoints("work_experience_confirmed", "web")
    ).toBeGreaterThan(0);

    // 1. resume_imported is audit-only (0 points)
    const auditEvent = await appendEvent({
      userId: user.id,
      source: "web",
      type: "resume_imported",
      skills: [rust.id],
    });
    expect(auditEvent.points).toBe(0);

    let us = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: rust.id } },
    });
    expect(us.score).toBe(0);
    expect(us.level).toBe(0);

    // 2. repo_imported adds evidence points and recomputes level
    const repoEvent = await appendEvent({
      userId: user.id,
      source: "web",
      type: "repo_imported",
      skills: [rust.id],
    });
    expect(repoEvent.points).toBe(5);

    us = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: rust.id } },
    });
    expect(us.score).toBeCloseTo(5, 2);
    expect(us.level).toBe(1);

    // 3. work_experience_added and work_experience_confirmed append and recompute
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "work_experience_added",
      skills: [rust.id],
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "work_experience_confirmed",
      skills: [rust.id],
    });

    us = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: rust.id } },
    });
    expect(us.score).toBeGreaterThan(5);
  });

  it("seeds all S1 config rows and makes them readable via getConfig", async () => {
    const anonCap = await getConfig<number>("scanner.anonymousDailyCap", 0);
    const anonTtl = await getConfig<number>("scanner.anonymousTtlDays", 0);
    const linkedinCap = await getConfig<number>("linkedin.dailyCap", 0);
    const githubCap = await getConfig<number>("imports.githubCap", 0);
    const jdCap = await getConfig<number>("jd.softCap", 0);
    const fitWeights = await getConfig<{
      evidenced: number;
      claim: number;
      expectedLevel: number;
    } | null>("gap.fitWeights", null);
    const strongThreshold = await getConfig<{
      minEvidencedSkills: number;
      minLevel: number;
      minProjectsWithSkills: number;
    } | null>("gap.profileStrongThreshold", null);
    const shrinkBounds = await getConfig<{
      minFontPt: number;
      defaultFontPt: number;
    } | null>("resume.shrinkBounds", null);

    expect(anonCap).toBe(2);
    expect(anonTtl).toBe(30);
    expect(linkedinCap).toBe(1);
    expect(githubCap).toBe(25);
    expect(jdCap).toBe(20);
    expect(fitWeights).toEqual({
      evidenced: 1.0,
      claim: 0.5,
      expectedLevel: 3,
    });
    expect(strongThreshold?.minProjectsWithSkills).toBeGreaterThanOrEqual(1);
    expect(shrinkBounds?.minFontPt).toBeLessThan(shrinkBounds!.defaultFontPt);
  });

  it("generates skill definitions lazily through the gateway, caches via D4, and enforces admin gating on bulk generation", async () => {
    const tempSkill = await db.skill.create({
      data: {
        name: `zig_${Date.now()}`,
        display: "Zig",
        status: "ACTIVE",
      },
    });

    let gatewayCalls = 0;
    const fakeFetch: typeof fetch = async () => {
      gatewayCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Zig is a low-level systems programming language focused on explicit control flow and zero hidden allocations.",
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 25 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const firstDef = await ensureSkillDefinition(
      tempSkill.id,
      admin.id,
      fakeFetch
    );
    expect(firstDef).toContain(
      "Zig is a low-level systems programming language"
    );
    expect(gatewayCalls).toBe(1);

    // Second call is idempotent and makes zero gateway calls
    const secondDef = await ensureSkillDefinition(
      tempSkill.id,
      admin.id,
      fakeFetch
    );
    expect(secondDef).toBe(firstDef);
    expect(gatewayCalls).toBe(1);

    // Even if the column is cleared, D4 GatewayCache serves the cached definition with zero gateway calls
    await db.skill.update({
      where: { id: tempSkill.id },
      data: { definition: null },
    });
    const cachedDef = await ensureSkillDefinition(
      tempSkill.id,
      admin.id,
      fakeFetch
    );
    expect(cachedDef).toBe(firstDef);
    expect(gatewayCalls).toBe(1);

    // Admin gating on bulk generation
    await expect(
      generateMissingSkillDefinitions(user, fakeFetch, 2)
    ).rejects.toThrow(/admin/i);

    const bulkResult = await generateMissingSkillDefinitions(
      admin,
      fakeFetch,
      2
    );
    expect(bulkResult.totalActive).toBeGreaterThan(0);
    expect(bulkResult.generated).toBeGreaterThanOrEqual(0);

    await db.skill.delete({ where: { id: tempSkill.id } });
  });
});
