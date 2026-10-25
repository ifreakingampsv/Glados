import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  checkProjectPostEligibility,
  draftProjectLinkedinPosts,
  LINKEDIN_SHARE_FLOW_GUIDE_COPY,
} from "@/services/commit-post";
import { addCredential } from "@/services/credentials";
import { importSingleGithubRepo } from "@/services/github-import";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";

const TEST_PREFIX = "test-commit-post-";
const createdUserIds: string[] = [];

async function makeUser(suffix: string) {
  const id = `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createdUserIds.push(id);
  return db.user.create({
    data: {
      id,
      clerkId: `clerk_${id}`,
      email: `dev.${suffix}@example.test`,
      role: "USER",
    },
  });
}

function makeGithubCommitsStub(
  totalUserCommits: number,
  otherAuthorCommits = 3,
  baseDate = new Date("2026-11-01T10:00:00.000Z")
) {
  const fetchFn: typeof fetch = async (input) => {
    const urlStr = typeof input === "string" ? input : input.toString();
    if (urlStr.endsWith("/user")) {
      return new Response(JSON.stringify({ login: "dev-user" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const commits: Array<Record<string, unknown>> = [];
    for (let i = 0; i < totalUserCommits; i++) {
      const sha = `a${String(i + 1).padStart(6, "0")}abcdef1234567890`;
      const date = new Date(
        baseDate.getTime() + (totalUserCommits - i) * 60_000
      ).toISOString();
      commits.push({
        sha,
        commit: {
          message: `feat: implement module step ${i + 1}`,
          author: {
            name: "Dev User",
            email: "dev@example.test",
            date,
          },
        },
        author: {
          login: "dev-user",
        },
      });
    }

    for (let j = 0; j < otherAuthorCommits; j++) {
      const sha = `b${String(j + 1).padStart(6, "0")}9999991234567890`;
      const date = new Date(
        baseDate.getTime() + (j + 1) * 30_000
      ).toISOString();
      commits.push({
        sha,
        commit: {
          message: `chore: upstream commit ${j + 1}`,
          author: {
            name: "Upstream Maintainer",
            email: "other@upstream.org",
            date,
          },
        },
        author: {
          login: "upstream-maintainer",
        },
      });
    }

    return new Response(JSON.stringify(commits), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return fetchFn;
}

beforeAll(async () => {
  process.env.PLATFORM_GOOGLE_API_KEY = "test-platform-google-key";
  process.env.CREDENTIALS_KEK =
    process.env.CREDENTIALS_KEK ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  await seedCanonicalSkills();
  await seedConfig();
  await seedRoutes();
});

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({
      where: { id: { in: [...createdUserIds] } },
    });
    createdUserIds.length = 0;
  }
});

describe("commit->post service (Ticket 08)", () => {
  it("hides post surface on non-GitHub projects, filters out non-user commits, and enforces the 9 vs 10 commit threshold boundary", async () => {
    const user = await makeUser("threshold");

    // 1. Non-GitHub manual project -> showSurface = false, eligible = false
    const manualProject = await db.project.create({
      data: {
        userId: user.id,
        title: "Offline Architecture Paper",
        description: "Manual project with no GitHub repository link",
        links: [{ label: "Docs", url: "https://example.com/paper" }],
        skills: [],
      },
    });

    const manualCheck = await checkProjectPostEligibility({
      userId: user.id,
      projectId: manualProject.id,
    });
    expect(manualCheck.isGithubLinked).toBe(false);
    expect(manualCheck.showSurface).toBe(false);
    expect(manualCheck.eligible).toBe(false);

    // 2. Imported GitHub project
    const ghProject = await importSingleGithubRepo(user.id, {
      id: "repo-101",
      name: "glados-engine",
      fullName: "dev-user/glados-engine",
      description: "Distributed job prep calibration engine",
      htmlUrl: "https://github.com/dev-user/glados-engine",
      fork: false,
      pushedAt: "2026-02-01T00:00:00.000Z",
      language: "TypeScript",
    });

    const checkNow = new Date("2026-11-02T00:00:00.000Z");

    // 9 user-authored commits (+ 5 other-author commits that must be filtered out) -> locked (eligible = false)
    const check9 = await checkProjectPostEligibility(
      { userId: user.id, projectId: ghProject.id },
      {
        githubFetch: makeGithubCommitsStub(
          9,
          5,
          new Date("2026-11-01T10:00:00.000Z")
        ),
        githubToken: "gho_test_token",
        githubLogin: "dev-user",
        now: checkNow,
      }
    );
    expect(check9.isGithubLinked).toBe(true);
    expect(check9.showSurface).toBe(true);
    expect(check9.authoredCommitCount).toBe(9);
    expect(check9.minCommitsPerMilestone).toBe(10);
    expect(check9.eligible).toBe(false);

    // 10 user-authored commits (+ 5 other-author commits) -> unlocked (eligible = true)
    const check10 = await checkProjectPostEligibility(
      { userId: user.id, projectId: ghProject.id },
      {
        githubFetch: makeGithubCommitsStub(
          10,
          5,
          new Date("2026-11-01T10:00:00.000Z")
        ),
        githubToken: "gho_test_token",
        githubLogin: "dev-user",
        now: checkNow,
      }
    );
    expect(check10.authoredCommitCount).toBe(10);
    expect(check10.eligible).toBe(true);
    expect(check10.commitRange).toBe("a000010..a000001");
  });

  it("grounds post_draft in commit range + project description + cached LinkedIn review, honors BYO auto-win, and appends 0-point post_drafted event that resets the anchor", async () => {
    const user = await makeUser("draft-anchor");
    await addCredential(user.id, "google", "byo-personal-google-key");

    // Seed a cached linkedin_review entry with "what to post" advice
    const reviewCacheKey = `linkedin_review:test_${Date.now()}`;
    await db.gatewayCache.create({
      data: {
        cacheKey: reviewCacheKey,
        feature: "linkedin_review",
        content: JSON.stringify({
          headlineScore: 85,
          summaryFeedback: "Strong backend profile",
          add: [],
          post: [
            "Write a deep dive on deterministic state machines and event-sourced scoring",
          ],
          visibility: [],
        }),
      },
    });

    const ghProject = await importSingleGithubRepo(user.id, {
      id: "repo-202",
      name: "staircase-calibrator",
      fullName: "dev-user/staircase-calibrator",
      description: "Adaptive staircase quiz engine with signed-delta retakes",
      htmlUrl: "https://github.com/dev-user/staircase-calibrator",
      fork: false,
      pushedAt: "2026-02-01T00:00:00.000Z",
      language: "TypeScript",
    });

    let capturedPrompt = "";
    let capturedAuth = "";
    const stubGatewayFetch: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("authorization") ?? "";
      capturedPrompt = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  drafts: [
                    "Draft 1: Built a 6-question staircase quiz engine across 10 commits (a000010..a000001) with deterministic grading.",
                    "Draft 2: How we bounded signed-delta retakes in our event-sourced scoring pipeline over 10 commits.",
                    "Draft 3: Deep dive on deterministic state machines from our latest 10-commit milestone on staircase-calibrator.",
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 180, completion_tokens: 220 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const draftTime = new Date("2026-11-05T12:00:00.000Z");
    const githubStub = makeGithubCommitsStub(
      10,
      2,
      new Date("2026-11-01T10:00:00.000Z")
    );

    const draftRes = await draftProjectLinkedinPosts(
      {
        userId: user.id,
        projectId: ghProject.id,
      },
      {
        githubFetch: githubStub,
        gatewayFetch: stubGatewayFetch,
        githubToken: "gho_test_token",
        githubLogin: "dev-user",
        now: draftTime,
      }
    );

    // 1. Personal output feature (post_draft) uses BYO auto-win ([D78f])
    expect(draftRes.via).toBe("byo");
    expect(capturedAuth).toContain("byo-personal-google-key");

    // 2. Prompt was grounded in commit range + project description + cached LinkedIn review advice
    expect(capturedPrompt).toContain("a000010..a000001");
    expect(capturedPrompt).toContain(
      "Adaptive staircase quiz engine with signed-delta retakes"
    );
    expect(capturedPrompt).toContain(
      "Write a deep dive on deterministic state machines and event-sourced scoring"
    );

    // 3. Returns 2-3 candidate drafts + LinkedIn share flow guide copy
    expect(draftRes.drafts).toHaveLength(3);
    expect(draftRes.shareFlowGuide).toEqual(LINKEDIN_SHARE_FLOW_GUIDE_COPY);

    // 4. Appends 0-point post_drafted event with project_id + commit_range
    expect(draftRes.event.type).toBe("post_drafted");
    expect(draftRes.event.points).toBe(0);
    const payload = draftRes.event.payload as Record<string, unknown>;
    expect(payload.project_id).toBe(ghProject.id);
    expect(payload.commit_range).toBe("a000010..a000001");

    // 5. Immediately re-checking eligibility with the same commits (dated March 1, before the March 5 post_drafted anchor)
    // shows 0 commits since last draft -> anchor reset even though user hasn't posted anywhere!
    const afterDraftCheck = await checkProjectPostEligibility(
      { userId: user.id, projectId: ghProject.id },
      {
        githubFetch: githubStub,
        githubToken: "gho_test_token",
        githubLogin: "dev-user",
        now: new Date("2026-11-05T12:05:00.000Z"),
      }
    );
    expect(afterDraftCheck.anchorSource).toBe("post_drafted");
    expect(afterDraftCheck.authoredCommitCount).toBe(0);
    expect(afterDraftCheck.eligible).toBe(false);

    await db.gatewayCache.deleteMany({ where: { cacheKey: reviewCacheKey } });
  });

  it("enforces D22 guardrails: blocks unflagged fork repos and enforces the rolling 7-day cap of 2 drafts per week", async () => {
    const user = await makeUser("d22-guardrails");

    const forkProject = await importSingleGithubRepo(user.id, {
      id: "repo-fork",
      name: "forked-lib",
      fullName: "dev-user/forked-lib",
      description: "Fork of an upstream library",
      htmlUrl: "https://github.com/dev-user/forked-lib",
      fork: true,
      pushedAt: "2026-02-01T00:00:00.000Z",
      language: "TypeScript",
    });

    const stubGatewayFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  drafts: [
                    "Draft A: Shipped 10 commits on my flagged feature branch.",
                    "Draft B: Technical summary of the 10-commit milestone.",
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    // 1. Unflagged fork is rejected by D22 guardrail
    await expect(
      draftProjectLinkedinPosts(
        {
          userId: user.id,
          projectId: forkProject.id,
          userFlaggedWork: false,
        },
        {
          githubFetch: makeGithubCommitsStub(
            12,
            0,
            new Date("2026-11-02T00:00:00.000Z")
          ),
          gatewayFetch: stubGatewayFetch,
          githubToken: "gho_test_token",
          githubLogin: "dev-user",
          now: new Date("2026-11-03T00:00:00.000Z"),
        }
      )
    ).rejects.toThrow(/D22 guardrail/i);

    // 2. When user explicitly flags work on the fork (or public repo), draft 1 succeeds
    const d1 = await draftProjectLinkedinPosts(
      {
        userId: user.id,
        projectId: forkProject.id,
        userFlaggedWork: true,
      },
      {
        githubFetch: makeGithubCommitsStub(
          10,
          0,
          new Date("2026-11-02T00:00:00.000Z")
        ),
        gatewayFetch: stubGatewayFetch,
        githubToken: "gho_test_token",
        githubLogin: "dev-user",
        now: new Date("2026-11-03T00:00:00.000Z"),
      }
    );
    expect(d1.drafts.length).toBeGreaterThanOrEqual(2);

    // Draft 2 (2 days later, with 10 fresh commits after March 3) succeeds
    const d2 = await draftProjectLinkedinPosts(
      {
        userId: user.id,
        projectId: forkProject.id,
        userFlaggedWork: true,
      },
      {
        githubFetch: makeGithubCommitsStub(
          10,
          0,
          new Date("2026-11-04T00:00:00.000Z")
        ),
        gatewayFetch: stubGatewayFetch,
        githubToken: "gho_test_token",
        githubLogin: "dev-user",
        now: new Date("2026-11-05T00:00:00.000Z"),
      }
    );
    expect(d2.drafts.length).toBeGreaterThanOrEqual(2);

    // Draft 3 within the same rolling 7-day window (March 6) is blocked by posts.maxPerWeek = 2
    await expect(
      draftProjectLinkedinPosts(
        {
          userId: user.id,
          projectId: forkProject.id,
          userFlaggedWork: true,
        },
        {
          githubFetch: makeGithubCommitsStub(
            10,
            0,
            new Date("2026-03-05T12:00:00.000Z")
          ),
          gatewayFetch: stubGatewayFetch,
          githubToken: "gho_test_token",
          githubLogin: "dev-user",
          now: new Date("2026-03-06T00:00:00.000Z"),
        }
      )
    ).rejects.toThrow(/Weekly post draft limit reached/i);
  });
});
