import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import {
  FORK_EXPLAINER_TEXT,
  GITHUB_IMPORT_QUEUE,
  enqueueGithubImportBatch,
  extractSkillsFromRepoFixture,
  prepareRepoSelectionList,
  syncGithubReposNow,
  type GithubRepoFixture,
} from "@/services/github-import";
import { processQueueOnce } from "@/services/worker";
import { listProjects } from "@/services/projects";

describe("GitHub connect + import service (T06: preselection, deterministic extraction, queue upsert, fork 0-weight, cap, sync)", () => {
  let owner: User;
  let otherUser: User;
  const marker = `t06_gh_${Date.now()}`;

  const sampleRepos: GithubRepoFixture[] = [
    {
      id: "repo-active-1",
      name: "glados-web",
      fullName: "ada/glados-web",
      description: "Full-stack Next.js and TypeScript workspace",
      htmlUrl: "https://github.com/ada/glados-web",
      fork: false,
      pushedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      language: "TypeScript",
      topics: ["nextjs", "postgresql"],
      hasUserCommits: true,
      hasReadme: true,
      dependencyFiles: {
        "package.json": JSON.stringify({
          dependencies: {
            react: "^19.0.0",
            next: "^15.0.0",
            tailwindcss: "^3.4.0",
          },
        }),
      },
    },
    {
      id: "repo-active-2",
      name: "older-rust-cli",
      fullName: "ada/older-rust-cli",
      description: "Fast CLI tool in Rust",
      htmlUrl: "https://github.com/ada/older-rust-cli",
      fork: false,
      pushedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      language: "Rust",
      topics: ["cli"],
      hasUserCommits: true,
      hasReadme: true,
      dependencyFiles: {
        "Cargo.toml":
          '[package]\nname = "older-rust-cli"\n[dependencies]\ntokio = "1.0"',
      },
    },
    {
      id: "repo-fork-1",
      name: "linux-fork",
      fullName: "ada/linux-fork",
      description: "Fork of kernel",
      htmlUrl: "https://github.com/ada/linux-fork",
      fork: true,
      pushedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      language: "C",
      topics: [],
      hasUserCommits: true,
      hasReadme: true,
    },
    {
      id: "repo-empty-no-signal",
      name: "empty-sandbox",
      fullName: "ada/empty-sandbox",
      description: "",
      htmlUrl: "https://github.com/ada/empty-sandbox",
      fork: false,
      pushedAt: new Date(Date.now() - 500 * 86_400_000).toISOString(),
      language: null,
      topics: [],
      hasUserCommits: false,
      hasReadme: false,
    },
  ];

  beforeAll(async () => {
    await seedConfig();
    await seedCanonicalSkills();
    [owner, otherUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_owner` } }),
      db.user.create({ data: { clerkId: `${marker}_other` } }),
    ]);
  });

  afterAll(async () => {
    await db.eventLog.deleteMany({
      where: { userId: { in: [owner.id, otherUser.id] } },
    });
    await db.userSkill.deleteMany({
      where: { userId: { in: [owner.id, otherUser.id] } },
    });
    await db.project.deleteMany({
      where: { userId: { in: [owner.id, otherUser.id] } },
    });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("applies smart preselection rules: active non-forks with signal start checked sorted by activity; forks start unchecked with explainer", () => {
    const { items, forkExplainer } = prepareRepoSelectionList(sampleRepos);
    expect(forkExplainer).toContain(
      "only include repos you can talk about in depth, not minor-change forks"
    );
    expect(FORK_EXPLAINER_TEXT.toLowerCase()).toContain(
      "only include repos you can talk about in depth"
    );

    const byId = new Map(items.map((i) => [i.repo.id, i]));
    expect(byId.get("repo-active-1")?.preselected).toBe(true);
    expect(byId.get("repo-active-2")?.preselected).toBe(true);
    expect(byId.get("repo-fork-1")?.preselected).toBe(false);
    expect(byId.get("repo-empty-no-signal")?.preselected).toBe(false);

    // Preselected items appear first sorted by pushedAt desc
    expect(items[0].repo.id).toBe("repo-active-1");
    expect(items[1].repo.id).toBe("repo-active-2");
  });

  it("extracts skills deterministically from metadata and dependency files through the resolution ladder without LLM calls", async () => {
    const skills = await extractSkillsFromRepoFixture(sampleRepos[0]);
    const rows = await db.skill.findMany({ where: { id: { in: skills } } });
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "typescript",
        "nextjs",
        "postgresql",
        "react",
        "tailwindcss",
      ])
    );
  });

  it("enforces the config import cap per batch and supports 'import more' for additional batches", async () => {
    const manyRepos: GithubRepoFixture[] = Array.from(
      { length: 30 },
      (_, idx) => ({
        id: `bulk-${idx}`,
        name: `repo-${idx}`,
        fullName: `ada/repo-${idx}`,
        description: "Service repo",
        htmlUrl: `https://github.com/ada/repo-${idx}`,
        fork: false,
        pushedAt: new Date().toISOString(),
        language: "TypeScript",
        hasUserCommits: true,
        hasReadme: true,
      })
    );

    // Without importMore pagination, selecting > cap (25) throws
    await expect(
      enqueueGithubImportBatch(owner.id, manyRepos, { DryRunCapOnly: true })
    ).rejects.toThrow(/import cap/i);

    // Slicing to cap (25) + "import more" second batch of 5 both pass cap validation
    const firstBatch = manyRepos.slice(0, 25);
    const secondBatch = manyRepos.slice(25, 30);
    await expect(
      enqueueGithubImportBatch(owner.id, firstBatch, { DryRunCapOnly: true })
    ).resolves.toMatchObject({ acceptedCount: 25 });
    await expect(
      enqueueGithubImportBatch(owner.id, secondBatch, { DryRunCapOnly: true })
    ).resolves.toMatchObject({ acceptedCount: 5 });
  });

  it("imports non-fork and explicitly selected fork repos via pg-boss queue, upserts projects, and gives forks zero-weight evidence", async () => {
    const selected = [sampleRepos[0], sampleRepos[2]]; // active TypeScript repo + C fork repo
    const enqueued = await enqueueGithubImportBatch(owner.id, selected);
    expect(enqueued.acceptedCount).toBe(2);

    const processed = await processQueueOnce(GITHUB_IMPORT_QUEUE, 10);
    expect(processed).toBe(2);

    // Tenant scoping: otherUser sees 0 projects
    expect(await listProjects(otherUser.id)).toHaveLength(0);

    // Owner has 2 projects created from the repos
    const projects = await listProjects(owner.id);
    expect(projects).toHaveLength(2);
    const webProj = projects.find((p) => p.title === "glados-web");
    expect(webProj).toBeDefined();
    expect(webProj!.skills.length).toBeGreaterThanOrEqual(4);

    // Check repo_imported events: non-fork got config points (5), fork got 0 points (D46)
    const events = await db.eventLog.findMany({
      where: { userId: owner.id, type: "repo_imported" },
    });
    expect(events).toHaveLength(2);
    const nonForkEvent = events.find(
      (e) => (e.payload as { fork?: boolean })?.fork === false
    );
    const forkEvent = events.find(
      (e) => (e.payload as { fork?: boolean })?.fork === true
    );
    expect(nonForkEvent?.points).toBe(5);
    expect(forkEvent?.points).toBe(0);

    // C skill from the fork must have score 0 (zero-weight evidence)
    const cSkill = await db.skill.findUniqueOrThrow({ where: { name: "c" } });
    const cUserSkill = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: owner.id, skillId: cSkill.id } },
    });
    expect(cUserSkill?.score ?? 0).toBe(0);

    // "Sync now" re-imports on demand and updates the existing project in place (no duplicate project rows)
    const updatedRepo: GithubRepoFixture = {
      ...sampleRepos[0],
      description: "Updated description after Sync now",
      topics: ["nextjs", "postgresql", "docker"],
    };
    await syncGithubReposNow(owner.id, [updatedRepo]);

    const afterSync = await listProjects(owner.id);
    expect(afterSync).toHaveLength(2);
    const syncedWeb = afterSync.find((p) => p.title === "glados-web");
    expect(syncedWeb?.description).toBe("Updated description after Sync now");
    const docker = await db.skill.findUniqueOrThrow({
      where: { name: "docker" },
    });
    expect(syncedWeb?.skills).toContain(docker.id);
  });
});
