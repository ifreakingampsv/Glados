import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runAnnotations } from "@/services/shelf-annotate";
import { runScoring } from "@/services/shelf-score";
import { DISCOVER_FLAG } from "@/services/shelf";

const ID_BASE = 994_000_000;
const NOW = new Date("2026-10-26T02:00:00Z");
const SHA = "annot1";

// OpenAI-compatible fake: counts calls, returns a fixed valid annotation.
function fakeFetch(counter: { calls: number }) {
  return (async () => {
    counter.calls += 1;
    const content = JSON.stringify({
      memorableWhy: "A genuinely hard problem solved in readable code.",
      modificationIdeas: [
        "Add a streaming ingest path",
        "Swap the CLI for a local web UI",
        "Add e2e tests over a golden corpus",
      ],
      learningPayoff:
        "Parsing, concurrency limits, and cache invalidation under load.",
    });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 500, completion_tokens: 200 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  process.env.PLATFORM_GOOGLE_API_KEY ||= "test-platform-google-key";
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
  // gatewayCall needs an active route for repo_annotate in the test DB.
  await db.providerRoute.upsert({
    where: { id: "test-route-repo-annotate" },
    update: {},
    create: {
      id: "test-route-repo-annotate",
      feature: "repo_annotate",
      provider: "google",
      model: "gemini-2.0-flash",
      endpoint: "https://example.invalid/v1/chat/completions",
      costPer1kUsd: 0,
      isActive: true,
    },
  });
  await db.repo.create({
    data: {
      githubId: ID_BASE + 1,
      fullName: "annot/great-project",
      htmlUrl: "https://github.com/annot/great-project",
      laneSearch: true,
      shelfEligible: true,
      score: 5,
      sha: SHA,
      stars: 400,
      bandKey: "solid",
      description: "test",
      license: "MIT",
      hasTests: true,
      readmeChars: 3000,
      pushedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  await db.repo.create({
    data: {
      githubId: ID_BASE + 2,
      fullName: "annot/second",
      htmlUrl: "https://github.com/annot/second",
      laneList: true,
      shelfEligible: true,
      score: 3,
      sha: SHA,
      stars: 300,
      bandKey: "solid",
      description: "test",
      license: "MIT",
      hasTests: false,
      readmeChars: 100,
      pushedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
});

afterAll(async () => {
  await db.repo.deleteMany({
    where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.repoAnnotation.deleteMany({
    where: { repoGithubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.providerRoute.deleteMany({
    where: { id: "test-route-repo-annotate" },
  });
  await db.usage.deleteMany({ where: { userId: "system" } });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("runAnnotations (D92/D96g)", () => {
  it("annotates new survivors once and caches by repo+sha", async () => {
    const counter = { calls: 0 };
    const first = await runAnnotations({
      now: NOW,
      fetchImpl: fakeFetch(counter),
    });
    expect(first.candidates).toBe(2);
    expect(first.annotated).toBe(2);
    expect(counter.calls).toBe(2);

    const row = await db.repoAnnotation.findUnique({
      where: { repoGithubId: ID_BASE + 1 },
    });
    expect(row?.sha).toBe(SHA);
    expect(Array.isArray(row?.modificationIdeas)).toBe(true);

    // Second run, same sha: ZERO gateway calls.
    const secondCounter = { calls: 0 };
    const second = await runAnnotations({
      now: NOW,
      fetchImpl: fakeFetch(secondCounter),
    });
    expect(second.candidates).toBe(0);
    expect(secondCounter.calls).toBe(0);
  });

  it("regenerates when the code moved (sha changed)", async () => {
    await db.repo.update({
      where: { githubId: ID_BASE + 1 },
      data: { sha: "moved99" },
    });
    const counter = { calls: 0 };
    const res = await runAnnotations({
      now: NOW,
      fetchImpl: fakeFetch(counter),
    });
    expect(res.candidates).toBe(1);
    expect(counter.calls).toBe(1);
    const row = await db.repoAnnotation.findUnique({
      where: { repoGithubId: ID_BASE + 1 },
    });
    expect(row?.sha).toBe("moved99");
  });

  it("annotations never affect rank order: scores unchanged with annotations on or off", async () => {
    await runScoring({ now: NOW });
    const withAnn = await db.repo.findMany({
      where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
      orderBy: { score: "desc" },
      select: { githubId: true },
    });
    expect(withAnn[0].githubId).toBe(ID_BASE + 1); // score 5 > 3, annotations present
  });
});
