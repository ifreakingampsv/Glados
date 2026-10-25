// S3a shelf core (D90/D91/D96): the shared corpus — curated-list ingest, the
// anti-generic gates, and the upsert both lanes converge on. Global rows, no
// user_id; eligibility is a flag, never a delete (D91). The night job NEVER
// writes skills/event tables; tagging happens in shelf-enrich via the
// read-only ladder only.

import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import type { GithubRepoData, GitHubReader } from "@/services/github-discovery";

// ---------- config defaults (single source; seeded by seed-config) ----------

export interface DiscoverListConfig {
  key: string;
  repo: string; // owner/name of the list repository
  file: string; // README path inside it
  enabled: boolean;
}

export interface DiscoverArchetype {
  key: string;
  name: string;
  titlePatterns: string[];
  topics: string[];
  languages: string[];
  enabled: boolean;
}

export interface DiscoverStarBand {
  key: string;
  min: number;
  max: number;
}

export const DEFAULT_DISCOVER_LISTS: DiscoverListConfig[] = [
  {
    key: "build-your-own-x",
    repo: "codecrafters-io/build-your-own-x",
    file: "README.md",
    enabled: true,
  },
  {
    key: "project-based-learning",
    repo: "practical-tutorials/project-based-learning",
    file: "README.md",
    enabled: true,
  },
  {
    key: "app-ideas",
    repo: "florinpop17/app-ideas",
    file: "README.md",
    enabled: false,
  },
];

// ~6–10 seed archetypes from the user's own target roles (D90); grown as
// config rows, never a taxonomy (§5).
export const DEFAULT_DISCOVER_ARCHETYPES: DiscoverArchetype[] = [
  {
    key: "ai-llm-engineer",
    name: "AI / LLM engineer",
    titlePatterns: [
      "ai engineer",
      "llm",
      "ml engineer",
      "machine learning",
      "genai",
    ],
    topics: ["llm", "rag", "agents", "vector-database", "mcp"],
    languages: ["typescript", "python"],
    enabled: true,
  },
  {
    key: "fullstack-ts",
    name: "Full-stack TypeScript",
    titlePatterns: [
      "full stack",
      "fullstack",
      "full-stack",
      "web developer",
      "frontend",
    ],
    topics: ["nextjs", "react", "typescript", "trpc", "webapp"],
    languages: ["typescript"],
    enabled: true,
  },
  {
    key: "backend-engineer",
    name: "Backend engineer",
    titlePatterns: ["backend", "back-end", "api engineer", "platform engineer"],
    topics: ["api", "graphql", "database", "redis", "backend"],
    languages: ["typescript", "python", "go"],
    enabled: true,
  },
  {
    key: "data-engineer",
    name: "Data engineer",
    titlePatterns: [
      "data engineer",
      "data engineering",
      "etl",
      "analytics engineer",
    ],
    topics: ["etl", "airflow", "dbt", "data-pipeline", "spark"],
    languages: ["python", "sql"],
    enabled: true,
  },
  {
    key: "devtools-cli",
    name: "Dev tools & CLI",
    titlePatterns: ["devops", "platform", "infrastructure", "sre", "tooling"],
    topics: ["cli", "developer-tools", "terminal", "docker", "kubernetes"],
    languages: ["rust", "go", "typescript"],
    enabled: true,
  },
  {
    key: "mobile-engineer",
    name: "Mobile engineer",
    titlePatterns: ["mobile", "android", "ios", "react native", "flutter"],
    topics: ["android", "ios", "react-native", "flutter", "expo"],
    languages: ["kotlin", "swift", "typescript", "dart"],
    enabled: true,
  },
];

export const DEFAULT_DISCOVER_STAR_BANDS: DiscoverStarBand[] = [
  { key: "underrated", min: 50, max: 300 },
  { key: "solid", min: 300, max: 1500 },
  { key: "established", min: 1500, max: 8000 },
];

export const DEFAULT_DISCOVER_GRID = {
  queryCap: 200,
  pushedWithinDays: 180,
};

export const DEFAULT_DISCOVER_AVOID = {
  topics: [
    "chat-with-pdf",
    "template",
    "boilerplate",
    "starter",
    "awesome-list",
    "course",
    "interview-questions",
    "roadmap",
    "cheatsheet",
  ],
  keywords: [
    "chat with pdf",
    "boilerplate",
    "starter template",
    "awesome list",
    "interview questions",
    "cheat sheet",
    "roadmap",
  ],
};

export const DEFAULT_DISCOVER_WEIGHTS = {
  recency: 1,
  velocity: 1.5,
  tests: 1,
  ci: 0.5,
  docs: 0.5,
  license: 0.5,
};

export const DEFAULT_DISCOVER_FILTERS = {
  deadPushDays: 540, // 18 months silent → off the shelf (D91)
  sizeKbCeiling: 60_000, // solo-modifiability ceiling (D92)
};

export const DEFAULT_DISCOVER_MATCH_WEIGHTS = {
  evidenced: 1,
  claimed: 0.5,
  archetype: 0.75,
  stretchBoost: 0.15,
};

export const DEFAULT_DISCOVER_DIFFICULTY = {
  // sizeKb thresholds mapping a repo to a 1–5 difficulty scale (D93 proxy).
  sizeTiers: [500, 2000, 8000, 25000],
  establishedStarsBump: 3000,
};

export const DEFAULT_DISCOVER_ANNOTATE_TOP_N = 40;

export const DEFAULT_DISCOVER_TELEMETRY_MINIMUMS = {
  minImpressionsForCtr: 50,
};

export const DEFAULT_FLAGSHIP_PROMPT_TEMPLATE =
  "Find me a flagship rebuild repo. Deep-dive the project {{repo}} ({{url}})." +
  " My skill context: {{skills}}. Score it on ~7 dimensions (memorability, technical depth, what I'd learn), " +
  "list 3-5 modifications that would make it a portfolio standout, rate the portfolio value, " +
  "and note its limitations. Be brutally honest about generic-wrapper patterns.";

export const DISCOVER_FLAG = "discover";

// Absent row = enabled (gateway checkFlag precedent): the flag is a kill
// switch, not an opt-in.
export async function isDiscoverEnabled(): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({
    where: { key: DISCOVER_FLAG },
  });
  return flag ? flag.enabled : true;
}

export async function getArchetypes(): Promise<DiscoverArchetype[]> {
  return getConfig<DiscoverArchetype[]>(
    "discover.archetypes",
    DEFAULT_DISCOVER_ARCHETYPES
  );
}

export async function getStarBands(): Promise<DiscoverStarBand[]> {
  return getConfig<DiscoverStarBand[]>(
    "discover.starBands",
    DEFAULT_DISCOVER_STAR_BANDS
  );
}

// ---------- anti-generic gates (D90: config rows, seeded from the avoid-list) ----------

export interface GateResult {
  eligible: boolean;
  reason?: "fork" | "archived" | "avoid-topic" | "avoid-keyword" | "unlicensed";
}

export function passesGates(
  repo: GithubRepoData,
  avoid: { topics: string[]; keywords: string[] },
  requireLicense = false
): GateResult {
  if (repo.isFork) return { eligible: false, reason: "fork" };
  if (repo.archived) return { eligible: false, reason: "archived" };
  const topics = repo.topics.map((t) => t.toLowerCase());
  if (topics.some((t) => avoid.topics.includes(t)))
    return { eligible: false, reason: "avoid-topic" };
  const haystack = `${repo.fullName} ${repo.description ?? ""}`.toLowerCase();
  if (avoid.keywords.some((k) => haystack.includes(k)))
    return { eligible: false, reason: "avoid-keyword" };
  if (requireLicense && !repo.license)
    return { eligible: false, reason: "unlicensed" };
  return { eligible: true };
}

// ---------- the shared upsert both lanes converge on (D96f: ONE shelf) ----------

export async function upsertRepoFromGithub(
  data: GithubRepoData,
  opts: { lane: "list" | "search"; now?: Date; gate?: GateResult }
): Promise<{ repoId: string; eligible: boolean }> {
  const now = opts.now ?? new Date();
  const gate =
    opts.gate ??
    passesGates(
      data,
      await getConfig("discover.avoid", DEFAULT_DISCOVER_AVOID)
    );
  const values = {
    fullName: data.fullName,
    description: data.description,
    htmlUrl: data.htmlUrl,
    stars: data.stars,
    language: data.language,
    topics: data.topics,
    forks: data.forks,
    isFork: data.isFork,
    archived: data.archived,
    license: data.license,
    sizeKb: data.sizeKb,
    defaultBranch: data.defaultBranch,
    pushedAt: data.pushedAt,
    shelfEligible: gate.eligible,
    updatedAt: now,
    ...(opts.lane === "list" ? { laneList: true } : { laneSearch: true }),
  };
  const repo = await db.repo.upsert({
    where: { githubId: data.githubId },
    update: values,
    create: { githubId: data.githubId, ...values },
  });
  return { repoId: repo.id, eligible: gate.eligible };
}

// ---------- curated-list lane (D90: weekly re-ingest) ----------

export interface ParsedListRow {
  name: string;
  owner: string;
  repoName: string;
}

export function parseListRows(markdown: string): ParsedListRow[] {
  const rows: ParsedListRow[] = [];
  const re =
    /[-*]\s+\[([^\]]+)\]\(\s*https?:\/\/(?:www\.)?github\.com\/([^/\s)#]+)\/([^/\s)#]+)[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const [, name, owner, repoName] = m;
    if (repoName.endsWith(".git")) continue;
    rows.push({ name: name.trim(), owner, repoName });
  }
  return rows;
}

export interface IngestResult {
  lists: number;
  candidates: number;
  upserted: number;
  eligible: number;
  gatedOut: Record<string, number>;
  skipped?: string;
}

export async function ingestCuratedLists(
  reader: GitHubReader,
  opts: { now?: Date } = {}
): Promise<IngestResult> {
  if (!(await isDiscoverEnabled())) {
    return {
      lists: 0,
      candidates: 0,
      upserted: 0,
      eligible: 0,
      gatedOut: {},
      skipped: "flag-off",
    };
  }
  const now = opts.now ?? new Date();
  const lists = (
    await getConfig<DiscoverListConfig[]>(
      "discover.lists",
      DEFAULT_DISCOVER_LISTS
    )
  ).filter((l) => l.enabled);
  const avoid = await getConfig("discover.avoid", DEFAULT_DISCOVER_AVOID);
  const result: IngestResult = {
    lists: 0,
    candidates: 0,
    upserted: 0,
    eligible: 0,
    gatedOut: {},
  };

  for (const list of lists) {
    const [listOwner, listName] = list.repo.split("/");
    const markdown = await reader.getFileContent(
      listOwner,
      listName,
      list.file
    );
    if (markdown == null) continue;
    result.lists += 1;
    const seen = new Set<string>();
    for (const row of parseListRows(markdown)) {
      const key = `${row.owner}/${row.repoName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.candidates += 1;
      const data = await reader.getRepo(row.owner, row.repoName);
      if (!data) continue;
      const gate = passesGates(data, avoid);
      if (!gate.eligible && gate.reason) {
        result.gatedOut[gate.reason] = (result.gatedOut[gate.reason] ?? 0) + 1;
      }
      const { eligible } = await upsertRepoFromGithub(data, {
        lane: "list",
        now,
        gate,
      });
      await db.repoListMembership.upsert({
        where: {
          repoGithubId_listKey: {
            repoGithubId: data.githubId,
            listKey: list.key,
          },
        },
        update: { lastSeenAt: now },
        create: {
          repoGithubId: data.githubId,
          listKey: list.key,
          lastSeenAt: now,
        },
      });
      result.upserted += 1;
      if (eligible) result.eligible += 1;
    }
  }
  return result;
}
