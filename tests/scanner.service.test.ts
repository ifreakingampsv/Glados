import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { listJobDescriptions } from "@/services/jd";
import {
  claimAnonymousScanOnSignup,
  hashClientIp,
  runPublicOrFreeScan,
} from "@/services/scanner";

describe("Free scanner + anonymous funnel service (T12: partial-results gating, peppered IP hash cap, TTL side-table claim on signup + expiry, free-account fixed caps with 0 energy bars)", () => {
  let signedUpUser: User;
  let freeUser: User;
  let otherUser: User;
  const marker = `t12_scan_${Date.now()}`;
  const rawTestIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

  const fakeGatewayFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    const systemMsg = body.messages?.[0]?.content ?? "";
    if (systemMsg.includes("requirements")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Platform Engineer",
                  company: "Aperture Science",
                  requirements: [
                    { name: "TypeScript", expectedLevel: 3 },
                    { name: "PostgreSQL", expectedLevel: 3 },
                    { name: "Docker", expectedLevel: 3 },
                    { name: "Kubernetes", expectedLevel: 3 },
                    { name: "Redis", expectedLevel: 3 },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Engineer with TypeScript",
                skills: [{ name: "TypeScript", claimedLevel: 3 }],
                blocks: [],
                workExperiences: [],
                education: [],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  beforeAll(async () => {
    process.env.PLATFORM_OPENAI_API_KEY = "test-openai-t12";
    process.env.PLATFORM_GOOGLE_API_KEY = "test-google-t12";
    process.env.IP_HASH_PEPPER = "secret-test-pepper-t12";

    await seedConfig();
    await seedCanonicalSkills();

    [signedUpUser, freeUser, otherUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_signup` } }),
      db.user.create({ data: { clerkId: `${marker}_free` } }),
      db.user.create({ data: { clerkId: `${marker}_other` } }),
    ]);
  });

  afterAll(async () => {
    const uids = [signedUpUser.id, freeUser.id, otherUser.id];
    await db.anonymousScan.deleteMany({
      where: { sessionToken: { startsWith: marker } },
    });
    await db.jobDescription.deleteMany({ where: { userId: { in: uids } } });
    await db.rateLimitCounter.deleteMany({
      where: {
        OR: [
          { bucketKey: { contains: marker } },
          { bucketKey: { contains: hashClientIp(rawTestIp) } },
        ],
      },
    });
    await db.gatewayCache.deleteMany({
      where: { feature: { in: ["jd_extract", "resume_parse"] } },
    });
    await db.usage.deleteMany({
      where: { userId: { in: [...uids, "anonymous"] } },
    });
    await db.dailyCounter.deleteMany({
      where: { userId: { in: [...uids, "anonymous"] } },
    });
    await db.energyAccount.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("never stores raw IP in rate limit counters and enforces the anonymous daily cap (2/day)", async () => {
    const hashed = hashClientIp(rawTestIp);
    expect(hashed).not.toContain(rawTestIp);
    expect(hashed).toHaveLength(64);

    // 1st anonymous scan succeeds and returns gated partial result (fit % + top-3 gaps, fullItems: null)
    const scan1 = await runPublicOrFreeScan(
      {
        userId: null,
        rawIp: rawTestIp,
        sessionToken: `${marker}_tok_1`,
        jdText:
          "Platform Engineer needing TypeScript, PostgreSQL, Docker, Kubernetes, Redis.",
        resumeText: "Experienced in TypeScript.",
      },
      { gatewayFetch: fakeGatewayFetch }
    );

    expect(scan1.kind).toBe("anonymous");
    if (scan1.kind === "anonymous") {
      expect(scan1.topGaps).toHaveLength(3);
      expect(scan1.totalGapCount).toBe(5);
      expect(scan1.fullItems).toBeNull();
      expect(scan1.cta.waitlistHref).toBe("/waitlist");
    }

    // Verify raw IP does NOT exist anywhere in RateLimitCounter table
    const rawIpRows = await db.rateLimitCounter.findMany({
      where: { bucketKey: { contains: rawTestIp } },
    });
    expect(rawIpRows).toHaveLength(0);

    // 2nd anonymous scan from same IP succeeds (cap = 2/day)
    await runPublicOrFreeScan(
      {
        userId: null,
        rawIp: rawTestIp,
        sessionToken: `${marker}_tok_2`,
        jdText:
          "Platform Engineer needing TypeScript, PostgreSQL, Docker, Kubernetes, Redis.",
      },
      { gatewayFetch: fakeGatewayFetch }
    );

    // 3rd anonymous scan from same IP throws daily cap error
    await expect(
      runPublicOrFreeScan(
        {
          userId: null,
          rawIp: rawTestIp,
          sessionToken: `${marker}_tok_3`,
          jdText: "Third scan from same IP.",
        },
        { gatewayFetch: fakeGatewayFetch }
      )
    ).rejects.toThrow(/anonymous.*cap/i);
  });

  it("claims anonymous teaser JD + result into account on signup and rejects expired or cross-tenant claims", async () => {
    // Claim valid token into signedUpUser
    const claimed = await claimAnonymousScanOnSignup(
      signedUpUser.id,
      `${marker}_tok_1`
    );
    expect(claimed.claimed).toBe(true);
    expect(claimed.jdId).toBeDefined();

    // Verify JD now exists in signedUpUser's saved JDs (and NOT in otherUser's)
    const userJds = await listJobDescriptions(signedUpUser.id);
    expect(userJds.some((j) => j.id === claimed.jdId)).toBe(true);
    expect(await listJobDescriptions(otherUser.id)).toHaveLength(0);

    // Cross-tenant re-claim by otherUser is rejected
    const crossClaim = await claimAnonymousScanOnSignup(
      otherUser.id,
      `${marker}_tok_1`
    );
    expect(crossClaim.claimed).toBe(false);

    // Expired TTL row cannot be claimed
    await db.anonymousScan.update({
      where: { sessionToken: `${marker}_tok_2` },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expiredClaim = await claimAnonymousScanOnSignup(
      otherUser.id,
      `${marker}_tok_2`
    );
    expect(expiredClaim.claimed).toBe(false);
    expect(expiredClaim.reason).toBe("expired");
  });

  it("gives signed-in free users full results under D28 fixed caps with zero energy-bar involvement", async () => {
    // Seed an EnergyAccount with balance = 3 bars to verify 0 bars are deducted
    await db.energyAccount.create({
      data: { userId: freeUser.id, balance: 3 },
    });

    const authScan = await runPublicOrFreeScan(
      {
        userId: freeUser.id,
        rawIp: "198.51.100.42",
        sessionToken: `${marker}_free_tok`,
        jdText:
          "Platform Engineer needing TypeScript, PostgreSQL, Docker, Kubernetes, Redis.",
        resumeText: "Experienced in TypeScript.",
      },
      { gatewayFetch: fakeGatewayFetch }
    );

    expect(authScan.kind).toBe("authenticated");
    if (authScan.kind === "authenticated") {
      expect(authScan.fullItems).toHaveLength(5);
    }

    const energyAfter = await db.energyAccount.findUniqueOrThrow({
      where: { userId: freeUser.id },
    });
    expect(energyAfter.balance).toBe(3);
  });
});
