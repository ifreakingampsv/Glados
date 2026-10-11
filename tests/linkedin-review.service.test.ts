import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { createInMemoryS3Fetch, createR2Adapter } from "@/services/storage";
import {
  reviewLinkedinProfile,
  type LinkedinReviewRecommendations,
} from "@/services/linkedin-review";

describe("LinkedIn profile review service (T15: export/paste -> parse -> 1 gateway review call vs target roles, D4 caching by profile+role hash, 1/day cap, no URL scraping)", () => {
  let user: User;
  let capUser: User;
  const marker = `t15_li_${Date.now()}`;

  const sampleParsedProfile = {
    summary:
      "Distributed Systems Engineer building TypeScript and PostgreSQL platforms.",
    skills: [
      { name: "TypeScript", claimedLevel: 4 },
      { name: "PostgreSQL", claimedLevel: 3 },
    ],
    blocks: [
      {
        kind: "summary",
        title: "About",
        content:
          "Distributed Systems Engineer building TypeScript and PostgreSQL platforms.",
      },
    ],
    workExperiences: [
      {
        employer: "Analytical Engine Corp",
        title: "Senior Engineer",
        period: "2022 to Present",
        durationMonths: 30,
        kind: "job",
        description: "Designed event-driven microservices in TypeScript.",
        skills: ["TypeScript", "PostgreSQL"],
      },
    ],
    education: [
      {
        institution: "University of London",
        degree: "B.S. Computer Science",
        period: "2018 to 2022",
      },
    ],
  };

  const sampleReviewJson: LinkedinReviewRecommendations = {
    headlineScore: 84,
    summaryFeedback:
      "Strong technical focus on TypeScript and PostgreSQL, but missing quantified throughput metrics in the headline.",
    add: [
      "Add Docker and Redis to your Featured Skills section with project links.",
      "Include latency and request-volume metrics in your Analytical Engine Corp role description.",
    ],
    post: [
      "Write a technical breakdown on schema migration patterns in PostgreSQL.",
      "Share a post about event-driven idempotency lessons from your recent TypeScript service.",
    ],
    visibility: [
      "Pin your top GitHub repository to the Featured section.",
      "Align your headline with 'Senior Backend / Distributed Systems Engineer' to match recruiter boolean filters.",
    ],
  };

  beforeAll(async () => {
    process.env.PLATFORM_GOOGLE_API_KEY = "test-google-key-t15";
    process.env.PLATFORM_OPENAI_API_KEY = "test-openai-key-t15";

    await seedConfig();
    await seedRoutes();
    await seedCanonicalSkills();

    [user, capUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_u1` } }),
      db.user.create({ data: { clerkId: `${marker}_cap` } }),
    ]);
  });

  afterAll(async () => {
    await db.providerRoute.deleteMany({ where: { feature: "smoke" } });
    await db.gatewayCache.deleteMany({
      where: { feature: { in: ["resume_parse", "linkedin_review"] } },
    });
    await db.rateLimitCounter.deleteMany({
      where: {
        OR: [
          { bucketKey: { contains: marker } },
          { bucketKey: { contains: user.id } },
          { bucketKey: { contains: capUser.id } },
        ],
      },
    });
    await db.usage.deleteMany({
      where: { userId: { in: [user.id, capUser.id] } },
    });
    await db.dailyCounter.deleteMany({
      where: { userId: { in: [user.id, capUser.id] } },
    });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("ingests LinkedIn PDF export, runs parse + ONE gateway review call against target roles, returns structured add/post/visibility advice, and caches by profile + target-role hash", async () => {
    const pdfPath = path.join(
      process.cwd(),
      "tests/fixtures/linkedin-export-sample.pdf"
    );
    const pdfBytes = fs.readFileSync(pdfPath);
    const s3 = createInMemoryS3Fetch();
    const storageAdapter = createR2Adapter(
      {
        endpoint: "https://t15-account.r2.cloudflarestorage.com",
        bucket: "glados-t15-bucket",
        accessKeyId: "AKIA_T15_TEST",
        secretAccessKey: "SECRET_T15_TEST_KEY",
      },
      s3.fetch
    );

    let parseGatewayCalls = 0;
    let reviewGatewayCalls = 0;

    const fakeGatewayFetch: typeof fetch = async (_url, init) => {
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      if (bodyStr.includes("Extract structured JSON")) {
        parseGatewayCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(sampleParsedProfile) } },
            ],
            usage: { prompt_tokens: 150, completion_tokens: 100 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      reviewGatewayCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(sampleReviewJson) } }],
          usage: { prompt_tokens: 200, completion_tokens: 140 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    // 1. First review from PDF export
    const review1 = await reviewLinkedinProfile(
      {
        userId: user.id,
        targetRoles: [
          "Senior Backend Engineer",
          "Distributed Systems Engineer",
        ],
        pdfBytes,
      },
      { storageAdapter, gatewayFetch: fakeGatewayFetch }
    );

    expect(parseGatewayCalls).toBe(1);
    expect(reviewGatewayCalls).toBe(1);
    expect(review1.cached).toBe(false);
    expect(review1.recommendations.headlineScore).toBe(84);
    expect(review1.recommendations.add).toHaveLength(2);
    expect(review1.recommendations.post).toHaveLength(2);
    expect(review1.recommendations.visibility).toHaveLength(2);

    // 2. Repeat review with unchanged profile + target roles makes ZERO gateway calls
    const review2 = await reviewLinkedinProfile(
      {
        userId: user.id,
        targetRoles: [
          "Senior Backend Engineer",
          "Distributed Systems Engineer",
        ],
        pdfBytes,
      },
      { storageAdapter, gatewayFetch: fakeGatewayFetch }
    );

    expect(parseGatewayCalls).toBe(1);
    expect(reviewGatewayCalls).toBe(1);
    expect(review2.cached).toBe(true);
    expect(review2.cacheKey).toBe(review1.cacheKey);
    expect(review2.recommendations).toEqual(review1.recommendations);
  });

  it("enforces the free 1/day cap from config on uncached reviews", async () => {
    let reviewCalls = 0;
    const fakeGatewayFetch: typeof fetch = async (_url, init) => {
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      if (bodyStr.includes("Extract structured JSON")) {
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(sampleParsedProfile) } },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 80 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      reviewCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(sampleReviewJson) } }],
          usage: { prompt_tokens: 120, completion_tokens: 90 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const first = await reviewLinkedinProfile(
      {
        userId: capUser.id,
        targetRoles: ["Staff Platform Engineer"],
        rawText:
          "Ada Lovelace - Senior Engineer at Analytical Engine Corp. TypeScript, PostgreSQL.",
      },
      { gatewayFetch: fakeGatewayFetch }
    );
    expect(first.recommendations.add.length).toBeGreaterThan(0);
    expect(reviewCalls).toBe(1);

    // Second distinct review on the same day is blocked by the 1/day cap
    await expect(
      reviewLinkedinProfile(
        {
          userId: capUser.id,
          targetRoles: ["Site Reliability Engineer"],
          rawText:
            "Ada Lovelace - Senior Engineer at Analytical Engine Corp. TypeScript, PostgreSQL.",
        },
        { gatewayFetch: fakeGatewayFetch }
      )
    ).rejects.toThrow(/daily.*linkedin review.*cap/i);

    expect(reviewCalls).toBe(1);
  });

  it("rejects LinkedIn URLs immediately (no URL scraping posture)", async () => {
    let gatewayCalled = false;
    const fakeGatewayFetch: typeof fetch = async () => {
      gatewayCalled = true;
      throw new Error("Should not call gateway");
    };

    await expect(
      reviewLinkedinProfile(
        {
          userId: user.id,
          targetRoles: ["Backend Engineer"],
          rawText: "https://www.linkedin.com/in/ada-lovelace-1815/",
        },
        { gatewayFetch: fakeGatewayFetch }
      )
    ).rejects.toThrow(/url scraping is not supported/i);

    expect(gatewayCalled).toBe(false);
  });
});
