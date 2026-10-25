import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { mcpGetRebuildShortlist } from "@/services/mcp";
import { MCP_TOOLS } from "@/services/mcp";
import { shelfTelemetry } from "@/services/shelf-telemetry";
import { ingestCuratedLists, DISCOVER_FLAG } from "@/services/shelf";
import { runNightlyPipeline } from "@/services/shelf-pipeline";
import type { GitHubReader } from "@/services/github-discovery";

const ID_BASE = 996_000_000;
const id = (n: number) => ID_BASE + n;

let user: string;

const emptyReader: GitHubReader = {
  async searchRepos() {
    return { total: 0, items: [] };
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

beforeAll(async () => {
  await seedCanonicalSkills();
  const u = await db.user.create({
    data: { clerkId: `t_s3a_mcp_${Date.now()}` },
  });
  user = u.id;
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
  await db.repo.createMany({
    data: [
      {
        githubId: id(1),
        fullName: "mcp/repo-one",
        htmlUrl: "https://github.com/mcp/repo-one",
        language: "TypeScript",
        stars: 500,
        bandKey: "solid",
        sizeKb: 900,
        score: 4,
        shelfEligible: true,
        laneSearch: true,
        sha: "s1",
      },
      {
        githubId: id(2),
        fullName: "mcp/repo-two",
        htmlUrl: "https://github.com/mcp/repo-two",
        language: "Go",
        stars: 100,
        bandKey: "underrated",
        sizeKb: 700,
        score: 2,
        shelfEligible: true,
        laneList: true,
        sha: "s2",
      },
    ],
  });
});

afterAll(async () => {
  await db.recImpression.deleteMany({ where: { userId: user } });
  await db.repo.deleteMany({
    where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.user.deleteMany({ where: { id: user } });
  await db.config.deleteMany({ where: { key: "discover.unmatchedTopics" } });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("get_rebuild_shortlist MCP tool (D95/D96i)", () => {
  it("is registered as the sixth tool", () => {
    expect(MCP_TOOLS).toHaveLength(6);
    expect(MCP_TOOLS.map((t) => t.name)).toContain("get_rebuild_shortlist");
  });

  it("returns cards READ-ONLY: no impression rows written", async () => {
    const impressionsBefore = await db.recImpression.count({
      where: { userId: user },
    });
    const res = await mcpGetRebuildShortlist(user, {});
    expect("disabled" in res && res.disabled).toBeFalsy();
    const cards = ("cards" in res ? res.cards : []) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0].repo).toBe("mcp/repo-one"); // global fallback ordering by score
    expect(await db.recImpression.count({ where: { userId: user } })).toBe(
      impressionsBefore
    );
  });
});

describe("telemetry readouts (D95/D77 minimums)", () => {
  it("hides CTR below the minimum and aggregates without named users", async () => {
    // 3 shown, 1 clicked for repo 1 — below any sane minimum (50 default).
    await db.recImpression.createMany({
      data: [
        {
          userId: user,
          repoGithubId: id(1),
          archetypeKey: "ai-llm-engineer",
          clickedAt: new Date(),
        },
        { userId: user, repoGithubId: id(1), archetypeKey: "ai-llm-engineer" },
        { userId: user, repoGithubId: id(1), archetypeKey: "ai-llm-engineer" },
      ],
    });
    const t = await shelfTelemetry();
    expect(t.repoCtr.find((r) => r.repo === "mcp/repo-one")).toBeUndefined(); // below minimum → hidden
    expect(t.archetypeCtr.length).toBe(0); // same minimum applies
    expect(t.minImpressions).toBeGreaterThanOrEqual(50);
  });

  it("surfaces top-unmatched topics for alias growth", async () => {
    await db.config.upsert({
      where: { key: "discover.unmatchedTopics" },
      update: { value: { vite: 400, build: 900 } },
      create: {
        key: "discover.unmatchedTopics",
        value: { vite: 400, build: 900 },
      },
    });
    const t = await shelfTelemetry();
    expect(t.topUnmatched[0]).toEqual({ topic: "build", count: 900 });
    expect(t.topUnmatched[1]).toEqual({ topic: "vite", count: 400 });
  });
});

describe("the single discover flag gates page + jobs + tool (D96i)", () => {
  it("one switch: flag off disables the tool, the list ingest, and the nightly chain", async () => {
    await db.featureFlag.update({
      where: { key: DISCOVER_FLAG },
      data: { enabled: false },
    });
    const tool = await mcpGetRebuildShortlist(user, {});
    expect(tool.disabled).toBe(true);
    expect((await ingestCuratedLists(emptyReader)).skipped).toBe("flag-off");
    expect((await runNightlyPipeline()).skipped).toBe("flag-off");
    await db.featureFlag.update({
      where: { key: DISCOVER_FLAG },
      data: { enabled: true },
    });
  });
});
