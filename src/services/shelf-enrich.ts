// S3a enrichment (D91/D96a): new-or-changed repos gain scorable facts (star
// history → velocity, tests/CI, README, license, size) and canonical skill
// tags through resolveTagStrict — the READ-ONLY ladder. The night job NEVER
// writes skills tables; unmatched topics increment the top-unmatched readout
// (a config map, top 200) so alias growth stays deliberate.

import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import type { GitHubReader } from "@/services/github-discovery";
import { resolveTagStrict } from "@/services/skills";
import {
  DEFAULT_DISCOVER_STAR_BANDS,
  getStarBands,
  isDiscoverEnabled,
} from "@/services/shelf";

const ENRICH_REFRESH_MS = 7 * 86_400_000; // velocity/stars drift without sha change
const UNMATCHED_CAP = 200;

export interface EnrichResult {
  checked: number;
  enriched: number;
  skippedUnchanged: number;
  tagged: number;
  unmatched: Record<string, number>;
  skipped?: string;
}

function bandForStars(
  stars: number,
  bands: { key: string; min: number; max: number }[]
) {
  for (const b of bands) if (stars >= b.min && stars <= b.max) return b.key;
  return stars < (bands[0]?.min ?? 50)
    ? null
    : (bands[bands.length - 1]?.key ?? null);
}

function velocityFromHistory(deltas: number[]): number {
  if (deltas.length === 0) return 0;
  const window = deltas.slice(-4);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

// Deterministic README signals: fenced code languages + repo-name words. No
// fuzzy matching on free text — everything goes through the strict ladder.
const FENCE_LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  sh: "shell",
  yml: "yaml",
};

export function extractReadmeSignals(
  readme: string | null,
  repoName: string
): string[] {
  const signals = new Set<string>();
  for (const m of readme?.matchAll(/```\s*([a-z0-9+#-]+)/g) ?? []) {
    const lang = FENCE_LANGS[m[1]] ?? m[1];
    signals.add(lang);
  }
  for (const word of repoName.split(/[^A-Za-z0-9+#]+/)) {
    if (word.length >= 3) signals.add(word.toLowerCase());
  }
  return [...signals];
}

async function bumpUnmatched(topics: string[]): Promise<void> {
  if (topics.length === 0) return;
  const current = await getConfig<Record<string, number>>(
    "discover.unmatchedTopics",
    {}
  );
  const next = { ...current };
  for (const t of topics) next[t] = (next[t] ?? 0) + 1;
  const capped = Object.entries(next)
    .sort((a, b) => b[1] - a[1])
    .slice(0, UNMATCHED_CAP);
  await db.config.upsert({
    where: { key: "discover.unmatchedTopics" },
    update: { value: Object.fromEntries(capped) },
    create: {
      key: "discover.unmatchedTopics",
      value: Object.fromEntries(capped),
    },
  });
}

export async function runEnrichment(
  reader: GitHubReader,
  opts: { now?: Date } = {}
): Promise<EnrichResult> {
  if (!(await isDiscoverEnabled())) {
    return {
      checked: 0,
      enriched: 0,
      skippedUnchanged: 0,
      tagged: 0,
      unmatched: {},
      skipped: "flag-off",
    };
  }
  const now = opts.now ?? new Date();
  const bands = await getStarBands();
  const result: EnrichResult = {
    checked: 0,
    enriched: 0,
    skippedUnchanged: 0,
    tagged: 0,
    unmatched: {},
  };

  // Fetch head sha for every eligible repo — that one cheap call IS the skip
  // check; full enrichment runs only on sha change or weekly staleness.
  const allEligible = await db.repo.findMany({
    where: { shelfEligible: true },
    select: {
      githubId: true,
      fullName: true,
      defaultBranch: true,
      sha: true,
      lastEnrichedAt: true,
    },
  });

  for (const row of allEligible) {
    result.checked += 1;
    const [owner, name] = row.fullName.split("/");
    const headSha = await reader.getHeadSha(owner, name, row.defaultBranch);
    if (!headSha) continue;
    const stale =
      !row.lastEnrichedAt ||
      now.getTime() - row.lastEnrichedAt.getTime() > ENRICH_REFRESH_MS;
    if (row.sha === headSha && !stale) {
      result.skippedUnchanged += 1;
      continue;
    }

    const [repoData, readme, starDeltas] = await Promise.all([
      reader.getRepo(owner, name),
      reader
        .getFileContent(owner, name, "README.md")
        .then((r) => r ?? reader.getFileContent(owner, name, "readme.md")),
      reader.getStarHistory(owner, name),
    ]);
    if (!repoData) continue;

    const packageJson = await reader.getFileContent(
      owner,
      name,
      "package.json"
    );
    const testDir = await reader
      .listDir(owner, name, "tests")
      .then((r) => r ?? reader.listDir(owner, name, "test"));
    const workflows = await reader.listDir(owner, name, ".github/workflows");
    const hasTests =
      testDir != null ||
      (packageJson != null &&
        /"(test|vitest|jest)[^"]*"\s*:/.test(packageJson));
    const hasCi = workflows != null && workflows.length > 0;

    // Tagging: strict ladder only; unresolved topics feed the readout.
    const tokens = [
      ...new Set([
        ...repoData.topics.map((t) => t.toLowerCase()),
        ...extractReadmeSignals(readme, name),
      ]),
    ];
    const skillIds: string[] = [];
    const unmatched: string[] = [];
    for (const token of tokens) {
      const res = await resolveTagStrict(token);
      if (res.status === "resolved") skillIds.push(res.skillId);
      else unmatched.push(token);
    }
    await bumpUnmatched(unmatched);
    for (const u of unmatched)
      result.unmatched[u] = (result.unmatched[u] ?? 0) + 1;
    result.tagged += skillIds.length;

    const stars = repoData.stars;
    await db.repo.update({
      where: { githubId: row.githubId },
      data: {
        description: repoData.description,
        htmlUrl: repoData.htmlUrl,
        stars,
        language: repoData.language,
        topics: repoData.topics,
        forks: repoData.forks,
        archived: repoData.archived,
        license: repoData.license,
        sizeKb: repoData.sizeKb,
        defaultBranch: repoData.defaultBranch,
        pushedAt: repoData.pushedAt,
        readmeChars: readme?.length ?? 0,
        readmeExcerpt: readme ? readme.slice(0, 1500) : null,
        hasTests,
        hasCi,
        sha: headSha,
        bandKey: bandForStars(stars, bands ?? DEFAULT_DISCOVER_STAR_BANDS),
        velocityPerWeek: velocityFromHistory(starDeltas),
        skills: [...new Set(skillIds)],
        lastEnrichedAt: now,
      },
    });
    result.enriched += 1;
  }
  return result;
}
