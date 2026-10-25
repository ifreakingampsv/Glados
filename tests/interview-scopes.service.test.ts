import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { addCredential } from "@/services/credentials";
import {
  startInterviewSession,
  packContentVersion,
  buildPackForScope,
} from "@/services/interview";

const TEST_PROVIDER = "ivscopeprovider";
const marker = `iv06_${Date.now()}`;
let userId: string;
let projectA: string;
let projectB: string;
let jdId: string;
let resumeBlockId: string;

function bankJson(count: number): string {
  const cats = ["architecture", "tradeoff", "failure", "scale"];
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      text: `Scope question ${i + 1}`,
      category: cats[i % 4],
    })),
  });
}

function makeFetch() {
  const state = { calls: 0 };
  const impl = (async () => {
    state.calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: bankJson(5) } }],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  return { impl, state };
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-s";
  await seedConfig();
  await db.providerRoute.updateMany({
    where: { feature: "interview_turn" },
    data: { isActive: false },
  });
  await db.providerRoute.create({
    data: {
      feature: "interview_turn",
      provider: TEST_PROVIDER,
      model: "test-model",
      endpoint: "https://example.test/v1/chat/completions",
      costPer1kUsd: 0.0001,
      isActive: true,
    },
  });
  const user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  userId = user.id;
  await addCredential(userId, TEST_PROVIDER, "sk-byo-scope-test");
  const a = await db.project.create({
    data: {
      userId,
      title: "Alpha",
      description: "a",
      skills: ["react"],
      links: [],
    },
  });
  const b = await db.project.create({
    data: {
      userId,
      title: "Beta",
      description: "b",
      skills: ["go"],
      links: [],
    },
  });
  projectA = a.id;
  projectB = b.id;
  const jd = await db.jobDescription.create({
    data: {
      userId,
      title: "Full-stack engineer",
      rawText: "build things",
      contentHash: `hash_${marker}`,
      requiredSkills: [
        { skillId: "react", expectedLevel: 3 },
        { skillId: "postgresql", expectedLevel: 2 },
      ],
    },
  });
  jdId = jd.id;
  const block = await db.resumeBlock.create({
    data: {
      userId,
      kind: "experience",
      title: "Booking app",
      content: "Built a booking platform with Next.js and Postgres",
    },
  });
  resumeBlockId = block.id;
});

afterAll(async () => {
  await db.interviewReport.deleteMany({ where: { session: { userId } } });
  await db.interviewSession.deleteMany({ where: { userId } });
  await db.gatewayCache.deleteMany({
    where: { cacheKey: { startsWith: "interview_bank:" } },
  });
  await db.credential.deleteMany({ where: { userId } });
  await db.usage.deleteMany({ where: { userId } });
  await db.dailyCounter.deleteMany({ where: { userId } });
  await db.energyAccount.deleteMany({ where: { userId } });
  await db.resumeBlock.deleteMany({ where: { userId } });
  await db.jobDescription.deleteMany({ where: { userId } });
  await db.project.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  await db.providerRoute.deleteMany({
    where: { feature: "interview_turn", provider: TEST_PROVIDER },
  });
  await db.providerRoute.updateMany({
    where: { feature: "interview_turn" },
    data: { isActive: true },
  });
  delete process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`];
});

describe("scopes (T06: D80)", () => {
  it("three scopes never share a bank — each generates its own", async () => {
    const fProject = makeFetch();
    const fPortfolio = makeFetch();
    const fApplication = makeFetch();

    await startInterviewSession(userId, {
      scope: "project",
      projectId: projectA,
      mode: "quick",
      fetchImpl: fProject.impl,
    });
    await startInterviewSession(userId, {
      scope: "portfolio",
      projectIds: [projectA, projectB],
      mode: "quick",
      fetchImpl: fPortfolio.impl,
    });
    await startInterviewSession(userId, {
      scope: "application",
      jdId,
      mode: "quick",
      fetchImpl: fApplication.impl,
    });
    expect(fProject.state.calls).toBe(1);
    expect(fPortfolio.state.calls).toBe(1);
    expect(fApplication.state.calls).toBe(1); // three distinct banks

    const sessions = await db.interviewSession.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    expect(sessions.map((s) => s.scope)).toEqual([
      "project",
      "portfolio",
      "application",
    ]);
    const keys = new Set(
      sessions.map(
        (s) => ((s.payload as { bankCacheKey?: string }) ?? {}).bankCacheKey
      )
    );
    expect(keys.size).toBe(3);
  });

  it("portfolio scope enforces the cap", async () => {
    const c = await db.project.count({ where: { userId } });
    expect(c).toBe(2);
    // create two more so four unique projects exceed the default cap of 3
    const extra1 = await db.project.create({
      data: { userId, title: "C", description: "c", skills: [], links: [] },
    });
    const extra2 = await db.project.create({
      data: { userId, title: "D", description: "d", skills: [], links: [] },
    });
    const fetcher = makeFetch();
    await expect(
      startInterviewSession(userId, {
        scope: "portfolio",
        projectIds: [projectA, projectB, extra1.id, extra2.id],
        mode: "quick",
        fetchImpl: fetcher.impl,
      })
    ).rejects.toThrow("at most");
    await expect(
      startInterviewSession(userId, {
        scope: "portfolio",
        projectIds: [],
        mode: "quick",
        fetchImpl: fetcher.impl,
      })
    ).rejects.toThrow("at least one");
  });

  it("application pack carries the resume blocks and JD skew", async () => {
    const pack = await buildPackForScope(userId, {
      scope: "application",
      jdId,
    });
    expect(pack.scope).toBe("application");
    expect(pack.resume?.length).toBeGreaterThanOrEqual(1);
    expect(pack.jd?.title).toBe("Full-stack engineer");
    expect(JSON.stringify(pack.jd?.requiredSkills)).toContain("react");
    const noJd = await buildPackForScope(userId, { scope: "application" });
    expect(noJd.jd).toBeUndefined();
  });

  it("editing the resume invalidates application banks via the content version", async () => {
    const before = packContentVersion(
      await buildPackForScope(userId, { scope: "application" })
    );
    await db.resumeBlock.update({
      where: { id: resumeBlockId },
      data: { content: "Led the booking platform rewrite (2025–2026)" },
    });
    const after = packContentVersion(
      await buildPackForScope(userId, { scope: "application" })
    );
    expect(before).not.toBe(after);
  });
});
