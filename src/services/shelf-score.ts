// S3a scorer (D92): hard filters gate, then a deterministic weighted score —
// every weight a config row, every factor explainable, same inputs → same
// order, always. Cross-list vouch = memberships with fresh lastSeen; velocity
// percentile is computed WITHIN the star band (gems never race giants). Dead
// repos flip shelfEligible off; rows are never deleted (D91).

import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import {
  DEFAULT_DISCOVER_FILTERS,
  DEFAULT_DISCOVER_WEIGHTS,
  isDiscoverEnabled,
} from "@/services/shelf";

export type ScoreWeights = typeof DEFAULT_DISCOVER_WEIGHTS;
export type ScoreFilters = typeof DEFAULT_DISCOVER_FILTERS;

export interface ScorableRepo {
  githubId: number;
  stars: number;
  sizeKb: number;
  license: string | null;
  hasTests: boolean;
  hasCi: boolean;
  readmeChars: number;
  pushedAt: Date | null;
  isFork: boolean;
  archived: boolean;
  velocityPerWeek: number;
  bandKey: string | null;
  laneList: boolean;
}

export function hardFilter(
  repo: ScorableRepo,
  filters: ScoreFilters,
  now: Date
): { eligible: boolean; reason?: string } {
  if (repo.isFork) return { eligible: false, reason: "fork" };
  if (repo.archived) return { eligible: false, reason: "archived" };
  if (!repo.license) return { eligible: false, reason: "unlicensed" };
  if (repo.sizeKb > filters.sizeKbCeiling)
    return { eligible: false, reason: "oversize" };
  if (repo.pushedAt) {
    const ageDays = (now.getTime() - repo.pushedAt.getTime()) / 86_400_000;
    if (ageDays > filters.deadPushDays)
      return { eligible: false, reason: "dead" };
  }
  return { eligible: true };
}

// Pure factor math (D92). Recency uses the house decay shape (90-day
// half-life, D24); license is a SOFT dim — GPL is not disqualified because a
// rebuild studies architecture and copies nothing (D16).
export function computeShelfScore(
  repo: ScorableRepo,
  weights: ScoreWeights,
  velocityPct: number,
  now: Date
): number {
  const ageDays = repo.pushedAt
    ? Math.max(0, (now.getTime() - repo.pushedAt.getTime()) / 86_400_000)
    : 999;
  const factors = {
    recency: Math.pow(0.5, ageDays / 90),
    velocity: Math.max(0, Math.min(1, velocityPct / 100)),
    tests: repo.hasTests ? 1 : 0,
    ci: repo.hasCi ? 1 : 0,
    docs: Math.min(1, repo.readmeChars / 3000),
    license:
      repo.license === "MIT" ||
      repo.license === "Apache-2.0" ||
      repo.license === "Apache-2" ||
      repo.license === "BSD-3-Clause"
        ? 1
        : 0.5,
  };
  return (
    weights.recency * factors.recency +
    weights.velocity * factors.velocity +
    weights.tests * factors.tests +
    weights.ci * factors.ci +
    weights.docs * factors.docs +
    weights.license * factors.license
  );
}

export interface ScoringResult {
  scored: number;
  eligible: number;
  flaggedOff: Record<string, number>;
  skipped?: string;
}

export async function runScoring(
  opts: { now?: Date } = {}
): Promise<ScoringResult> {
  if (!(await isDiscoverEnabled())) {
    return { scored: 0, eligible: 0, flaggedOff: {}, skipped: "flag-off" };
  }
  const now = opts.now ?? new Date();
  const weights = await getConfig<ScoreWeights>(
    "discover.weights",
    DEFAULT_DISCOVER_WEIGHTS
  );
  const filters = await getConfig<ScoreFilters>(
    "discover.filters",
    DEFAULT_DISCOVER_FILTERS
  );

  const repos = await db.repo.findMany();
  const result: ScoringResult = { scored: 0, eligible: 0, flaggedOff: {} };

  // Vouch counts (D92): only memberships seen within the vouch window count —
  // a repo dropped from a list loses its vouch at the next weekly re-ingest.
  const vouchWindowStart = new Date(now.getTime() - 21 * 86_400_000);
  const memberships = await db.repoListMembership.findMany({
    where: { lastSeenAt: { gte: vouchWindowStart } },
    select: { repoGithubId: true },
  });
  const vouches = new Map<number, number>();
  for (const m of memberships)
    vouches.set(m.repoGithubId, (vouches.get(m.repoGithubId) ?? 0) + 1);

  // Velocity percentile WITHIN band cohort (D92).
  const byBand = new Map<string, number[]>();
  for (const r of repos) {
    if (!r.bandKey) continue;
    const arr = byBand.get(r.bandKey) ?? [];
    arr.push(r.velocityPerWeek);
    byBand.set(r.bandKey, arr);
  }
  const pctOf = (band: string | null, v: number): number => {
    if (!band) return 0;
    const cohort = byBand.get(band);
    if (!cohort || cohort.length === 0) return 0;
    const below = cohort.filter((x) => x < v).length;
    return (below / cohort.length) * 100;
  };

  for (const repo of repos) {
    const gate = hardFilter(repo, filters, now);
    if (!gate.eligible) {
      if (gate.reason)
        result.flaggedOff[gate.reason] =
          (result.flaggedOff[gate.reason] ?? 0) + 1;
    }
    const pct = pctOf(repo.bandKey, repo.velocityPerWeek);
    const score = gate.eligible
      ? computeShelfScore(repo, weights, pct, now)
      : 0;
    await db.repo.update({
      where: { githubId: repo.githubId },
      data: {
        shelfEligible: gate.eligible,
        score,
        velocityPct: pct,
        crossListCount: vouches.get(repo.githubId) ?? 0,
      },
    });
    result.scored += 1;
    if (gate.eligible) result.eligible += 1;
  }
  return result;
}
