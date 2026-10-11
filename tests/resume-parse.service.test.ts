import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { createInMemoryS3Fetch, createR2Adapter } from "@/services/storage";
import {
  LINKEDIN_PDF_GUIDE_COPY,
  parseResumeOrLinkedinTransient,
  type ParsedResumeDocument,
} from "@/services/resume-parse";

describe("Resume/LinkedIn transient parse service (T07: PDF + paste, D4 content-hash cache, no-profile persistence, LinkedIn fixture, daily cap)", () => {
  let user: User;
  let capUser: User;
  const marker = `t07_parse_${Date.now()}`;

  const sampleParsedJson: ParsedResumeDocument = {
    summary:
      "Senior Full Stack Engineer building distributed web platforms with Next.js and PostgreSQL.",
    skills: [
      { name: "TypeScript", claimedLevel: 4 },
      { name: "React", claimedLevel: 4 },
      { name: "PostgreSQL", claimedLevel: 3 },
      { name: "Docker", claimedLevel: 3 },
    ],
    blocks: [
      {
        kind: "summary",
        title: "Professional Summary",
        content:
          "Senior Full Stack Engineer building distributed web platforms with Next.js and PostgreSQL.",
      },
      {
        kind: "experience",
        title: "Principal Engineer at Analytical Engine Corp",
        content:
          "Architected TypeScript and PostgreSQL services with Redis caching.",
      },
      {
        kind: "education",
        title: "University of London",
        content: "B.S. Mathematics and Computer Science",
      },
    ],
    workExperiences: [
      {
        employer: "Analytical Engine Corp",
        title: "Principal Engineer",
        period: "2022-01 to 2025-01",
        durationMonths: 36,
        kind: "job",
        description:
          "Architected TypeScript and PostgreSQL services with Redis caching.",
        skills: ["TypeScript", "PostgreSQL", "Redis"],
      },
    ],
    education: [
      {
        institution: "University of London",
        degree: "B.S. Mathematics and Computer Science",
        period: "2018 to 2022",
      },
    ],
  };

  beforeAll(async () => {
    process.env.PLATFORM_OPENAI_API_KEY = "test-platform-key-t07";
    process.env.PLATFORM_GOOGLE_API_KEY = "test-google-key-t07";

    await seedConfig();
    await seedCanonicalSkills();

    [user, capUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_u1` } }),
      db.user.create({ data: { clerkId: `${marker}_cap` } }),
    ]);
  });

  afterAll(async () => {
    await db.gatewayCache.deleteMany({ where: { feature: "resume_parse" } });
    await db.rateLimitCounter.deleteMany({
      where: { bucketKey: { contains: marker } },
    });
    await db.usage.deleteMany({
      where: {
        userId: {
          in: [user.id, capUser.id, `anon_${marker}`, `${marker}_cap_bucket`],
        },
      },
    });
    await db.dailyCounter.deleteMany({
      where: {
        userId: {
          in: [user.id, capUser.id, `anon_${marker}`, `${marker}_cap_bucket`],
        },
      },
    });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("parses committed LinkedIn data-export PDF fixture transiently via storage module, caches by content hash (0 gateway calls on repeat), and persists nothing on the no-profile path", async () => {
    expect(LINKEDIN_PDF_GUIDE_COPY.toLowerCase()).toContain("save to pdf");

    const pdfPath = path.join(
      process.cwd(),
      "tests/fixtures/linkedin-export-sample.pdf"
    );
    const pdfBytes = fs.readFileSync(pdfPath);
    const s3 = createInMemoryS3Fetch();
    const storageAdapter = createR2Adapter(
      {
        endpoint: "https://t07-account.r2.cloudflarestorage.com",
        bucket: "glados-t07-bucket",
        accessKeyId: "AKIA_T07_TEST",
        secretAccessKey: "SECRET_T07_TEST_KEY",
      },
      s3.fetch
    );

    let gatewayCalls = 0;
    const fakeGatewayFetch: typeof fetch = async () => {
      gatewayCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(sampleParsedJson) } }],
          usage: { prompt_tokens: 180, completion_tokens: 120 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    // First upload on no-profile path (userId: null)
    const first = await parseResumeOrLinkedinTransient(
      {
        userId: null,
        rateLimitId: `anon_${marker}`,
        source: "linkedin",
        pdfBytes,
      },
      {
        storageAdapter,
        gatewayFetch: fakeGatewayFetch,
      }
    );

    expect(gatewayCalls).toBe(1);
    expect(first.cached).toBe(false);
    expect(first.extractedText).toContain("Analytical Engine Corp");
    expect(first.parsed.skills.length).toBeGreaterThanOrEqual(4);
    expect(first.parsed.workExperiences).toHaveLength(1);
    expect(first.parsed.education).toHaveLength(1);
    expect(first.parsed.blocks.length).toBeGreaterThanOrEqual(2);

    // Transient PDF was cleaned up from R2 on the no-profile path
    expect(s3.objects.size).toBe(0);

    // Second identical upload hits D4 content-hash cache (zero additional gateway calls)
    const second = await parseResumeOrLinkedinTransient(
      {
        userId: null,
        rateLimitId: `anon_${marker}`,
        source: "linkedin",
        pdfBytes,
      },
      {
        storageAdapter,
        gatewayFetch: fakeGatewayFetch,
      }
    );
    expect(gatewayCalls).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.contentHash).toBe(first.contentHash);

    // Verify no-profile path persisted ZERO spine rows
    const [skillClaims, blocks, experiences, profiles] = await Promise.all([
      db.userSkill.count({ where: { userId: user.id } }),
      db.resumeBlock.count({ where: { userId: user.id } }),
      db.workExperience.count({ where: { userId: user.id } }),
      db.profile.count({ where: { userId: user.id } }),
    ]);
    expect(skillClaims).toBe(0);
    expect(blocks).toBe(0);
    expect(experiences).toBe(0);
    expect(profiles).toBe(0);
  });

  it("enforces the attractor daily cap (3/day from attractor.caps.resume_scan)", async () => {
    const fakeGatewayFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(sampleParsedJson) } }],
          usage: { prompt_tokens: 90, completion_tokens: 60 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    for (let i = 1; i <= 3; i++) {
      const res = await parseResumeOrLinkedinTransient(
        {
          userId: capUser.id,
          rateLimitId: `${marker}_cap_bucket`,
          source: "resume",
          rawText: `Resume variant ${i} for Ada Lovelace with TypeScript and PostgreSQL`,
        },
        { gatewayFetch: fakeGatewayFetch }
      );
      expect(res.parsed.workExperiences).toHaveLength(1);
    }

    // 4th attempt on the same day exceeds the 3/day cap
    await expect(
      parseResumeOrLinkedinTransient(
        {
          userId: capUser.id,
          rateLimitId: `${marker}_cap_bucket`,
          source: "resume",
          rawText: "Resume variant 4 exceeding daily cap",
        },
        { gatewayFetch: fakeGatewayFetch }
      )
    ).rejects.toThrow(/daily.*cap/i);
  });
});
