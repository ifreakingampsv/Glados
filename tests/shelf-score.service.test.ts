import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  computeShelfScore,
  hardFilter,
  runScoring,
} from "@/services/shelf-score";
import {
  DEFAULT_DISCOVER_FILTERS,
  DEFAULT_DISCOVER_WEIGHTS,
  DISCOVER_FLAG,
} from "@/services/shelf";

const ID_BASE = 993_000_000;
const NOW = new Date("2026-10-26T02:00:00Z");

const BASE = {
  stars: 400,
  sizeKb: 800,
  license: "MIT",
  hasTests: true,
  hasCi: true,
  readmeChars: 3000,
  pushedAt: new Date("2026-10-01T00:00:00Z"),
  isFork: false,
  archived: false,
  velocityPerWeek: 10,
  bandKey: "solid",
  laneList: true,
};

function id(n: number) {
  return ID_BASE + n;
}

beforeAll(async () => {
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
  await db.repo.createMany({
    data: [
      {
        githubId: id(1),
        fullName: "score/healthy",
        htmlUrl: "https://github.com/score/healthy",
        ...BASE,
      },
      {
        githubId: id(2),
        fullName: "score/oversize",
        htmlUrl: "https://github.com/score/oversize",
        ...BASE,
        sizeKb: 99_999,
      },
      {
        githubId: id(3),
        fullName: "score/dead",
        htmlUrl: "https://github.com/score/dead",
        ...BASE,
        pushedAt: new Date("2024-01-01T00:00:00Z"),
      },
      {
        githubId: id(4),
        fullName: "score/gpl",
        htmlUrl: "https://github.com/score/gpl",
        ...BASE,
        license: "GPL-3.0",
      },
      {
        githubId: id(5),
        fullName: "score/nolicense",
        htmlUrl: "https://github.com/score/nolicense",
        ...BASE,
        license: null,
      },
      {
        githubId: id(6),
        fullName: "score/lowvelocity",
        htmlUrl: "https://github.com/score/lowvelocity",
        ...BASE,
        velocityPerWeek: 1,
      },
    ],
  });
  // Two fresh vouches for the healthy repo, one stale (outside window).
  await db.repoListMembership.createMany({
    data: [
      { repoGithubId: id(1), listKey: "list-a", lastSeenAt: NOW },
      { repoGithubId: id(1), listKey: "list-b", lastSeenAt: NOW },
      {
        repoGithubId: id(1),
        listKey: "list-stale",
        lastSeenAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  });
});

afterAll(async () => {
  await db.repo.deleteMany({
    where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.repoListMembership.deleteMany({
    where: { repoGithubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.config.deleteMany({ where: { key: "discover.weights" } });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("hard filters (D92)", () => {
  it("rejects forks, archives, unlicensed, oversize, and dead repos; GPL passes", () => {
    expect(
      hardFilter(
        { ...BASE, githubId: 0, isFork: true },
        DEFAULT_DISCOVER_FILTERS,
        NOW
      ).reason
    ).toBe("fork");
    expect(
      hardFilter(
        { ...BASE, githubId: 0, archived: true },
        DEFAULT_DISCOVER_FILTERS,
        NOW
      ).reason
    ).toBe("archived");
    expect(
      hardFilter(
        { ...BASE, githubId: 0, license: null },
        DEFAULT_DISCOVER_FILTERS,
        NOW
      ).reason
    ).toBe("unlicensed");
    expect(
      hardFilter(
        { ...BASE, githubId: 0, sizeKb: 80_000 },
        DEFAULT_DISCOVER_FILTERS,
        NOW
      ).reason
    ).toBe("oversize");
    expect(
      hardFilter(
        { ...BASE, githubId: 0, pushedAt: new Date("2024-01-01") },
        DEFAULT_DISCOVER_FILTERS,
        NOW
      ).reason
    ).toBe("dead");
    expect(
      hardFilter(
        { ...BASE, githubId: 0, license: "GPL-3.0" },
        DEFAULT_DISCOVER_FILTERS,
        NOW
      ).eligible
    ).toBe(true);
  });
});

describe("computeShelfScore (D92 — deterministic)", () => {
  it("is a pure weighted sum with the house decay shape", () => {
    const s = computeShelfScore(
      { ...BASE, githubId: 0 },
      DEFAULT_DISCOVER_WEIGHTS,
      80,
      NOW
    );
    const ageDays = (NOW.getTime() - BASE.pushedAt.getTime()) / 86_400_000;
    const expected =
      1 * Math.pow(0.5, ageDays / 90) +
      1.5 * 0.8 +
      1 * 1 +
      0.5 * 1 +
      0.5 * 1 +
      0.5 * 1;
    expect(s).toBeCloseTo(expected, 8);
    // GPL halves only the license dim (soft, D16/D92)
    const gpl = computeShelfScore(
      { ...BASE, githubId: 0, license: "GPL-3.0" },
      DEFAULT_DISCOVER_WEIGHTS,
      80,
      NOW
    );
    expect(s - gpl).toBeCloseTo(0.5 * 0.5, 8);
  });
});

describe("runScoring", () => {
  it("flags hard-filter failures off, scores the rest, and is deterministic across runs", async () => {
    const first = await runScoring({ now: NOW });
    expect(first.flaggedOff["oversize"]).toBeGreaterThanOrEqual(1);
    expect(first.flaggedOff["dead"]).toBeGreaterThanOrEqual(1);
    expect(first.flaggedOff["unlicensed"]).toBeGreaterThanOrEqual(1);

    const healthy = await db.repo.findUnique({ where: { githubId: id(1) } });
    expect(healthy?.shelfEligible).toBe(true);
    expect(healthy?.crossListCount).toBe(2); // stale vouch excluded
    const low = await db.repo.findUnique({ where: { githubId: id(6) } });
    // Percentile within the shared 'solid' cohort: 10/wk ranks above 1/wk (ties share rank).
    expect(healthy?.velocityPct ?? 0).toBeGreaterThan(low?.velocityPct ?? 0);
    expect(healthy?.score).toBeGreaterThan(0);

    const dead = await db.repo.findUnique({ where: { githubId: id(3) } });
    expect(dead?.shelfEligible).toBe(false);
    expect(dead?.score).toBe(0);

    const before = await db.repo.findMany({
      where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
      orderBy: { githubId: "asc" },
      select: { score: true, velocityPct: true },
    });
    await runScoring({ now: NOW });
    const after = await db.repo.findMany({
      where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
      orderBy: { githubId: "asc" },
      select: { score: true, velocityPct: true },
    });
    expect(after).toEqual(before); // identical inputs → identical outputs
  });

  it("reads weights from config: editing a weight changes the score", async () => {
    await db.config.upsert({
      where: { key: "discover.weights" },
      update: { value: { ...DEFAULT_DISCOVER_WEIGHTS, tests: 5 } },
      create: {
        key: "discover.weights",
        value: { ...DEFAULT_DISCOVER_WEIGHTS, tests: 5 },
      },
    });
    await runScoring({ now: NOW });
    const boosted = await db.repo.findUnique({ where: { githubId: id(1) } });
    await db.config.deleteMany({ where: { key: "discover.weights" } });
    await runScoring({ now: NOW });
    const normal = await db.repo.findUnique({ where: { githubId: id(1) } });
    expect((boosted?.score ?? 0) - (normal?.score ?? 0)).toBeCloseTo(4, 6); // (5−1)×tests factor 1
  });
});
