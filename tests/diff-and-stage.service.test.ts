import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { createInMemoryS3Fetch, createR2Adapter } from "@/services/storage";
import type { ParsedResumeDocument } from "@/services/resume-parse";
import { writeBackParsedResumeToProfile } from "@/services/work-experience";
import { appendEvent } from "@/services/events";
import {
  applyStagedImport,
  declineStagedImport,
  getPendingStagedImports,
  stageReuploadDiff,
  type StagedDiffItem,
} from "@/services/diff-and-stage";

describe("Diff-and-stage re-upload service (T09: 4 diff outcomes, per-source staleness, evidence-wins, walk-away persistence, accept/decline, event-log recovery, tenant scoping)", () => {
  let owner: User;
  let otherUser: User;
  const marker = `t09_diff_${Date.now()}`;

  const initialResume: ParsedResumeDocument = {
    summary: "Initial summary v1",
    skills: [
      { name: "TypeScript", claimedLevel: 3 },
      { name: "React", claimedLevel: 3 },
      { name: "Docker", claimedLevel: 2 },
    ],
    blocks: [
      {
        kind: "summary",
        title: "Professional Summary",
        content: "Initial summary v1",
      },
    ],
    workExperiences: [
      {
        employer: "Acme Corp",
        title: "Backend Engineer",
        period: "2022-01 to 2024-01",
        durationMonths: 24,
        kind: "job",
        description: "Built TypeScript services v1.",
        skills: ["TypeScript"],
      },
    ],
    education: [],
  };

  const linkedinExport: ParsedResumeDocument = {
    summary: "LinkedIn headline summary",
    skills: [
      { name: "Docker", claimedLevel: 3 },
      { name: "Go", claimedLevel: 2 },
    ],
    blocks: [],
    workExperiences: [],
    education: [],
  };

  const reuploadedResume: ParsedResumeDocument = {
    summary: "Updated summary v2 with distributed systems",
    skills: [
      // TypeScript: same or lower claimedLevel than evidenced level (evidence-wins test)
      { name: "TypeScript", claimedLevel: 1 },
      // React: same (claimedLevel 3)
      { name: "React", claimedLevel: 3 },
      // PostgreSQL: new skill
      { name: "PostgreSQL", claimedLevel: 4 },
      // Docker is GONE from resume (but present in linkedinExport!)
    ],
    blocks: [
      {
        kind: "summary",
        title: "Professional Summary",
        content: "Updated summary v2 with distributed systems",
      },
    ],
    workExperiences: [
      {
        employer: "Acme Corp",
        title: "Backend Engineer",
        period: "2022-01 to 2024-06",
        durationMonths: 30,
        kind: "job",
        description: "Built TypeScript and PostgreSQL services v2.",
        skills: ["TypeScript", "PostgreSQL"],
      },
    ],
    education: [],
  };

  beforeAll(async () => {
    await seedConfig();
    await seedCanonicalSkills();
    [owner, otherUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_owner` } }),
      db.user.create({ data: { clerkId: `${marker}_other` } }),
    ]);

    // Seed initial resume + initial LinkedIn import
    await writeBackParsedResumeToProfile(owner.id, initialResume, "resume");
    await writeBackParsedResumeToProfile(owner.id, linkedinExport, "linkedin");

    // Boost TypeScript evidenced level to >= 2 via interview_passed events
    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });
    for (let i = 0; i < 3; i++) {
      await appendEvent({
        userId: owner.id,
        source: "web",
        type: "interview_passed",
        skills: [ts.id],
      });
    }
  });

  afterAll(async () => {
    const uids = [owner.id, otherUser.id];
    await db.resumeImportStaging.deleteMany({
      where: { userId: { in: uids } },
    });
    await db.eventLog.deleteMany({ where: { userId: { in: uids } } });
    await db.resumeBlock.deleteMany({ where: { userId: { in: uids } } });
    await db.workExperience.deleteMany({ where: { userId: { in: uids } } });
    await db.userSkill.deleteMany({ where: { userId: { in: uids } } });
    await db.profile.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("computes all four diff outcomes (same, updated, new, gone) against same-source content only, persists across sessions, and leaves rows untouched on decline", async () => {
    const staged = await stageReuploadDiff(
      owner.id,
      reuploadedResume,
      "resume"
    );
    expect(staged.status).toBe("pending");

    // Walk-away-and-return persistence: fetch pending staged imports from DB
    const pendingList = await getPendingStagedImports(owner.id);
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].id).toBe(staged.id);

    // Tenant scoping: otherUser sees 0 pending imports and cannot decline owner's staging
    expect(await getPendingStagedImports(otherUser.id)).toHaveLength(0);
    await expect(declineStagedImport(otherUser.id, staged.id)).rejects.toThrow(
      /not found/i
    );

    const items = staged.diffItems as unknown as StagedDiffItem[];
    const outcomes = new Set(items.map((i) => i.outcome));
    expect(outcomes.has("same")).toBe(true); // React claim
    expect(outcomes.has("updated")).toBe(true); // Summary block & Acme Corp exp
    expect(outcomes.has("new")).toBe(true); // PostgreSQL claim
    expect(outcomes.has("gone")).toBe(true); // Docker claim (absent from new resume)

    // Go was imported from LinkedIn only, so a resume diff must NOT mark Go as gone!
    const goGone = items.find(
      (i) => i.label.toLowerCase().includes("go") && i.outcome === "gone"
    );
    expect(goGone).toBeUndefined();

    // Decline leaves every row untouched
    await declineStagedImport(owner.id, staged.id);
    const pg = await db.skill.findUniqueOrThrow({
      where: { name: "postgresql" },
    });
    const pgClaim = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: owner.id, skillId: pg.id } },
    });
    expect(pgClaim).toBeNull();
  });

  it("applies accepted staged changes transactionally: evidence-wins never downgrades evidenced levels, per-source stale flag marks absent claims without deleting, old content is recoverable in event_log, and stored PDF updates", async () => {
    const s3 = createInMemoryS3Fetch();
    const storageAdapter = createR2Adapter(
      {
        endpoint: "https://t09-account.r2.cloudflarestorage.com",
        bucket: "glados-t09-bucket",
        accessKeyId: "AKIA_T09_TEST",
        secretAccessKey: "SECRET_T09_TEST_KEY",
      },
      s3.fetch
    );

    const tempStorageKey = `uploads/resume/${owner.id}/staged-v2.pdf`;
    await storageAdapter.put({
      key: tempStorageKey,
      body: Buffer.from("%PDF-1.4 updated resume v2"),
      contentType: "application/pdf",
    });

    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });
    const tsBefore = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: owner.id, skillId: ts.id } },
    });
    expect(tsBefore.level).toBeGreaterThanOrEqual(2);

    const staged = await stageReuploadDiff(
      owner.id,
      reuploadedResume,
      "resume",
      { storageKey: tempStorageKey }
    );

    // Tenant scoping on apply
    await expect(
      applyStagedImport(otherUser.id, staged.id, { storageAdapter })
    ).rejects.toThrow(/not found/i);

    const applied = await applyStagedImport(owner.id, staged.id, {
      storageAdapter,
    });
    expect(applied.status).toBe("applied");

    // 1. Evidence-wins: TypeScript evidenced level and score were NEVER downgraded by claimedLevel: 1
    const tsAfter = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: owner.id, skillId: ts.id } },
    });
    expect(tsAfter.level).toBeGreaterThanOrEqual(tsBefore.level);
    expect(tsAfter.score).toBeGreaterThanOrEqual(tsBefore.score);

    // 2. Per-source staleness: Docker was absent from new resume -> staleOrigins has 'resume',
    //    NOT deleted, and 'linkedin' origin is still active & fresh!
    const docker = await db.skill.findUniqueOrThrow({
      where: { name: "docker" },
    });
    const dockerSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: owner.id, skillId: docker.id } },
    });
    expect(dockerSkill.staleOrigins).toContain("resume");
    expect(dockerSkill.staleOrigins).not.toContain("linkedin");
    expect(dockerSkill.claimOrigins).toContain("linkedin");

    // 3. Old block content recoverable via event_log
    const auditEvents = await db.eventLog.findMany({
      where: { userId: owner.id, type: "resume_imported" },
      orderBy: { occurredAt: "desc" },
    });
    const latestPayload = JSON.stringify(auditEvents[0]?.payload ?? {});
    expect(latestPayload).toContain("Initial summary v1");

    // 4. Stored active PDF updated on accept
    const activePdf = await storageAdapter.get(
      `users/${owner.id}/active-resume.pdf`
    );
    expect(activePdf).not.toBeNull();
  });
});
