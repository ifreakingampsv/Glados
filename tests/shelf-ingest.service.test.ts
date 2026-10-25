import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { GithubRepoData, GitHubReader } from "@/services/github-discovery";
import {
  ingestCuratedLists,
  parseListRows,
  passesGates,
  DEFAULT_DISCOVER_AVOID,
  DISCOVER_FLAG,
} from "@/services/shelf";

// Global corpus rows — cleaned by test-range githubId, never by user.
const ID_BASE = 990_000_000;
const ids = (...n: number[]) => n.map((x) => ID_BASE + x);

function repoFixture(
  n: number,
  over: Partial<GithubRepoData> = {}
): GithubRepoData {
  return {
    githubId: ID_BASE + n,
    fullName: `testowner${n}/repo${n}`,
    description: `A test project ${n}`,
    htmlUrl: `https://github.com/testowner${n}/repo${n}`,
    stars: 100 + n,
    forks: 3,
    isFork: false,
    archived: false,
    license: "MIT",
    language: "TypeScript",
    topics: ["cli", "typescript"],
    sizeKb: 1200,
    defaultBranch: "main",
    pushedAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  };
}

const LIST_MARKDOWN = `# Build X
- [Repo One](https://github.com/testowner1/repo1) — good project
- [Repo One dup](https://github.com/testowner1/repo1) — duplicate row
* [Forked](https://github.com/testowner2/repo2) — a fork
- [Avoidlisted](https://github.com/testowner3/repo3) — chat-with-pdf clone
- [Not github](https://example.com/foo) — skipped by parser
`;

function fixtureReader(repos: GithubRepoData[]): GitHubReader {
  const byName = new Map(repos.map((r) => [r.fullName, r]));
  return {
    async searchRepos() {
      return { total: 0, items: [] };
    },
    async getRepo(owner, name) {
      return byName.get(`${owner}/${name}`) ?? null;
    },
    async getHeadSha() {
      return null;
    },
    async getStarHistory() {
      return [];
    },
    async getFileContent(owner, name, path) {
      if (`${owner}/${name}` === "testlist/readme-repo" && path === "README.md")
        return LIST_MARKDOWN;
      return null;
    },
    async listDir() {
      return null;
    },
  };
}

const FIXTURES = [
  repoFixture(1),
  repoFixture(2, { isFork: true }),
  repoFixture(3, {
    topics: ["chat-with-pdf"],
    description: "chat with pdf anything",
  }),
];

let reader: GitHubReader;

beforeAll(async () => {
  reader = fixtureReader(FIXTURES);
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
  // Pin the list config to the fixture list — never the real seeded lists.
  await db.config.upsert({
    where: { key: "discover.lists" },
    update: {
      value: [
        {
          key: "build-your-own-x",
          repo: "testlist/readme-repo",
          file: "README.md",
          enabled: true,
        },
      ] as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
    create: {
      key: "discover.lists",
      value: [
        {
          key: "build-your-own-x",
          repo: "testlist/readme-repo",
          file: "README.md",
          enabled: true,
        },
      ] as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });
});

afterAll(async () => {
  await db.repo.deleteMany({ where: { githubId: { in: ids(1, 2, 3) } } });
  await db.repoListMembership.deleteMany({
    where: { repoGithubId: { in: ids(1, 2, 3) } },
  });
  await db.config.deleteMany({ where: { key: "discover.lists" } });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("parseListRows", () => {
  it("extracts owner/name pairs from markdown list links", () => {
    const rows = parseListRows(LIST_MARKDOWN);
    expect(rows).toHaveLength(4); // non-github link excluded
    expect(rows[0]).toEqual({
      name: "Repo One",
      owner: "testowner1",
      repoName: "repo1",
    });
  });
});

describe("anti-generic gates (D90)", () => {
  it("rejects forks, archived repos, avoid topics and keywords", () => {
    expect(passesGates(repoFixture(1), DEFAULT_DISCOVER_AVOID).eligible).toBe(
      true
    );
    expect(
      passesGates(repoFixture(2, { isFork: true }), DEFAULT_DISCOVER_AVOID)
        .reason
    ).toBe("fork");
    expect(
      passesGates(repoFixture(3, { archived: true }), DEFAULT_DISCOVER_AVOID)
        .reason
    ).toBe("archived");
    expect(
      passesGates(
        repoFixture(4, { topics: ["template"] }),
        DEFAULT_DISCOVER_AVOID
      ).reason
    ).toBe("avoid-topic");
    expect(
      passesGates(
        repoFixture(5, { description: "A boilerplate for apps" }),
        DEFAULT_DISCOVER_AVOID
      ).reason
    ).toBe("avoid-keyword");
  });
});

describe("curated-list ingest (D90/D91)", () => {
  it("upserts eligible repos with the list lane + vouch membership, gates the rest", async () => {
    const res = await ingestCuratedLists(reader, {
      now: new Date("2026-10-26T03:00:00Z"),
    });
    // The seeded discover.lists config points at real repos; the fixture
    // reader only answers for testlist/readme-repo, so exactly one list runs.
    expect(res.lists).toBeGreaterThanOrEqual(1);
    expect(res.upserted).toBeGreaterThanOrEqual(3);

    const good = await db.repo.findUnique({ where: { githubId: ids(1)[0] } });
    expect(good?.shelfEligible).toBe(true);
    expect(good?.laneList).toBe(true);

    const forked = await db.repo.findUnique({ where: { githubId: ids(2)[0] } });
    expect(forked?.shelfEligible).toBe(false); // stored, never eligible, never deleted

    const membership = await db.repoListMembership.findUnique({
      where: {
        repoGithubId_listKey: {
          repoGithubId: ids(1)[0],
          listKey: "build-your-own-x",
        },
      },
    });
    expect(membership?.lastSeenAt.toISOString()).toBe(
      "2026-10-26T03:00:00.000Z"
    );
  });

  it("is idempotent: a second unchanged run writes no new rows", async () => {
    const before = await db.repo.count({
      where: { githubId: { in: ids(1, 2, 3) } },
    });
    await ingestCuratedLists(reader, { now: new Date("2026-10-26T03:00:00Z") });
    const after = await db.repo.count({
      where: { githubId: { in: ids(1, 2, 3) } },
    });
    expect(after).toBe(before);
  });

  it("no-ops while the discover flag is off", async () => {
    await db.featureFlag.update({
      where: { key: DISCOVER_FLAG },
      data: { enabled: false },
    });
    const res = await ingestCuratedLists(reader);
    expect(res.skipped).toBe("flag-off");
    await db.featureFlag.update({
      where: { key: DISCOVER_FLAG },
      data: { enabled: true },
    });
  });
});
