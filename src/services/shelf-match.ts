// S3a day job (D93/D96): the spine match. Three signals — evidenced skills,
// claimed skills, target-role archetype tech — score shelf repos against the
// user, every card provenance-labeled, level-adaptivity as a soft "stretch"
// badge (never a filter), strengths default with a persisted gaps toggle.
// Already-imported repos are excluded; an empty spine falls back to the global
// top shelf. LIVE indexed query per visit — no precompute, no per-user cache,
// no AI at render time (fit lines are deterministic template interpolation).

import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import { getPreferences } from "@/services/profile";
import {
  DEFAULT_DISCOVER_DIFFICULTY,
  DEFAULT_DISCOVER_MATCH_WEIGHTS,
  DEFAULT_FLAGSHIP_PROMPT_TEMPLATE,
  getArchetypes,
  type DiscoverArchetype,
} from "@/services/shelf";
import { matchArchetypesForTitles } from "@/services/shelf-grid";

export interface DiscoverCard {
  githubId: number;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  language: string | null;
  bandKey: string | null;
  laneList: boolean;
  laneSearch: boolean;
  crossListCount: number;
  skills: string[]; // canonical skill ids
  shelfScore: number;
  fitLines: string[]; // deterministic provenance labels (D93)
  stretch: boolean;
  archetypeKey: string | null;
  annotation: {
    memorableWhy: string;
    modificationIdeas: string[];
    learningPayoff: string;
  } | null;
}

export interface DiscoverResult {
  cards: DiscoverCard[];
  fallback: boolean; // true = global top shelf (empty or signal-less spine)
  gapsMode: boolean;
  archetypes: { key: string; name: string; active: boolean }[];
  signals: { evidenced: string[]; claimed: string[]; target: string[] };
}

type MatchWeights = typeof DEFAULT_DISCOVER_MATCH_WEIGHTS;
type DifficultyCfg = typeof DEFAULT_DISCOVER_DIFFICULTY;

export function repoDifficulty(
  repo: { sizeKb: number; stars: number },
  cfg: DifficultyCfg
): number {
  const tier =
    cfg.sizeTiers.findIndex((t) => repo.sizeKb <= t) === -1
      ? cfg.sizeTiers.length + 1
      : cfg.sizeTiers.findIndex((t) => repo.sizeKb <= t) + 1;
  const bumped = repo.stars >= cfg.establishedStarsBump ? tier + 1 : tier;
  return Math.max(1, Math.min(5, bumped));
}

export async function getUserSignals(userId: string) {
  const [userSkills, roles, prefs, archetypes] = await Promise.all([
    db.userSkill.findMany({ where: { userId } }),
    db.targetRole.findMany({ where: { userId } }),
    getPreferences(userId),
    getArchetypes(),
  ]);
  const evidenced = userSkills.filter((s) => s.level > 0 || s.score > 0);
  const claimed = userSkills.filter(
    (s) => s.claimedLevel != null && !(s.level > 0 || s.score > 0)
  );
  const picksRaw =
    prefs.find((p) => p.key === "discover_archetypes")?.value ?? "";
  const explicitPicks = picksRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const titles = roles.map((r) => r.title);
  const inferred = matchArchetypesForTitles(titles, archetypes);
  // D96d/D73: explicit picks beat inference; inference fills only what's unset.
  const activeArchetypes = explicitPicks.length ? explicitPicks : inferred;
  return {
    evidencedIds: new Set(evidenced.map((s) => s.skillId)),
    claimedIds: new Set(claimed.map((s) => s.skillId)),
    allHaveIds: new Set([...evidenced, ...claimed].map((s) => s.skillId)),
    maxEvidencedLevel: evidenced.reduce((m, s) => Math.max(m, s.level), 0),
    hasSignals:
      evidenced.length > 0 || claimed.length > 0 || inferred.length > 0,
    archetypeKeys: activeArchetypes,
    archetypes,
    gapsMode: prefs.find((p) => p.key === "discover_gaps_mode")?.value === "on",
  };
}

function archetypeForRepo(
  repo: { language: string | null; topics: string[] },
  activeKeys: string[],
  archetypes: DiscoverArchetype[]
): string | null {
  for (const key of activeKeys) {
    const a = archetypes.find((x) => x.key === key);
    if (!a) continue;
    if (
      repo.language &&
      a.languages
        .map((l) => l.toLowerCase())
        .includes(repo.language.toLowerCase())
    )
      return key;
    if (repo.topics.some((t) => a.topics.includes(t.toLowerCase()))) return key;
  }
  return null;
}

function buildFitLines(opts: {
  evidencedHits: string[];
  claimedHits: string[];
  archetype: DiscoverArchetype | undefined;
  stretch: boolean;
  skillNames: Map<string, string>;
}): string[] {
  const lines: string[] = [];
  for (const id of opts.evidencedHits.slice(0, 2))
    lines.push(`matches your evidenced ${opts.skillNames.get(id) ?? "skill"}`);
  for (const id of opts.claimedHits.slice(0, 1))
    lines.push(`matches your claimed ${opts.skillNames.get(id) ?? "skill"}`);
  if (opts.archetype) lines.push(`fits your ${opts.archetype.name} target`);
  if (opts.stretch)
    lines.push("stretch — one level above your evidenced skills");
  return lines;
}

export async function getDiscoverCards(
  userId: string,
  opts: {
    mode?: "strengths" | "gaps";
    logImpressions?: boolean;
    limit?: number;
  } = {}
): Promise<DiscoverResult> {
  const signals = await getUserSignals(userId);
  const gapsMode =
    opts.mode === "gaps" || (opts.mode == null && signals.gapsMode);
  const weights = await getConfig<MatchWeights>(
    "discover.matchWeights",
    DEFAULT_DISCOVER_MATCH_WEIGHTS
  );
  const diffCfg = await getConfig<DifficultyCfg>(
    "discover.difficulty",
    DEFAULT_DISCOVER_DIFFICULTY
  );

  const repos = await db.repo.findMany({
    where: { shelfEligible: true },
    orderBy: { score: "desc" },
    take: 500,
  });

  // D93: never recommend the user's own imported work.
  const projects = await db.project.findMany({
    where: { userId },
    select: { links: true },
  });
  const ownRepoNames = new Set<string>();
  for (const p of projects) {
    const links = Array.isArray(p.links) ? (p.links as unknown[]) : [];
    for (const l of links) {
      const m = /github\.com\/([^/\s"]+)\/([^/\s"#?]+)/.exec(String(l));
      if (m) ownRepoNames.add(`${m[1]}/${m[2]}`.toLowerCase());
    }
  }
  const candidates = repos.filter(
    (r) => !ownRepoNames.has(r.fullName.toLowerCase())
  );

  const skillIds = [...new Set(candidates.flatMap((r) => r.skills))];
  const skills = await db.skill.findMany({ where: { id: { in: skillIds } } });
  const skillNames = new Map(skills.map((s) => [s.id, s.display]));

  const scored = candidates.map((repo) => {
    const evidencedHits = repo.skills.filter((s) =>
      signals.evidencedIds.has(s)
    );
    const claimedHits = repo.skills.filter((s) => signals.claimedIds.has(s));
    const archKey = archetypeForRepo(
      repo,
      signals.archetypeKeys,
      signals.archetypes
    );
    const archetype = signals.archetypes.find((a) => a.key === archKey);
    const newSkills = repo.skills.filter((s) => !signals.allHaveIds.has(s));

    const matchScore = gapsMode
      ? newSkills.length + (archKey ? 0.5 : 0)
      : evidencedHits.length * weights.evidenced +
        claimedHits.length * weights.claimed +
        (archKey ? weights.archetype : 0);
    const difficulty = repoDifficulty(repo, diffCfg);
    const stretch =
      !gapsMode &&
      signals.maxEvidencedLevel > 0 &&
      evidencedHits.length > 0 &&
      difficulty === signals.maxEvidencedLevel + 1;
    return {
      repo,
      matchScore: matchScore + (stretch ? weights.stretchBoost : 0),
      evidencedHits,
      claimedHits,
      archetype,
      archKey,
      stretch,
      newSkills,
    };
  });

  const withSignal = scored.filter((s) => s.matchScore > 0);
  const usingFallback = !signals.hasSignals || withSignal.length === 0;
  const pool = usingFallback
    ? scored.map((s) => ({ ...s, matchScore: 0 })) // global order by shelf score
    : withSignal;
  const ranked = pool
    .sort((a, b) => b.matchScore - a.matchScore || b.repo.score - a.repo.score)
    .slice(0, opts.limit ?? 5);

  const annotationRows = ranked.length
    ? await db.repoAnnotation.findMany({
        where: { repoGithubId: { in: ranked.map((r) => r.repo.githubId) } },
      })
    : [];
  const annotations = new Map(annotationRows.map((a) => [a.repoGithubId, a]));

  const cards: DiscoverCard[] = ranked.map((r) => ({
    githubId: r.repo.githubId,
    fullName: r.repo.fullName,
    description: r.repo.description,
    htmlUrl: r.repo.htmlUrl,
    stars: r.repo.stars,
    language: r.repo.language,
    bandKey: r.repo.bandKey,
    laneList: r.repo.laneList,
    laneSearch: r.repo.laneSearch,
    crossListCount: r.repo.crossListCount,
    skills: r.repo.skills,
    shelfScore: r.repo.score,
    fitLines: usingFallback
      ? ["popular on the shelf — add skills or a target role to personalize"]
      : gapsMode
        ? [
            `teaches you new skills: ${r.newSkills
              .slice(0, 3)
              .map((s) => skillNames.get(s) ?? "skill")
              .join(", ")}`,
            ...(r.archetype ? [`fits your ${r.archetype.name} target`] : []),
          ]
        : buildFitLines({
            evidencedHits: r.evidencedHits,
            claimedHits: r.claimedHits,
            archetype: r.archetype,
            stretch: r.stretch,
            skillNames,
          }),
    stretch: r.stretch,
    archetypeKey: r.archKey,
    annotation: annotations.get(r.repo.githubId)
      ? {
          memorableWhy: annotations.get(r.repo.githubId)!.memorableWhy,
          modificationIdeas: (annotations.get(r.repo.githubId)!
            .modificationIdeas ?? []) as string[],
          learningPayoff: annotations.get(r.repo.githubId)!.learningPayoff,
        }
      : null,
  }));

  // Server-side impressions at match time (D95/D96): analytics, never evidence.
  if (opts.logImpressions !== false && cards.length) {
    await db.recImpression.createMany({
      data: cards.map((c) => ({
        userId,
        repoGithubId: c.githubId,
        archetypeKey: c.archetypeKey,
      })),
    });
  }

  return {
    cards,
    fallback: usingFallback,
    gapsMode,
    archetypes: signals.archetypes.map((a) => ({
      key: a.key,
      name: a.name,
      active: signals.archetypeKeys.includes(a.key),
    })),
    signals: {
      evidenced: [...signals.evidencedIds],
      claimed: [...signals.claimedIds],
      target: signals.archetypeKeys,
    },
  };
}

export async function browseShelf(filters: {
  lane?: "list" | "search";
  band?: string;
  archetype?: string;
  page?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 20;
  const where: Record<string, unknown> = { shelfEligible: true };
  if (filters.lane === "list") where.laneList = true;
  if (filters.lane === "search") where.laneSearch = true;
  if (filters.band) where.bandKey = filters.band;
  const [repos, total] = await Promise.all([
    db.repo.findMany({
      where,
      orderBy: { score: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.repo.count({ where }),
  ]);
  return { repos, total, page, pageSize };
}

export async function logCardClick(
  userId: string,
  repoGithubId: number
): Promise<void> {
  // Update the most recent shown impression for this user+repo (D95: click
  // joins the impression row — no second table, no event log).
  const latest = await db.recImpression.findFirst({
    where: { userId, repoGithubId, clickedAt: null },
    orderBy: { shownAt: "desc" },
  });
  if (latest) {
    await db.recImpression.update({
      where: { id: latest.id },
      data: { clickedAt: new Date() },
    });
  }
}

// D95/D96b: the flagship handoff. The user's own deep-dive prompt, PRE-FILLED
// with the repo + their skill context (their tokens, platform $0) — pure
// deterministic interpolation, never live personalization (§5).
export async function buildFlagshipPrompt(
  userId: string,
  repoGithubId: number
): Promise<string> {
  const template = await getConfig<string>(
    "discover.flagshipPromptTemplate",
    DEFAULT_FLAGSHIP_PROMPT_TEMPLATE
  );
  const [repo, userSkillsRaw] = await Promise.all([
    db.repo.findUnique({ where: { githubId: repoGithubId } }),
    db.userSkill.findMany({ where: { userId } }),
  ]);
  const skills = await db.skill.findMany({
    where: { id: { in: userSkillsRaw.map((s) => s.skillId) } },
  });
  const nameById = new Map(skills.map((s) => [s.id, s.display]));
  const mySkills = userSkillsRaw
    .filter((s) => s.level > 0 || s.score > 0 || s.claimedLevel != null)
    .map((s) => nameById.get(s.skillId) ?? "skill")
    .slice(0, 12);
  return template
    .replaceAll("{{repo}}", repo?.fullName ?? "the project")
    .replaceAll("{{url}}", repo?.htmlUrl ?? "")
    .replaceAll(
      "{{skills}}",
      mySkills.length ? mySkills.join(", ") : "general programming"
    );
}
