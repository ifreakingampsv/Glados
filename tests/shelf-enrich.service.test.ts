import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { GithubRepoData, GitHubReader } from "@/services/github-discovery";
import { extractReadmeSignals, runEnrichment } from "@/services/shelf-enrich";
import { resolveTagStrict } from "@/services/skills";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { DISCOVER_FLAG } from "@/services/shelf";

const ID_BASE = 992_000_000;
const NOW = new Date("2026-10-26T02:00:00Z");
const UNMATCHED_TOPIC = "hyperweaving-framework";

function repoRow(
  n: number,
  over: Partial<GithubRepoData> = {}
): GithubRepoData {
  return {
    githubId: ID_BASE + n,
    fullName: `enrichtest${n}/repo${n}`,
    description: "enrich target",
    htmlUrl: `https://github.com/enrichtest${n}/repo${n}`,
    stars: 400,
    forks: 2,
    isFork: false,
    archived: false,
    license: "MIT",
    language: "TypeScript",
    topics: ["typescript", "koltin", "reactjss", UNMATCHED_TOPIC],
    sizeKb: 800,
    defaultBranch: "main",
    pushedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

const FIXTURE = repoRow(1);

// Fixture reader with mutable head sha so tests can simulate code changes.
function makeReader(opts: { sha: string; readme: string }) {
  const calls = { getRepo: 0, getStarHistory: 0, getFileContent: 0 };
  const reader: GitHubReader = {
    async searchRepos() {
      return { total: 0, items: [] };
    },
    async getRepo() {
      calls.getRepo += 1;
      return FIXTURE;
    },
    async getHeadSha() {
      return opts.sha;
    },
    async getStarHistory() {
      calls.getStarHistory += 1;
      return [3, 5, 8, 12, 20]; // velocity = mean(8,12,20) = 13.33
    },
    async getFileContent(owner, name, path) {
      calls.getFileContent += 1;
      if (path.toLowerCase() === "readme.md") return opts.readme;
      if (path === "package.json") return `{"scripts": {"test": "vitest"}}`;
      return null;
    },
    async listDir(owner, name, path) {
      if (path === ".github/workflows") return ["ci.yml"];
      return null;
    },
  };
  return { reader, calls };
}

const README = `# Repo1
Build your own cache server.

\`\`\`ts
const x: number = 1;
\`\`\`

\`\`\`py
print("hi")
\`\`\`
`;

beforeAll(async () => {
  await seedCanonicalSkills();
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
  await db.repo.create({
    data: {
      githubId: FIXTURE.githubId,
      fullName: FIXTURE.fullName,
      htmlUrl: FIXTURE.htmlUrl,
      laneList: true,
    },
  });
});

afterAll(async () => {
  await db.repo.deleteMany({
    where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.config.deleteMany({
    where: { key: "discover.unmatchedTopics" },
  });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("resolveTagStrict (D96a — the grill's regression target)", () => {
  it("resolves canonical, alias, and ≤1-typo matches", async () => {
    expect((await resolveTagStrict("typescript")).status).toBe("resolved");
    const js = await resolveTagStrict("js"); // seeded alias
    expect(js.status === "resolved" && js.name).toBe("javascript");
    const typo = await resolveTagStrict("koltin");
    expect(typo.status === "resolved" && typo.name).toBe("kotlin");
  });

  it("returns unresolved for the confirm zone and unknowns — and creates NOTHING", async () => {
    const beforeSkills = await db.skill.count();
    const beforeAliases = await db.skillAlias.count();
    expect((await resolveTagStrict("reactjss")).status).toBe("unresolved");
    expect((await resolveTagStrict(UNMATCHED_TOPIC)).status).toBe("unresolved");
    expect((await resolveTagStrict("r")).status).toBe("unresolved"); // <4 chars: no auto-accept
    expect(await db.skill.count()).toBe(beforeSkills);
    expect(await db.skillAlias.count()).toBe(beforeAliases);
  });
});

describe("readme signals", () => {
  it("extracts fenced code languages and repo-name words", () => {
    const signals = extractReadmeSignals(README, "repo1");
    expect(signals).toContain("typescript");
    expect(signals).toContain("python");
    expect(signals).toContain("repo1"); // repo-name words; README prose deliberately NOT mined (noise would flood the unmatched readout)
  });
});

describe("runEnrichment", () => {
  it("enriches a changed repo: velocity, tests, ci, tags, unmatched counter; writes no skills rows", async () => {
    const { reader } = makeReader({ sha: "abc123", readme: README });
    const skillsBefore = await db.skill.count();
    const res = await runEnrichment(reader, { now: NOW });

    expect(res.enriched).toBeGreaterThanOrEqual(1);
    const repo = await db.repo.findUnique({
      where: { githubId: FIXTURE.githubId },
    });
    expect(repo?.sha).toBe("abc123");
    expect(repo?.hasTests).toBe(true);
    expect(repo?.hasCi).toBe(true);
    expect(repo?.velocityPerWeek).toBeCloseTo((5 + 8 + 12 + 20) / 4, 5); // mean of last 4 weekly deltas
    expect(repo?.bandKey).toBe("solid"); // 400 stars
    // tags: typescript (canonical), koltin (≤1 typo → kotlin), reactjss + hyperweaving → unmatched
    expect(repo?.skills.length).toBeGreaterThanOrEqual(2);
    expect(await db.skill.count()).toBe(skillsBefore); // D96a: the night job never writes skills

    const unmatched = await db.config.findUnique({
      where: { key: "discover.unmatchedTopics" },
    });
    const map = unmatched?.value as Record<string, number>;
    expect(map[UNMATCHED_TOPIC]).toBeGreaterThanOrEqual(1);
  });

  it("skips unchanged repos: same sha within the refresh window makes zero enrichment calls", async () => {
    const { reader, calls } = makeReader({ sha: "abc123", readme: README });
    const res = await runEnrichment(reader, { now: NOW });
    expect(res.skippedUnchanged).toBeGreaterThanOrEqual(1);
    expect(calls.getStarHistory).toBe(0);
    expect(calls.getRepo).toBe(0);
  });

  it("re-enriches when the head sha changes", async () => {
    const { reader, calls } = makeReader({ sha: "def456", readme: README });
    const res = await runEnrichment(reader, { now: NOW });
    expect(res.enriched).toBeGreaterThanOrEqual(1);
    expect(calls.getStarHistory).toBeGreaterThanOrEqual(1);
    const repo = await db.repo.findUnique({
      where: { githubId: FIXTURE.githubId },
    });
    expect(repo?.sha).toBe("def456");
  });
});
