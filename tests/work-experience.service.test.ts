import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig, DEFAULT_WORK_EXP_SCORER } from "@/services/seed-config";
import type { ParsedResumeDocument } from "@/services/resume-parse";
import {
  computeWorkExperiencePoints,
  confirmWorkExperience,
  describeUserSkillProvenance,
  listWorkExperiences,
  promoteWorkExperienceToProject,
  setSelfAssessedSkillLevel,
  writeBackParsedResumeToProfile,
} from "@/services/work-experience";
import { listProjects } from "@/services/projects";

describe("Profile write-back + work experience as evidence (T08: atomic write-back, deterministic scorer, re-confirm, self-assessment, promote-to-project, provenance labels)", () => {
  let owner: User;
  let otherUser: User;
  const marker = `t08_wb_${Date.now()}`;

  const parsedDoc: ParsedResumeDocument = {
    summary: "Distributed systems and TypeScript engineer.",
    skills: [
      { name: "TypeScript", claimedLevel: 4 },
      { name: "PostgreSQL", claimedLevel: 3 },
      { name: "Kubernetes", claimedLevel: 2 },
    ],
    blocks: [
      {
        kind: "summary",
        title: "Summary",
        content: "Distributed systems and TypeScript engineer.",
      },
      {
        kind: "education",
        title: "University of Waterloo",
        content: "B.S. Computer Science",
      },
    ],
    workExperiences: [
      {
        employer: "Babbage Systems",
        title: "Staff Backend Engineer",
        period: "2022-01 to 2024-01",
        durationMonths: 24,
        kind: "job",
        description:
          "Designed high-throughput TypeScript and PostgreSQL event pipelines serving 40M requests per day with strict latency budgets and automated failover across multi-region clusters.",
        skills: ["TypeScript", "PostgreSQL"],
      },
      {
        employer: "Early Startup",
        title: "Software Intern",
        period: "2021-05 to 2021-08",
        durationMonths: 3,
        kind: "internship",
        description: "Built React UI components.",
        skills: ["React"],
      },
    ],
    education: [
      {
        institution: "University of Waterloo",
        degree: "B.S. Computer Science",
        period: "2017 to 2021",
      },
    ],
  };

  beforeAll(async () => {
    await seedConfig();
    await seedCanonicalSkills();
    [owner, otherUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_owner` } }),
      db.user.create({ data: { clerkId: `${marker}_other` } }),
    ]);
  });

  afterAll(async () => {
    const uids = [owner.id, otherUser.id];
    await db.eventLog.deleteMany({ where: { userId: { in: uids } } });
    await db.resumeBlock.deleteMany({ where: { userId: { in: uids } } });
    await db.workExperience.deleteMany({ where: { userId: { in: uids } } });
    await db.project.deleteMany({ where: { userId: { in: uids } } });
    await db.userSkill.deleteMany({ where: { userId: { in: uids } } });
    await db.profile.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("computes deterministic, re-parse-stable specificity points scaled by duration and named stack depth", () => {
    const deepJobPoints = computeWorkExperiencePoints(
      {
        kind: "job",
        durationMonths: 24,
        description:
          "Designed high-throughput TypeScript and PostgreSQL event pipelines serving 40M requests per day with strict latency budgets and automated failover across multi-region clusters.",
        resolvedSkillCount: 2,
      },
      DEFAULT_WORK_EXP_SCORER
    );

    const repeatPoints = computeWorkExperiencePoints(
      {
        kind: "job",
        durationMonths: 24,
        description:
          "Designed high-throughput TypeScript and PostgreSQL event pipelines serving 40M requests per day with strict latency budgets and automated failover across multi-region clusters.",
        resolvedSkillCount: 2,
      },
      DEFAULT_WORK_EXP_SCORER
    );

    const shallowInternPoints = computeWorkExperiencePoints(
      {
        kind: "internship",
        durationMonths: 3,
        description: "Built React UI components.",
        resolvedSkillCount: 1,
      },
      DEFAULT_WORK_EXP_SCORER
    );

    expect(deepJobPoints).toBe(repeatPoints);
    expect(deepJobPoints).toBeGreaterThan(shallowInternPoints);
    expect(shallowInternPoints).toBeGreaterThanOrEqual(1);
  });

  it("writes back claims, resume_blocks, and work_experiences in one transaction and appends resume_imported + work_experience_added events", async () => {
    const result = await writeBackParsedResumeToProfile(
      owner.id,
      parsedDoc,
      "resume"
    );

    expect(result.workExperiences).toHaveLength(2);
    expect(result.blocks.length).toBeGreaterThanOrEqual(4); // summary + education + 2 experience blocks

    // Check that experience blocks reference work_experience via sourceRef
    const expBlocks = result.blocks.filter(
      (b) => b.sourceRefType === "work_experience"
    );
    expect(expBlocks).toHaveLength(2);

    // Check events: 1 resume_imported (0 pts) + 2 work_experience_added (>0 pts)
    const events = await db.eventLog.findMany({
      where: { userId: owner.id },
      orderBy: { occurredAt: "asc" },
    });
    const importedEv = events.find((e) => e.type === "resume_imported");
    const workEvs = events.filter((e) => e.type === "work_experience_added");
    expect(importedEv).toBeDefined();
    expect(importedEv?.points).toBe(0);
    expect(workEvs).toHaveLength(2);
    expect(workEvs[0].points).toBeGreaterThan(0);

    // Kubernetes was claimed on the resume but NOT in any workExperience: it stays 0-evidence unvalidated claim
    const k8s = await db.skill.findUniqueOrThrow({
      where: { name: "kubernetes" },
    });
    const k8sUserSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: owner.id, skillId: k8s.id } },
    });
    expect(k8sUserSkill.score).toBe(0);
    expect(k8sUserSkill.claimedLevel).toBe(2);
    const k8sProv = describeUserSkillProvenance(k8sUserSkill);
    expect(k8sProv.tier).toBe("claimed");
    expect(k8sProv.isUnvalidated).toBe(true);
    expect(k8sProv.explainerHref).toBe("/how-levels-work");

    // TypeScript was in the 24-month job: it earned evidence score > 0
    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });
    const tsUserSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: owner.id, skillId: ts.id } },
    });
    expect(tsUserSkill.score).toBeGreaterThan(0);
    expect(describeUserSkillProvenance(tsUserSkill).tier).toBe("evidenced");
  });

  it("supports self-assessed levels (never touching evidenced score), re-confirming work experience, and one-click promote to project with tenant scoping", async () => {
    // 1. Self-assessed level on a 0-evidence skill (Go)
    const goSkill = await setSelfAssessedSkillLevel(owner.id, "Go", 3);
    expect(goSkill.claimedLevel).toBe(3);
    expect(goSkill.score).toBe(0);
    expect(goSkill.level).toBe(0);
    const goProv = describeUserSkillProvenance(goSkill);
    expect(goProv.tier).toBe("self-assessed");
    expect(goProv.label).toContain("self-assessed");
    expect(goProv.explainerHref).toBe("/how-levels-work");

    // 2. Re-confirm work experience appends work_experience_confirmed
    const experiences = await listWorkExperiences(owner.id);
    const staffExp = experiences.find((e) => e.employer === "Babbage Systems")!;

    // Tenant scoping check: otherUser cannot confirm or promote owner's experience
    await expect(
      confirmWorkExperience(otherUser.id, staffExp.id)
    ).rejects.toThrow(/not found/i);
    await expect(
      promoteWorkExperienceToProject(otherUser.id, staffExp.id)
    ).rejects.toThrow(/not found/i);

    await confirmWorkExperience(owner.id, staffExp.id);
    const confirmEvents = await db.eventLog.findMany({
      where: { userId: owner.id, type: "work_experience_confirmed" },
    });
    expect(confirmEvents).toHaveLength(1);
    expect(confirmEvents[0].points).toBe(2);

    // 3. One-click promote work experience to project
    const promoted = await promoteWorkExperienceToProject(
      owner.id,
      staffExp.id
    );
    expect(promoted.title).toContain("Staff Backend Engineer");
    expect(promoted.skills.length).toBeGreaterThanOrEqual(2);

    const ownerProjects = await listProjects(owner.id);
    expect(ownerProjects.some((p) => p.id === promoted.id)).toBe(true);
  });
});
