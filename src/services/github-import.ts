import { Prisma } from "@prisma/client";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import { appendEvent } from "@/services/events";
import {
  AUTO_ACCEPT_MIN_LENGTH,
  editDistance,
  normalizeTag,
} from "@/services/skills";
import { resolveSkillId } from "@/lib/skill-resolution";
import {
  enqueueJob,
  processQueueOnce,
  registerQueueProcessor,
} from "@/services/worker";

export const GITHUB_IMPORT_QUEUE = "github_import";
export const FORK_EXPLAINER_TEXT =
  "only include repos you can talk about in depth, not minor-change forks";

export interface GithubRepoFixture {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  fork: boolean;
  pushedAt: string;
  language: string | null;
  topics?: string[];
  hasUserCommits?: boolean;
  hasReadme?: boolean;
  dependencyFiles?: Record<string, string>;
}

export interface RepoSelectionItem {
  repo: GithubRepoFixture;
  preselected: boolean;
  reason: string;
}

export interface GithubImportJobPayload {
  userId: string;
  repo: GithubRepoFixture;
}

// ---------- 1. Clerk GitHub OAuth token helper (D45) ----------

export async function getClerkGithubToken(clerkUserId: string): Promise<{
  connected: boolean;
  token: string | null;
  scopes: string[];
}> {
  if (!clerkUserId) {
    return { connected: false, token: null, scopes: [] };
  }
  try {
    const client = await clerkClient();
    const res = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "oauth_github"
    );
    const first = res.data?.[0];
    if (!first || !first.token) {
      return { connected: false, token: null, scopes: [] };
    }
    return {
      connected: true,
      token: first.token,
      scopes: first.scopes ?? ["public_repo"],
    };
  } catch {
    return { connected: false, token: null, scopes: [] };
  }
}

export async function fetchPublicReposForClerkUser(
  clerkUserId: string
): Promise<{
  connected: boolean;
  repos: GithubRepoFixture[];
}> {
  const oauth = await getClerkGithubToken(clerkUserId);
  if (!oauth.connected || !oauth.token) {
    return { connected: false, repos: [] };
  }
  try {
    const res = await fetch(
      "https://api.github.com/user/repos?visibility=public&sort=pushed&per_page=100",
      {
        headers: {
          Authorization: `Bearer ${oauth.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return { connected: true, repos: [] };
    }
    const raw = (await res.json()) as Array<{
      id: number | string;
      name: string;
      full_name: string;
      description: string | null;
      html_url: string;
      fork: boolean;
      pushed_at: string;
      language: string | null;
      topics?: string[];
      size?: number;
    }>;
    const repos: GithubRepoFixture[] = raw.map((r) => ({
      id: String(r.id),
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? "",
      htmlUrl: r.html_url,
      fork: Boolean(r.fork),
      pushedAt: r.pushed_at ?? new Date(0).toISOString(),
      language: r.language ?? null,
      topics: Array.isArray(r.topics) ? r.topics : [],
      hasUserCommits: (r.size ?? 0) > 0,
      hasReadme: (r.size ?? 0) > 0,
    }));
    return { connected: true, repos };
  } catch {
    return { connected: true, repos: [] };
  }
}

// ---------- 2. Smart preselection + fork explainer ----------

const RECENT_ACTIVITY_WINDOW_MS = 365 * 86_400_000;

export function prepareRepoSelectionList(repos: GithubRepoFixture[]): {
  items: RepoSelectionItem[];
  forkExplainer: string;
} {
  const now = Date.now();
  const items: RepoSelectionItem[] = repos.map((repo) => {
    const pushedMs = Date.parse(repo.pushedAt || "") || 0;
    const recentPush = now - pushedMs <= RECENT_ACTIVITY_WINDOW_MS;
    const hasCommits = repo.hasUserCommits ?? true;
    const hasReadme = repo.hasReadme ?? true;
    const hasMetadataSignal = Boolean(
      repo.language ||
      (repo.topics && repo.topics.length > 0) ||
      (repo.description && repo.description.trim().length > 0)
    );

    if (repo.fork) {
      return {
        repo,
        preselected: false,
        reason: FORK_EXPLAINER_TEXT,
      };
    }

    const hasSignal =
      hasCommits && hasReadme && recentPush && hasMetadataSignal;
    return {
      repo,
      preselected: hasSignal,
      reason: hasSignal
        ? "Active non-fork with user commits, recent push, and README"
        : "Unchecked by default (low recent activity or missing README/commits)",
    };
  });

  items.sort((a, b) => {
    if (a.preselected !== b.preselected) {
      return a.preselected ? -1 : 1;
    }
    const aTime = Date.parse(a.repo.pushedAt || "") || 0;
    const bTime = Date.parse(b.repo.pushedAt || "") || 0;
    return bTime - aTime;
  });

  return {
    items,
    forkExplainer: FORK_EXPLAINER_TEXT,
  };
}

// ---------- 3. Deterministic skill extraction through resolution ladder ----------

const PACKAGE_TOKEN_HINTS: Record<string, string> = {
  next: "nextjs",
  "@prisma/client": "prisma",
  prisma: "prisma",
  pg: "postgresql",
  postgres: "postgresql",
  tailwindcss: "tailwindcss",
  "@tailwindcss/postcss": "tailwindcss",
  react: "react",
  "react-dom": "react",
  typescript: "typescript",
  vitest: "testing",
  jest: "testing",
  playwright: "testing",
  express: "nodejs",
  fastify: "nodejs",
  redis: "redis",
  ioredis: "redis",
  "@aws-sdk/client-s3": "aws",
  "aws-sdk": "aws",
  dockerfile: "docker",
};

function parseDependencyTokens(
  dependencyFiles?: Record<string, string>
): string[] {
  if (!dependencyFiles) return [];
  const tokens: string[] = [];

  for (const [filename, content] of Object.entries(dependencyFiles)) {
    const lowerName = filename.toLowerCase();
    if (lowerName.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const depNames = [
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
        ];
        for (const dep of depNames) {
          tokens.push(PACKAGE_TOKEN_HINTS[dep.toLowerCase()] ?? dep);
        }
      } catch {
        // ignore malformed package.json
      }
    } else if (lowerName.endsWith("cargo.toml")) {
      tokens.push("rust");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*=/);
        if (
          match &&
          match[1] !== "name" &&
          match[1] !== "version" &&
          match[1] !== "edition"
        ) {
          tokens.push(PACKAGE_TOKEN_HINTS[match[1].toLowerCase()] ?? match[1]);
        }
      }
    } else if (
      lowerName.endsWith("requirements.txt") ||
      lowerName.endsWith("pyproject.toml")
    ) {
      tokens.push("python");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*([a-zA-Z0-9_-]+)/);
        if (match) tokens.push(match[1]);
      }
    } else if (lowerName.endsWith("go.mod")) {
      tokens.push("go");
    } else if (
      lowerName.includes("dockerfile") ||
      lowerName.includes("docker-compose")
    ) {
      tokens.push("docker");
    }
  }

  return tokens;
}

async function resolveDeterministicCanonicalSkill(
  rawToken: string
): Promise<string | null> {
  const mapped = PACKAGE_TOKEN_HINTS[rawToken.trim().toLowerCase()] ?? rawToken;
  const tag = normalizeTag(mapped);
  if (!tag) return null;

  // Step 1: Exact canonical ACTIVE skill
  const exact = await db.skill.findFirst({
    where: { name: tag, status: "ACTIVE" },
  });
  if (exact) return resolveSkillId(exact.id);

  // Step 2: Exact alias
  const alias = await db.skillAlias.findUnique({ where: { alias: tag } });
  if (alias) {
    const target = await db.skill.findUnique({ where: { id: alias.skillId } });
    if (target && target.status === "ACTIVE") {
      return resolveSkillId(target.id);
    }
  }

  // Step 3: D33a distance <= 1 auto-accept for normalized strings >= 4 chars
  if (tag.length >= AUTO_ACCEPT_MIN_LENGTH) {
    const activeSkills = await db.skill.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
    });
    for (const skill of activeSkills) {
      if (editDistance(tag, skill.name) <= 1) {
        return resolveSkillId(skill.id);
      }
    }
  }

  return null;
}

export async function extractSkillsFromRepoFixture(
  repo: GithubRepoFixture
): Promise<string[]> {
  const rawTokens: string[] = [];
  if (repo.language) rawTokens.push(repo.language);
  if (repo.topics) rawTokens.push(...repo.topics);
  rawTokens.push(...parseDependencyTokens(repo.dependencyFiles));

  const resolvedIds = new Set<string>();
  for (const token of rawTokens) {
    const id = await resolveDeterministicCanonicalSkill(token);
    if (id) resolvedIds.add(id);
  }
  return Array.from(resolvedIds);
}

// ---------- 4. Project upsert + repo_imported event ----------

export async function importSingleGithubRepo(
  userId: string,
  repo: GithubRepoFixture
) {
  const skills = await extractSkillsFromRepoFixture(repo);
  const existingProjects = await db.project.findMany({
    where: { userId },
  });

  const match = existingProjects.find((p) => {
    const links = Array.isArray(p.links)
      ? (p.links as Array<{ label?: string; url?: string }>)
      : [];
    const sameUrl = links.some((l) => l.url && l.url === repo.htmlUrl);
    return sameUrl || p.title.toLowerCase() === repo.name.toLowerCase();
  });

  const description =
    repo.description && repo.description.trim().length > 0
      ? repo.description.trim()
      : `GitHub repository ${repo.fullName}`;
  const links = [{ label: "GitHub", url: repo.htmlUrl }];

  const project = match
    ? await db.project.update({
        where: { id: match.id },
        data: {
          title: repo.name.trim(),
          description,
          links: links as unknown as Prisma.InputJsonValue,
          skills: Array.from(new Set([...(match.skills ?? []), ...skills])),
        },
      })
    : await db.project.create({
        data: {
          userId,
          title: repo.name.trim(),
          description,
          links: links as unknown as Prisma.InputJsonValue,
          skills,
        },
      });

  // D46: Forks, if explicitly selected, import with zero-weight evidence (0 points)
  await appendEvent({
    userId,
    source: "web",
    type: "repo_imported",
    skills,
    payload: {
      project_id: project.id,
      repo_id: repo.id,
      full_name: repo.fullName,
      html_url: repo.htmlUrl,
      fork: repo.fork,
    },
    pointsOverride: repo.fork ? 0 : undefined,
  });

  return project;
}

// Register queue processor on worker
registerQueueProcessor<GithubImportJobPayload>(
  GITHUB_IMPORT_QUEUE,
  async (data) => {
    const project = await importSingleGithubRepo(data.userId, data.repo);
    return { projectId: project.id };
  }
);

export async function getGithubImportCap(): Promise<number> {
  const cfg = await getConfig<{ maxPerBatch?: number }>("imports.githubCap", {
    maxPerBatch: 25,
  });
  return cfg.maxPerBatch ?? 25;
}

export async function enqueueGithubImportBatch(
  userId: string,
  repos: GithubRepoFixture[],
  options: { DryRunCapOnly?: boolean } = {}
): Promise<{ acceptedCount: number; cap: number; jobIds: string[] }> {
  const cap = await getGithubImportCap();
  if (repos.length > cap) {
    throw new Error(
      `Selection of ${repos.length} repos exceeds the GitHub import cap of ${cap} per batch. Use "Import more" for additional batches.`
    );
  }
  if (options.DryRunCapOnly) {
    return { acceptedCount: repos.length, cap, jobIds: [] };
  }

  const jobIds: string[] = [];
  for (const repo of repos) {
    const id = await enqueueJob<GithubImportJobPayload>(GITHUB_IMPORT_QUEUE, {
      userId,
      repo,
    });
    if (id) jobIds.push(id);
  }
  return { acceptedCount: repos.length, cap, jobIds };
}

// D58: "Sync now" re-imports selected repos on demand (enqueues + drains in-process if worker is not separate)
export async function syncGithubReposNow(
  userId: string,
  repos: GithubRepoFixture[]
): Promise<{ syncedCount: number }> {
  await enqueueGithubImportBatch(userId, repos);
  const processed = await processQueueOnce(
    GITHUB_IMPORT_QUEUE,
    Math.max(10, repos.length)
  );
  return { syncedCount: processed };
}
