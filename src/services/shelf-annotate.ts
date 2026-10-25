// S3a annotator (D92/D96g): the ONLY AI layer in the slice. Top-N new nightly
// survivors get one annotation each — why memorable, 3–5 modification ideas,
// learning payoff — through the platform-only repo_annotate route (shared
// asset, D78f). The RepoAnnotation row IS the cache (repo + branch sha):
// unchanged repos never regenerate, and annotations NEVER affect rank order.

import { db } from "@/lib/db";
import { gatewayCall } from "@/services/gateway";
import { getConfig } from "@/services/levels";
import {
  DEFAULT_DISCOVER_ANNOTATE_TOP_N,
  isDiscoverEnabled,
} from "@/services/shelf";

const ANNOTATE_TIMEOUT_MS = 120_000; // bank/grade class (D96g)

interface AnnotationPayload {
  memorableWhy: string;
  modificationIdeas: string[];
  learningPayoff: string;
}

export interface AnnotateResult {
  candidates: number;
  annotated: number;
  failed: number;
  skipped?: string;
}

function parseAnnotation(raw: string): AnnotationPayload | null {
  try {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const parsed = JSON.parse(trimmed) as Partial<AnnotationPayload>;
    if (
      typeof parsed.memorableWhy === "string" &&
      parsed.memorableWhy.length > 0 &&
      Array.isArray(parsed.modificationIdeas) &&
      parsed.modificationIdeas.length >= 1 &&
      parsed.modificationIdeas.every(
        (i) => typeof i === "string" && i.length > 0
      ) &&
      typeof parsed.learningPayoff === "string" &&
      parsed.learningPayoff.length > 0
    ) {
      return {
        memorableWhy: parsed.memorableWhy,
        modificationIdeas: parsed.modificationIdeas.slice(0, 8),
        learningPayoff: parsed.learningPayoff,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function runAnnotations(
  opts: { now?: Date; limit?: number; fetchImpl?: typeof fetch } = {}
): Promise<AnnotateResult> {
  if (!(await isDiscoverEnabled())) {
    return { candidates: 0, annotated: 0, failed: 0, skipped: "flag-off" };
  }
  const topN =
    opts.limit ??
    (await getConfig<number>(
      "discover.annotateTopN",
      DEFAULT_DISCOVER_ANNOTATE_TOP_N
    ));

  // New survivors: eligible, scored, and either unannotated or their code moved.
  const repos = await db.repo.findMany({
    where: { shelfEligible: true, sha: { not: null } },
    orderBy: { score: "desc" },
    take: 500,
  });
  const annotations = await db.repoAnnotation.findMany();
  const stale = new Map(annotations.map((a) => [a.repoGithubId, a.sha]));
  const candidates = repos
    .filter((r) => r.sha != null && stale.get(r.githubId) !== r.sha)
    .slice(0, topN);

  const result: AnnotateResult = {
    candidates: candidates.length,
    annotated: 0,
    failed: 0,
  };
  if (candidates.length === 0) return result;

  // Canonical skill display names for the prompt.
  const skillIds = [...new Set(candidates.flatMap((r) => r.skills))];
  const skills = await db.skill.findMany({ where: { id: { in: skillIds } } });
  const skillName = new Map(skills.map((s) => [s.id, s.display]));

  for (const repo of candidates) {
    const gw = await gatewayCall(
      {
        userId: "system", // corpus upkeep, not a user feature — metered, energy-free
        feature: "repo_annotate",
        skipEnergy: true,
        timeoutMs: ANNOTATE_TIMEOUT_MS,
        messages: [
          {
            role: "system",
            content:
              'You annotate rebuildable open-source projects for a job-seeker\'s project-discovery shelf. Base everything ONLY on the provided repo facts; never invent features. Return JSON only: {"memorableWhy": string, "modificationIdeas": string[] (3-5 concrete portfolio-worthy modifications), "learningPayoff": string}',
          },
          {
            role: "user",
            content: JSON.stringify({
              fullName: repo.fullName,
              description: repo.description,
              language: repo.language,
              topics: repo.topics,
              stars: repo.stars,
              starBand: repo.bandKey,
              skills: repo.skills.map((s) => skillName.get(s) ?? s),
              readmeExcerpt: repo.readmeExcerpt?.slice(0, 1200) ?? null,
            }),
          },
        ],
      },
      opts.fetchImpl
    );
    if (gw.status !== "ok") {
      result.failed += 1;
      continue;
    }
    const parsed = parseAnnotation(gw.content);
    if (!parsed) {
      result.failed += 1;
      continue;
    }
    await db.repoAnnotation.upsert({
      where: { repoGithubId: repo.githubId },
      update: {
        sha: repo.sha ?? "",
        memorableWhy: parsed.memorableWhy,
        modificationIdeas: parsed.modificationIdeas,
        learningPayoff: parsed.learningPayoff,
      },
      create: {
        repoGithubId: repo.githubId,
        sha: repo.sha ?? "",
        memorableWhy: parsed.memorableWhy,
        modificationIdeas: parsed.modificationIdeas,
        learningPayoff: parsed.learningPayoff,
      },
    });
    result.annotated += 1;
  }
  return result;
}
