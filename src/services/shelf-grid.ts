// S3a search lane (D90/D96c): the archetype-driven query grid. Archetypes ×
// topics × languages × star bands expand into hard-qualified GitHub searches
// (fork:false, recency, archived:false); a global query cap truncates
// deterministically with a rotating start offset so every archetype gets its
// turn across nights. Search-lane gate hits are SKIPPED (not stored) — the
// wrapper-clone volume would swamp the corpus; the list lane stores its rare
// gated rows for audit instead.

import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import type { GithubRepoData, GitHubReader } from "@/services/github-discovery";
import {
  DEFAULT_DISCOVER_AVOID,
  DEFAULT_DISCOVER_GRID,
  getArchetypes,
  getStarBands,
  isDiscoverEnabled,
  passesGates,
  upsertRepoFromGithub,
  type DiscoverArchetype,
  type DiscoverStarBand,
} from "@/services/shelf";

export interface GridOptions {
  pushedWithinDays: number;
  cap: number;
  /** Rotation anchor — derived from the date by default (shifts nightly). */
  dayOffset: number;
  now: Date;
}

export function buildGridQueries(
  archetypes: DiscoverArchetype[],
  bands: DiscoverStarBand[],
  opts: GridOptions
): string[] {
  const pushedCutoff = new Date(
    opts.now.getTime() - opts.pushedWithinDays * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const queries: string[] = [];
  for (const a of archetypes) {
    if (!a.enabled) continue;
    for (const topic of a.topics) {
      for (const language of a.languages) {
        for (const band of bands) {
          queries.push(
            `topic:${topic} language:${language} stars:${band.min}..${band.max} pushed:>${pushedCutoff} archived:false fork:false`
          );
        }
      }
    }
  }
  const unique = [...new Set(queries)];
  if (unique.length <= opts.cap) return unique;
  // Deterministic rotation: start where the last night ended + 1.
  const start =
    ((opts.dayOffset % unique.length) + unique.length) % unique.length;
  const rotated: string[] = [];
  for (let i = 0; i < opts.cap; i++)
    rotated.push(unique[(start + i) % unique.length]);
  return rotated;
}

export interface GridResult {
  queries: number;
  run: number;
  upserted: number;
  eligible: number;
  gatedOut: Record<string, number>;
  skipped?: string;
}

export async function runDiscoveryGrid(
  reader: GitHubReader,
  opts: { now?: Date } = {}
): Promise<GridResult> {
  if (!(await isDiscoverEnabled())) {
    return {
      queries: 0,
      run: 0,
      upserted: 0,
      eligible: 0,
      gatedOut: {},
      skipped: "flag-off",
    };
  }
  const now = opts.now ?? new Date();
  const archetypes = await getArchetypes();
  const bands = await getStarBands();
  const grid = await getConfig("discover.grid", DEFAULT_DISCOVER_GRID);
  const avoid = await getConfig("discover.avoid", DEFAULT_DISCOVER_AVOID);
  const dayOffset = Math.floor(now.getTime() / 86_400_000);
  const queries = buildGridQueries(archetypes, bands, {
    pushedWithinDays: grid.pushedWithinDays,
    cap: grid.queryCap,
    dayOffset,
    now,
  });

  const result: GridResult = {
    queries: queries.length,
    run: 0,
    upserted: 0,
    eligible: 0,
    gatedOut: {},
  };
  for (const q of queries) {
    const { items } = await reader.searchRepos(q);
    result.run += 1;
    for (const item of items) {
      const gate = passesGates(item, avoid);
      if (!gate.eligible) {
        if (gate.reason)
          result.gatedOut[gate.reason] =
            (result.gatedOut[gate.reason] ?? 0) + 1;
        continue; // search lane: gate hits never enter the corpus
      }
      await upsertRepoFromGithub(item, { lane: "search", now, gate });
      result.upserted += 1;
      result.eligible += 1;
    }
  }
  return result;
}

// D96d: deterministic target-role → archetype mapping (normalized substring
// match on titlePatterns). Used by the match service; explicit user picks
// beat this inference (D73 pattern).
export function matchArchetypesForTitles(
  titles: string[],
  archetypes: DiscoverArchetype[]
): string[] {
  const matched = new Set<string>();
  for (const title of titles) {
    const t = title.toLowerCase();
    for (const a of archetypes) {
      if (!a.enabled) continue;
      if (a.titlePatterns.some((p) => t.includes(p.toLowerCase())))
        matched.add(a.key);
    }
  }
  return [...matched];
}

export type { GithubRepoData };
