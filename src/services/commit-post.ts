import { db, type EventLog, type Project } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { gatewayCall } from "@/services/gateway";
import { getClerkGithubToken } from "@/services/github-import";
import { getConfig } from "@/services/levels";

const DAY_MS = 86_400_000;

export const LINKEDIN_SHARE_FLOW_GUIDE_COPY = [
  "1. Pick one draft below and edit it in your own voice (keep concrete details, cut anything that sounds generic).",
  "2. Copy your edited text and open LinkedIn (https://www.linkedin.com/feed/?shareActive=true) to paste it into a new post.",
  "3. Attach a screenshot, diagram, or link to your public GitHub commit range, choose your timing, and publish directly on LinkedIn.",
] as const;

export interface GithubCommitSummary {
  sha: string;
  message: string;
  authoredAt: string;
  authorLogin: string | null;
  authorEmail: string | null;
}

export interface CommitPostAdapters {
  githubFetch?: typeof fetch;
  gatewayFetch?: typeof fetch;
  githubToken?: string;
  githubLogin?: string;
  now?: Date;
}

export interface ProjectPostEligibility {
  projectId: string;
  isGithubLinked: boolean;
  showSurface: boolean;
  repoFullName: string | null;
  repoHtmlUrl: string | null;
  isFork: boolean;
  sinceAnchor: Date | null;
  anchorSource: "post_drafted" | "repo_imported" | "project_created" | null;
  authoredCommitCount: number;
  minCommitsPerMilestone: number;
  eligible: boolean;
  commits: GithubCommitSummary[];
  commitRange: string | null;
  weeklyDraftsUsed: number;
  maxDraftsPerWeek: number;
  weeklyCapReached: boolean;
}

export interface DraftProjectPostsResult {
  project: Project;
  drafts: string[];
  commitRange: string;
  commitCount: number;
  commits: GithubCommitSummary[];
  linkedinWhatToPostUsed: string[];
  shareFlowGuide: readonly string[];
  event: EventLog;
  via: "byo" | "platform";
}

function parseGithubRepoFromUrl(url: string): {
  fullName: string;
  htmlUrl: string;
} | null {
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.hostname !== "github.com" &&
      parsed.hostname !== "www.github.com"
    ) {
      return null;
    }
    const parts = parsed.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (parts.length < 2) return null;
    const fullName = `${parts[0]}/${parts[1]}`;
    return {
      fullName,
      htmlUrl: `https://github.com/${fullName}`,
    };
  } catch {
    return null;
  }
}

async function resolveProjectGithubLink(
  userId: string,
  project: Project
): Promise<{
  isGithubLinked: boolean;
  fullName: string | null;
  htmlUrl: string | null;
  isFork: boolean;
  importedAt: Date | null;
}> {
  // 1. Check repo_imported events for this project
  const importEvents = await db.eventLog.findMany({
    where: {
      userId,
      type: "repo_imported",
    },
    orderBy: { occurredAt: "desc" },
  });

  const matchingImport = importEvents.find((ev) => {
    if (
      !ev.payload ||
      typeof ev.payload !== "object" ||
      Array.isArray(ev.payload)
    ) {
      return false;
    }
    const payload = ev.payload as Record<string, unknown>;
    return payload.project_id === project.id;
  });

  if (
    matchingImport &&
    matchingImport.payload &&
    typeof matchingImport.payload === "object"
  ) {
    const payload = matchingImport.payload as Record<string, unknown>;
    const fullName =
      typeof payload.full_name === "string" ? payload.full_name : null;
    const htmlUrl =
      typeof payload.html_url === "string" ? payload.html_url : null;
    const isFork = Boolean(payload.fork);
    if (fullName) {
      return {
        isGithubLinked: true,
        fullName,
        htmlUrl: htmlUrl ?? `https://github.com/${fullName}`,
        isFork,
        importedAt: matchingImport.occurredAt,
      };
    }
  }

  // 2. Check project.links JSON array for a github.com repo link
  const links = Array.isArray(project.links)
    ? (project.links as Array<{ label?: string; url?: string }>)
    : [];

  for (const link of links) {
    if (typeof link?.url === "string") {
      const parsed = parseGithubRepoFromUrl(link.url);
      if (parsed) {
        return {
          isGithubLinked: true,
          fullName: parsed.fullName,
          htmlUrl: parsed.htmlUrl,
          isFork: false,
          importedAt: null,
        };
      }
    }
  }

  return {
    isGithubLinked: false,
    fullName: null,
    htmlUrl: null,
    isFork: false,
    importedAt: null,
  };
}

async function resolveSinceAnchor(
  userId: string,
  project: Project,
  importedAt: Date | null
): Promise<{
  sinceAnchor: Date;
  anchorSource: "post_drafted" | "repo_imported" | "project_created";
}> {
  const draftEvents = await db.eventLog.findMany({
    where: {
      userId,
      type: "post_drafted",
    },
    orderBy: { occurredAt: "desc" },
  });

  const latestDraftForProject = draftEvents.find((ev) => {
    if (
      !ev.payload ||
      typeof ev.payload !== "object" ||
      Array.isArray(ev.payload)
    ) {
      return false;
    }
    const payload = ev.payload as Record<string, unknown>;
    return payload.project_id === project.id;
  });

  if (latestDraftForProject) {
    return {
      sinceAnchor: latestDraftForProject.occurredAt,
      anchorSource: "post_drafted",
    };
  }

  if (importedAt) {
    return {
      sinceAnchor: importedAt,
      anchorSource: "repo_imported",
    };
  }

  return {
    sinceAnchor: project.createdAt,
    anchorSource: "project_created",
  };
}

async function fetchUserAuthoredPushedCommits(input: {
  fullName: string;
  since: Date;
  userEmail: string | null;
  clerkUserId: string;
  adapters?: CommitPostAdapters;
}): Promise<GithubCommitSummary[]> {
  const githubFetch = input.adapters?.githubFetch ?? fetch;

  let token = input.adapters?.githubToken ?? null;
  if (!token) {
    const oauth = await getClerkGithubToken(input.clerkUserId);
    token = oauth.token;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let expectedLogin = input.adapters?.githubLogin?.trim().toLowerCase() ?? null;
  if (!expectedLogin && token) {
    try {
      const userRes = await githubFetch("https://api.github.com/user", {
        headers,
        cache: "no-store",
      });
      if (userRes.ok) {
        const uJson = (await userRes.json()) as { login?: string };
        if (typeof uJson.login === "string" && uJson.login.trim()) {
          expectedLogin = uJson.login.trim().toLowerCase();
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback expected login from repo owner part (owner/repo) if not explicitly resolved
  const repoOwner = input.fullName.split("/")[0]?.trim().toLowerCase() ?? null;
  const expectedEmail = input.userEmail?.trim().toLowerCase() ?? null;

  const params = new URLSearchParams({
    since: input.since.toISOString(),
    per_page: "100",
  });
  if (expectedLogin) {
    params.set("author", expectedLogin);
  }

  const url = `https://api.github.com/repos/${input.fullName}/commits?${params.toString()}`;
  const res = await githubFetch(url, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    return [];
  }

  const rawCommits = (await res.json()) as Array<{
    sha?: string;
    commit?: {
      message?: string;
      author?: {
        name?: string;
        email?: string;
        date?: string;
      };
    };
    author?: {
      login?: string;
    } | null;
  }>;

  if (!Array.isArray(rawCommits)) {
    return [];
  }

  const filtered: GithubCommitSummary[] = [];
  for (const item of rawCommits) {
    const sha = typeof item.sha === "string" ? item.sha : "";
    if (!sha) continue;

    const commitDateStr = item.commit?.author?.date ?? "";
    const commitDate = commitDateStr ? new Date(commitDateStr) : null;
    // Strictly after the since anchor (so the anchor moment itself doesn't double-count)
    if (commitDate && commitDate.getTime() <= input.since.getTime()) {
      continue;
    }

    const authorLogin =
      typeof item.author?.login === "string"
        ? item.author.login.trim().toLowerCase()
        : null;
    const authorEmail =
      typeof item.commit?.author?.email === "string"
        ? item.commit.author.email.trim().toLowerCase()
        : null;

    const matchesLogin =
      expectedLogin !== null
        ? authorLogin === expectedLogin
        : repoOwner !== null && authorLogin === repoOwner;
    const matchesEmail =
      expectedEmail !== null && authorEmail === expectedEmail;

    if (!matchesLogin && !matchesEmail) {
      continue;
    }

    filtered.push({
      sha,
      message: (item.commit?.message ?? "").trim(),
      authoredAt: commitDateStr || new Date().toISOString(),
      authorLogin,
      authorEmail,
    });
  }

  return filtered;
}

export async function getWeeklyPostDraftCount(
  userId: string,
  now: Date = new Date()
): Promise<{ used: number; maxPerWeek: number }> {
  const maxPerWeek = await getConfig<number>("posts.maxPerWeek", 2);
  const windowStart = new Date(now.getTime() - 7 * DAY_MS);
  const used = await db.eventLog.count({
    where: {
      userId,
      type: "post_drafted",
      occurredAt: { gte: windowStart },
    },
  });
  return { used, maxPerWeek };
}

export async function checkProjectPostEligibility(
  input: {
    userId: string;
    projectId: string;
    userFlaggedWork?: boolean;
  },
  adapters?: CommitPostAdapters
): Promise<ProjectPostEligibility> {
  const now = adapters?.now ?? new Date();
  const project = await db.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
  });
  if (!project) {
    throw new Error("Project not found");
  }

  const [minCommitsPerMilestone, weekly, ghLink, user] = await Promise.all([
    getConfig<number>("posts.minCommitsPerMilestone", 10),
    getWeeklyPostDraftCount(input.userId, now),
    resolveProjectGithubLink(input.userId, project),
    db.user.findUniqueOrThrow({ where: { id: input.userId } }),
  ]);

  if (!ghLink.isGithubLinked || !ghLink.fullName) {
    return {
      projectId: project.id,
      isGithubLinked: false,
      showSurface: false,
      repoFullName: null,
      repoHtmlUrl: null,
      isFork: false,
      sinceAnchor: null,
      anchorSource: null,
      authoredCommitCount: 0,
      minCommitsPerMilestone,
      eligible: false,
      commits: [],
      commitRange: null,
      weeklyDraftsUsed: weekly.used,
      maxDraftsPerWeek: weekly.maxPerWeek,
      weeklyCapReached: weekly.used >= weekly.maxPerWeek,
    };
  }

  const { sinceAnchor, anchorSource } = await resolveSinceAnchor(
    input.userId,
    project,
    ghLink.importedAt
  );

  // D22 guardrail: forks are excluded unless explicitly user-flagged work
  if (ghLink.isFork && !input.userFlaggedWork) {
    return {
      projectId: project.id,
      isGithubLinked: true,
      showSurface: true,
      repoFullName: ghLink.fullName,
      repoHtmlUrl: ghLink.htmlUrl,
      isFork: true,
      sinceAnchor,
      anchorSource,
      authoredCommitCount: 0,
      minCommitsPerMilestone,
      eligible: false,
      commits: [],
      commitRange: null,
      weeklyDraftsUsed: weekly.used,
      maxDraftsPerWeek: weekly.maxPerWeek,
      weeklyCapReached: weekly.used >= weekly.maxPerWeek,
    };
  }

  const commits = await fetchUserAuthoredPushedCommits({
    fullName: ghLink.fullName,
    since: sinceAnchor,
    userEmail: user.email,
    clerkUserId: user.clerkId,
    adapters,
  });

  const authoredCommitCount = commits.length;
  const commitRange =
    commits.length > 0
      ? `${commits[commits.length - 1].sha.slice(0, 7)}..${commits[0].sha.slice(0, 7)}`
      : null;

  const weeklyCapReached = weekly.used >= weekly.maxPerWeek;
  const eligible =
    authoredCommitCount >= minCommitsPerMilestone && !weeklyCapReached;

  return {
    projectId: project.id,
    isGithubLinked: true,
    showSurface: true,
    repoFullName: ghLink.fullName,
    repoHtmlUrl: ghLink.htmlUrl,
    isFork: ghLink.isFork,
    sinceAnchor,
    anchorSource,
    authoredCommitCount,
    minCommitsPerMilestone,
    eligible,
    commits,
    commitRange,
    weeklyDraftsUsed: weekly.used,
    maxDraftsPerWeek: weekly.maxPerWeek,
    weeklyCapReached,
  };
}

async function getCachedLinkedinPostAdvice(): Promise<string[]> {
  const cached = await db.gatewayCache.findFirst({
    where: { feature: "linkedin_review" },
    orderBy: { createdAt: "desc" },
  });
  if (!cached) return [];
  try {
    const cleaned = cached.content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { post?: unknown };
    if (Array.isArray(parsed.post)) {
      return parsed.post.map(String).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

function parseCandidateDrafts(
  rawContent: string,
  projectTitle: string,
  commitRange: string,
  commits: GithubCommitSummary[]
): string[] {
  try {
    const cleaned = rawContent
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { drafts?: unknown } | unknown[];
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { drafts?: unknown }).drafts)
        ? ((parsed as { drafts: unknown[] }).drafts ?? [])
        : [];
    const drafts = arr
      .map((item) =>
        typeof item === "string"
          ? item.trim()
          : typeof item === "object" &&
              item !== null &&
              typeof (item as { text?: unknown }).text === "string"
            ? String((item as { text: string }).text).trim()
            : ""
      )
      .filter((d) => d.length >= 20);
    if (drafts.length >= 2) {
      return drafts.slice(0, 3);
    }
  } catch {
    // fallback below
  }

  const topMessages = commits
    .slice(0, 3)
    .map((c) => c.message.split(/\r?\n/)[0])
    .join("; ");

  return [
    `Shipped ${commits.length} commits (${commitRange}) on ${projectTitle}: ${topMessages}. Built and tested end-to-end.`,
    `Milestone update on ${projectTitle} (${commitRange}): completed ${commits.length} focused changes covering ${topMessages}.`,
  ];
}

export async function draftProjectLinkedinPosts(
  input: {
    userId: string;
    projectId: string;
    userFlaggedWork?: boolean;
    forcePlatform?: boolean;
  },
  adapters?: CommitPostAdapters
): Promise<DraftProjectPostsResult> {
  const now = adapters?.now ?? new Date();
  const project = await db.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
  });
  if (!project) {
    throw new Error("Project not found");
  }

  const eligibility = await checkProjectPostEligibility(
    {
      userId: input.userId,
      projectId: input.projectId,
      userFlaggedWork: input.userFlaggedWork,
    },
    adapters
  );

  if (!eligibility.isGithubLinked || !eligibility.showSurface) {
    throw new Error(
      "Post drafting is only available for GitHub-linked projects"
    );
  }

  if (eligibility.isFork && !input.userFlaggedWork) {
    throw new Error(
      "D22 guardrail: forked repositories require explicit user-flagged work confirmation before drafting"
    );
  }

  if (eligibility.weeklyCapReached) {
    throw new Error(
      `Weekly post draft limit reached (${eligibility.maxDraftsPerWeek} drafts per rolling 7 days)`
    );
  }

  if (
    eligibility.authoredCommitCount < eligibility.minCommitsPerMilestone ||
    !eligibility.commitRange
  ) {
    throw new Error(
      `Project needs at least ${eligibility.minCommitsPerMilestone} user-authored pushed commits since the last draft (currently ${eligibility.authoredCommitCount})`
    );
  }

  const linkedinAdvice = await getCachedLinkedinPostAdvice();
  const commitBullets = eligibility.commits
    .slice(0, 15)
    .map((c) => `- ${c.sha.slice(0, 7)}: ${c.message.split(/\r?\n/)[0]}`)
    .join("\n");

  // D78f: post_draft is personal output -> BYO auto-win applies!
  const gw = await gatewayCall(
    {
      userId: input.userId,
      feature: "post_draft",
      forcePlatform: input.forcePlatform,
      skipEnergy: true,
      messages: [
        {
          role: "system",
          content:
            'You write grounded, technical LinkedIn post drafts from real git commit ranges. Return strict JSON: {"drafts": ["draft 1", "draft 2", "draft 3"]}. Never invent metrics.',
        },
        {
          role: "user",
          content: [
            `Project: ${project.title}`,
            `Description: ${project.description}`,
            `Commit range: ${eligibility.commitRange} (${eligibility.authoredCommitCount} commits)`,
            `Commits:\n${commitBullets}`,
            linkedinAdvice.length > 0
              ? `LinkedIn review "what to post" guidance:\n- ${linkedinAdvice.join("\n- ")}`
              : "",
            "Return 2 to 3 distinct candidate LinkedIn post drafts grounded in these commits.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    },
    adapters?.gatewayFetch
  );

  if (gw.status === "byo_failed") {
    throw new Error(`BYO key failed for ${gw.provider}: ${gw.message}`);
  }

  const drafts = parseCandidateDrafts(
    gw.content,
    project.title,
    eligibility.commitRange,
    eligibility.commits
  );

  // D74 / D78g: Append 0-point post_drafted anchor event immediately, resetting
  // the eligibility window even if the user chooses not to post.
  const event = await appendEvent({
    userId: input.userId,
    source: "web",
    type: "post_drafted",
    skills: project.skills,
    occurredAt: now,
    now,
    pointsOverride: 0,
    payload: {
      project_id: project.id,
      repo_full_name: eligibility.repoFullName,
      commit_range: eligibility.commitRange,
      commit_count: eligibility.authoredCommitCount,
    },
  });

  return {
    project,
    drafts,
    commitRange: eligibility.commitRange,
    commitCount: eligibility.authoredCommitCount,
    commits: eligibility.commits,
    linkedinWhatToPostUsed: linkedinAdvice,
    shareFlowGuide: LINKEDIN_SHARE_FLOW_GUIDE_COPY,
    event,
    via: gw.via,
  };
}
