// S3a: the ONE new seam (spec Testing Decisions / D96). Everything the shelf
// pipeline knows about GitHub goes through GitHubReader; tests inject fixture
// readers below this interface and never touch the network. The real client
// is app-owned + read-only (env GH_DISCOVERY_TOKEN, D90), paced and backed off
// (D96e) — the per-user Clerk import token is never used here.

export interface GithubRepoData {
  githubId: number;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  forks: number;
  isFork: boolean;
  archived: boolean;
  license: string | null; // spdx id
  language: string | null;
  topics: string[];
  sizeKb: number;
  defaultBranch: string;
  pushedAt: Date | null;
}

export interface GitHubReader {
  /** Hard-qualified repo search (page 1, up to 30 items). */
  searchRepos(q: string): Promise<{ total: number; items: GithubRepoData[] }>;
  getRepo(owner: string, name: string): Promise<GithubRepoData | null>;
  getHeadSha(
    owner: string,
    name: string,
    branch: string
  ): Promise<string | null>;
  /** Weekly star deltas, oldest→newest (official star-history endpoint). */
  getStarHistory(owner: string, name: string): Promise<number[]>;
  getFileContent(
    owner: string,
    name: string,
    path: string
  ): Promise<string | null>;
  listDir(owner: string, name: string, path: string): Promise<string[] | null>;
}

function mapRepo(body: Record<string, unknown>): GithubRepoData {
  return {
    githubId: body.id as number,
    fullName: body.full_name as string,
    description: (body.description as string | null) ?? null,
    htmlUrl: (body.html_url as string) ?? "",
    stars: (body.stargazers_count as number) ?? (body.stars as number) ?? 0,
    forks: (body.forks_count as number) ?? 0,
    isFork: Boolean(body.fork),
    archived: Boolean(body.archived),
    license:
      (body.license && typeof body.license === "object"
        ? ((body.license as Record<string, unknown>).spdx_id as string | null)
        : null) ?? null,
    language: (body.language as string | null) ?? null,
    topics: Array.isArray(body.topics) ? (body.topics as string[]) : [],
    sizeKb: (body.size as number) ?? 0,
    defaultBranch: (body.default_branch as string) ?? "main",
    pushedAt: body.pushed_at ? new Date(body.pushed_at as string) : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Real HTTP reader. Pacing: search endpoints ~25/min, core well under the
 * 5k/hr auth'd cap (D90 rate math). Backoff: exponential retry on 429/5xx so
 * a throttled night simply slows down instead of dying (D96e).
 */
export function createHttpGitHubReader(
  token: string,
  opts: { searchIntervalMs?: number; coreIntervalMs?: number } = {}
): GitHubReader {
  const searchInterval = opts.searchIntervalMs ?? 2_100;
  const coreInterval = opts.coreIntervalMs ?? 800;
  let lastSearch = 0;
  let lastCore = 0;

  async function call(url: string, isSearch: boolean): Promise<unknown | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      // Pace by endpoint class before each request.
      const interval = isSearch ? searchInterval : coreInterval;
      const last = isSearch ? lastSearch : lastCore;
      const wait = last + interval - Date.now();
      if (wait > 0) await sleep(wait);
      if (isSearch) lastSearch = Date.now();
      else lastCore = Date.now();

      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": "2022-11-28",
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt === 3) return null;
        await sleep(2 ** attempt * 1000);
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        await sleep(2 ** attempt * 1000 + (isSearch ? searchInterval : 0));
        continue;
      }
      if (!res.ok) throw new Error(`github ${res.status}: ${url}`);
      return (await res.json()) as unknown;
    }
    return null;
  }

  return {
    async searchRepos(q: string) {
      const data = (await call(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`,
        true
      )) as Record<string, unknown> | null;
      if (!data) return { total: 0, items: [] };
      const items = Array.isArray(data.items)
        ? (data.items as Record<string, unknown>[])
        : [];
      return {
        total: (data.total_count as number) ?? items.length,
        items: items.map(mapRepo),
      };
    },
    async getRepo(owner, name) {
      const data = (await call(
        `https://api.github.com/repos/${owner}/${name}`,
        false
      )) as Record<string, unknown> | null;
      return data ? mapRepo(data) : null;
    },
    async getHeadSha(owner, name, branch) {
      const data = (await call(
        `https://api.github.com/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`,
        false
      )) as Record<string, unknown> | null;
      return data
        ? (((data.commit as Record<string, unknown>)?.sha as string) ?? null)
        : null;
    },
    async getStarHistory(owner, name) {
      // Official star-history endpoint (2026-09 changelog; D96e: exact shape
      // verified at first live run — parser accepts both known variants).
      const data = (await call(
        `https://api.github.com/repos/${owner}/${name}/star-history`,
        false
      )) as unknown;
      const points: Array<{ week?: string; stars?: number; count?: number }> =
        Array.isArray(data)
          ? (data as Array<{ week?: string; stars?: number; count?: number }>)
          : (((data as Record<string, unknown>)?.points as Array<{
              week?: string;
              stars?: number;
              count?: number;
            }>) ?? []);
      const totals = points.map((p) => p.stars ?? p.count ?? 0);
      const deltas: number[] = [];
      for (let i = 1; i < totals.length; i++)
        deltas.push(Math.max(0, totals[i] - totals[i - 1]));
      return deltas;
    },
    async getFileContent(owner, name, path) {
      const data = (await call(
        `https://api.github.com/repos/${owner}/${name}/contents/${path}`,
        false
      )) as Record<string, unknown> | null;
      if (!data || typeof data.content !== "string") return null;
      if (data.encoding === "base64")
        return Buffer.from(data.content, "base64").toString("utf8");
      return data.content;
    },
    async listDir(owner, name, path) {
      const data = (await call(
        `https://api.github.com/repos/${owner}/${name}/contents/${path}`,
        false
      )) as Array<Record<string, unknown>> | null;
      if (!Array.isArray(data)) return null;
      return data.map((e) => String(e.name));
    },
  };
}
