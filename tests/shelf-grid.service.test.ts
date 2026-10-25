import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { GithubRepoData, GitHubReader } from "@/services/github-discovery";
import {
  buildGridQueries,
  matchArchetypesForTitles,
  runDiscoveryGrid,
} from "@/services/shelf-grid";
import {
  DEFAULT_DISCOVER_ARCHETYPES,
  DEFAULT_DISCOVER_STAR_BANDS,
  DISCOVER_FLAG,
} from "@/services/shelf";

const ID_BASE = 991_000_000;
const NOW = new Date("2026-10-26T02:00:00Z");
const CUTOFF = "2026-04-29"; // NOW − 180d

const SEARCH_HITS: GithubRepoData[] = [
  {
    githubId: ID_BASE + 1,
    fullName: "hidden/gem-rag",
    description: "Quote-grounded retrieval",
    htmlUrl: "https://github.com/hidden/gem-rag",
    stars: 845,
    forks: 20,
    isFork: false,
    archived: false,
    license: "MIT",
    language: "TypeScript",
    topics: ["rag", "llm"],
    sizeKb: 900,
    defaultBranch: "main",
    pushedAt: new Date("2026-10-01T00:00:00Z"),
  },
  {
    githubId: ID_BASE + 2,
    fullName: "spam/pdf-wrapper",
    description: "chat with pdf fast",
    htmlUrl: "https://github.com/spam/pdf-wrapper",
    stars: 120,
    forks: 1,
    isFork: false,
    archived: false,
    license: "MIT",
    language: "TypeScript",
    topics: ["pdf"],
    sizeKb: 100,
    defaultBranch: "main",
    pushedAt: new Date("2026-10-01T00:00:00Z"),
  },
];

function fixtureReader(queries: string[]): GitHubReader {
  return {
    async searchRepos(q) {
      queries.push(q);
      return { total: SEARCH_HITS.length, items: SEARCH_HITS };
    },
    async getRepo() {
      return null;
    },
    async getHeadSha() {
      return null;
    },
    async getStarHistory() {
      return [];
    },
    async getFileContent() {
      return null;
    },
    async listDir() {
      return null;
    },
  };
}

const TEST_ARCHETYPES = [
  {
    key: "ai-llm-engineer",
    name: "AI / LLM engineer",
    titlePatterns: ["ai engineer", "llm"],
    topics: ["rag"],
    languages: ["typescript"],
    enabled: true,
  },
];

beforeAll(async () => {
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
});

afterAll(async () => {
  await db.repo.deleteMany({
    where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("buildGridQueries (D90/D96c)", () => {
  const opts = {
    pushedWithinDays: 180,
    cap: 200,
    dayOffset: 0,
    now: NOW,
  };

  it("expands topics × languages × star bands into hard-qualified queries", () => {
    const queries = buildGridQueries(
      TEST_ARCHETYPES,
      DEFAULT_DISCOVER_STAR_BANDS,
      opts
    );
    expect(queries).toHaveLength(3); // 1 topic × 1 language × 3 bands
    expect(queries[0]).toBe(
      `topic:rag language:typescript stars:50..300 pushed:>${CUTOFF} archived:false fork:false`
    );
  });

  it("caps deterministically with a rotating start offset", () => {
    const a = buildGridQueries(
      DEFAULT_DISCOVER_ARCHETYPES,
      DEFAULT_DISCOVER_STAR_BANDS,
      {
        ...opts,
        cap: 5,
        dayOffset: 0,
      }
    );
    const b = buildGridQueries(
      DEFAULT_DISCOVER_ARCHETYPES,
      DEFAULT_DISCOVER_STAR_BANDS,
      {
        ...opts,
        cap: 5,
        dayOffset: 1,
      }
    );
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    // Rotation shifts the window by exactly one position.
    expect(b[0]).toBe(a[1]);
    expect(new Set(a).size).toBe(5);
  });
});

describe("matchArchetypesForTitles (D96d)", () => {
  it("matches target-role titles by normalized substring, deterministic", () => {
    const keys = matchArchetypesForTitles(
      ["Senior AI Engineer", "Backend Developer"],
      DEFAULT_DISCOVER_ARCHETYPES
    );
    expect(keys).toContain("ai-llm-engineer");
    expect(keys).toContain("backend-engineer");
    expect(
      matchArchetypesForTitles(["Chef"], DEFAULT_DISCOVER_ARCHETYPES)
    ).toEqual([]);
  });
});

describe("runDiscoveryGrid", () => {
  it("upserts gate-passing search hits with the search lane; skips gate hits entirely", async () => {
    const seen: string[] = [];
    const res = await runDiscoveryGrid(fixtureReader(seen), { now: NOW });
    expect(res.queries).toBeGreaterThanOrEqual(3);
    expect(seen.some((q) => q.includes("topic:rag"))).toBe(true);
    expect(res.gatedOut["avoid-keyword"]).toBeGreaterThanOrEqual(1); // pdf wrapper

    const gem = await db.repo.findUnique({ where: { githubId: ID_BASE + 1 } });
    expect(gem?.laneSearch).toBe(true);
    expect(gem?.shelfEligible).toBe(true);
    const spam = await db.repo.findUnique({ where: { githubId: ID_BASE + 2 } });
    expect(spam).toBeNull(); // search lane never stores gate hits
  });

  it("no-ops while the flag is off", async () => {
    await db.featureFlag.update({
      where: { key: DISCOVER_FLAG },
      data: { enabled: false },
    });
    const res = await runDiscoveryGrid(fixtureReader([]));
    expect(res.skipped).toBe("flag-off");
    await db.featureFlag.update({
      where: { key: DISCOVER_FLAG },
      data: { enabled: true },
    });
  });
});
