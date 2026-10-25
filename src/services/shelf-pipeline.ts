// S3a nightly chain (D90/D96i): grid → enrich → score → annotate, one
// idempotent scheduled run behind the discover flag. Re-runs are cheap by sha
// dedupe; a failed night is simply re-run. The weekly curated-list re-ingest
// is a separate schedule. Both check the flag + token at run time and skip
// gracefully — a dev box without GH_DISCOVERY_TOKEN never throws.

import { runDiscoveryGrid } from "@/services/shelf-grid";
import { runEnrichment } from "@/services/shelf-enrich";
import { runScoring } from "@/services/shelf-score";
import { runAnnotations } from "@/services/shelf-annotate";
import { ingestCuratedLists } from "@/services/shelf";
import { createHttpGitHubReader } from "@/services/github-discovery";
import { DISCOVER_FLAG, isDiscoverEnabled } from "@/services/shelf";

export const SHELF_NIGHTLY_QUEUE = "shelf_nightly";
export const SHELF_NIGHTLY_CRON = "0 2 * * *"; // 02:00 UTC nightly
export const SHELF_LISTS_QUEUE = "shelf_lists";
export const SHELF_LISTS_CRON = "30 4 * * 1"; // Mondays 04:30 UTC (weekly, D90)

export function discoveryToken(): string | undefined {
  return process.env.GH_DISCOVERY_TOKEN || undefined;
}

export async function runNightlyPipeline(
  opts: { now?: Date; fetchImpl?: typeof fetch } = {}
) {
  if (!(await isDiscoverEnabled())) return { skipped: "flag-off" as const };
  const token = discoveryToken();
  if (!token) return { skipped: "no-token" as const };
  const reader = createHttpGitHubReader(token);
  const grid = await runDiscoveryGrid(reader, opts);
  const enrich = await runEnrichment(reader, opts);
  const scoring = await runScoring(opts);
  const annotations = await runAnnotations({
    now: opts.now,
    fetchImpl: opts.fetchImpl,
  });
  return { grid, enrich, scoring, annotations };
}

export async function runWeeklyListIngest(opts: { now?: Date } = {}) {
  if (!(await isDiscoverEnabled())) return { skipped: "flag-off" as const };
  const token = discoveryToken();
  if (!token) return { skipped: "no-token" as const };
  const reader = createHttpGitHubReader(token);
  return ingestCuratedLists(reader, opts);
}

export { DISCOVER_FLAG };
