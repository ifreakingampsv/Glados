// S3a telemetry readouts (D95/D96i): AGGREGATE-ONLY analytics over the
// impression rows — never named users, minimum counts before anything shows
// (D77 pattern). Feeds D92 weight tuning: shown-many/clicked-zero = scoring
// miss. Plus the top-unmatched-topics readout that drives alias growth (D91).

import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import { DEFAULT_DISCOVER_TELEMETRY_MINIMUMS } from "@/services/shelf";

export interface RepoCtrRow {
  repo: string;
  shown: number;
  clicked: number;
  ctr: number;
}

export interface ArchetypeCtrRow {
  archetype: string;
  shown: number;
  clicked: number;
  ctr: number;
}

export async function shelfTelemetry() {
  const minimums = await getConfig(
    "discover.telemetryMinimums",
    DEFAULT_DISCOVER_TELEMETRY_MINIMUMS
  );

  const impressions = await db.recImpression.findMany({
    select: { repoGithubId: true, archetypeKey: true, clickedAt: true },
  });

  const byRepo = new Map<number, { shown: number; clicked: number }>();
  const byArchetype = new Map<string, { shown: number; clicked: number }>();
  for (const imp of impressions) {
    const r = byRepo.get(imp.repoGithubId) ?? { shown: 0, clicked: 0 };
    r.shown += 1;
    if (imp.clickedAt) r.clicked += 1;
    byRepo.set(imp.repoGithubId, r);
    if (imp.archetypeKey) {
      const a = byArchetype.get(imp.archetypeKey) ?? { shown: 0, clicked: 0 };
      a.shown += 1;
      if (imp.clickedAt) a.clicked += 1;
      byArchetype.set(imp.archetypeKey, a);
    }
  }

  const repos = byRepo.size
    ? await db.repo.findMany({
        where: { githubId: { in: [...byRepo.keys()] } },
        select: { githubId: true, fullName: true },
      })
    : [];
  const nameOf = new Map(repos.map((r) => [r.githubId, r.fullName]));

  const repoCtr: RepoCtrRow[] = [...byRepo.entries()]
    .filter(([, v]) => v.shown >= minimums.minImpressionsForCtr)
    .map(([githubId, v]) => ({
      repo: nameOf.get(githubId) ?? String(githubId),
      shown: v.shown,
      clicked: v.clicked,
      ctr: v.clicked / v.shown,
    }))
    .sort((a, b) => b.ctr - a.ctr || b.shown - a.shown);

  const archetypeCtr: ArchetypeCtrRow[] = [...byArchetype.entries()]
    .filter(([, v]) => v.shown >= minimums.minImpressionsForCtr)
    .map(([key, v]) => ({
      archetype: key,
      shown: v.shown,
      clicked: v.clicked,
      ctr: v.clicked / v.shown,
    }))
    .sort((a, b) => b.ctr - a.ctr);

  const unmatchedRaw = await getConfig<Record<string, number>>(
    "discover.unmatchedTopics",
    {}
  );
  const topUnmatched = Object.entries(unmatchedRaw)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([topic, count]) => ({ topic, count }));

  return {
    repoCtr,
    archetypeCtr,
    topUnmatched,
    minImpressions: minimums.minImpressionsForCtr,
  };
}
