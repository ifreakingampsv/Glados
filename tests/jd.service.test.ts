import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import {
  createJobDescription,
  deleteJobDescription,
  getTotalJobDescriptionCount,
  listJobDescriptions,
  type ExtractedJdSkill,
} from "@/services/jd";

describe("Job-description entity + extraction service (T10: canonical-id output, D4 content-hash cache, FIFO soft cap prune, manual delete, total count, tenant scoping)", () => {
  let owner: User;
  let otherUser: User;
  const marker = `t10_jd_${Date.now()}`;

  beforeAll(async () => {
    process.env.PLATFORM_OPENAI_API_KEY = "test-openai-t10";
    process.env.PLATFORM_GOOGLE_API_KEY = "test-google-t10";
    await seedConfig();
    await seedCanonicalSkills();
    [owner, otherUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_owner` } }),
      db.user.create({ data: { clerkId: `${marker}_other` } }),
    ]);
  });

  afterAll(async () => {
    const uids = [owner.id, otherUser.id];
    await db.jobDescription.deleteMany({ where: { userId: { in: uids } } });
    await db.gatewayCache.deleteMany({ where: { feature: "jd_extract" } });
    await db.rateLimitCounter.deleteMany({
      where: { bucketKey: { contains: marker } },
    });
    await db.usage.deleteMany({ where: { userId: { in: uids } } });
    await db.dailyCounter.deleteMany({ where: { userId: { in: uids } } });
    await db.config.update({
      where: { key: "jd.softCap" },
      data: { value: 20 },
    });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("extracts canonical skill IDs (resolving aliases and categories at extraction time) and caches by content hash (0 gateway calls on repeat)", async () => {
    let gatewayCalls = 0;
    const fakeGatewayFetch: typeof fetch = async () => {
      gatewayCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Senior Full-Stack Engineer",
                  company: "Lovelace Labs",
                  requirements: [
                    {
                      name: "TypeScript",
                      expectedLevel: 4,
                      category: "languages",
                    },
                    { name: "Next.js", expectedLevel: 3, category: "frontend" },
                    {
                      name: "PostgreSQL",
                      expectedLevel: 3,
                      category: "databases",
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 90 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const jdText =
      "We are hiring a Senior Full-Stack Engineer experienced in TypeScript, Next.js, and PostgreSQL.";

    const first = await createJobDescription(
      owner.id,
      { rawText: jdText },
      { gatewayFetch: fakeGatewayFetch, skipDailyCap: true }
    );
    expect(gatewayCalls).toBe(1);
    expect(first.title).toBe("Senior Full-Stack Engineer");
    expect(first.company).toBe("Lovelace Labs");

    const reqs = first.requiredSkills as unknown as ExtractedJdSkill[];
    expect(reqs.length).toBe(3);

    // Every requirement must carry a canonical Skill ID from the DB
    const dbSkills = await db.skill.findMany({
      where: { id: { in: reqs.map((r) => r.skillId) } },
    });
    expect(dbSkills).toHaveLength(3);
    expect(dbSkills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["typescript", "nextjs", "postgresql"])
    );

    // Second identical JD extraction uses D4 content-hash cache (0 additional gateway calls)
    const second = await createJobDescription(
      otherUser.id,
      { rawText: jdText },
      { gatewayFetch: fakeGatewayFetch, skipDailyCap: true }
    );
    expect(gatewayCalls).toBe(1);
    expect(second.contentHash).toBe(first.contentHash);

    // Clean up otherUser's JD before next test
    await deleteJobDescription(otherUser.id, second.id);
  });

  it("FIFO-prunes oldest JDs at soft cap, enforces tenant scoping on manual delete, and surfaces total JD count for D43", async () => {
    // Set softCap to 3 for fast FIFO verification
    await db.config.update({
      where: { key: "jd.softCap" },
      data: { value: 3 },
    });

    const fakeGatewayFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Backend Role",
                  requirements: [{ name: "Go", expectedLevel: 3 }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 60, completion_tokens: 40 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    // Owner already has 1 JD; create 3 more (total 4 -> oldest 1 pruned, keeping 3)
    const createdIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const jd = await createJobDescription(
        owner.id,
        {
          title: `Role #${i}`,
          rawText: `Unique JD body #${i} requiring Go and Docker (${marker})`,
        },
        { gatewayFetch: fakeGatewayFetch, skipDailyCap: true }
      );
      createdIds.push(jd.id);
    }

    const ownerJds = await listJobDescriptions(owner.id);
    expect(ownerJds).toHaveLength(3);
    // The 3 newest JDs remain; the very first JD was FIFO-pruned
    expect(ownerJds.map((j) => j.id)).toEqual(
      expect.arrayContaining(createdIds)
    );

    // Tenant scoping: otherUser cannot delete owner's JD
    await expect(
      deleteJobDescription(otherUser.id, createdIds[0])
    ).rejects.toThrow(/not found/i);

    // Manual delete by owner
    await deleteJobDescription(owner.id, createdIds[0]);
    expect(await listJobDescriptions(owner.id)).toHaveLength(2);

    // Total JD storage count surfaced for D43 admin dashboard
    const totalCount = await getTotalJobDescriptionCount();
    expect(totalCount).toBeGreaterThanOrEqual(2);
  });
});
