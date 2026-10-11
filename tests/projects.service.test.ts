import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  addProjectSkill,
  backfillProjectSkills,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  removeProjectSkill,
  updateProject,
} from "@/services/projects";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { appendEvent } from "@/services/events";
import { mergeCandidate } from "@/services/skill-admin";

let owner: User;
let intruder: User;
let admin: User;
const marker = `t05_${Date.now()}`;

beforeAll(async () => {
  await seedConfig();
  await seedCanonicalSkills();
  [owner, intruder, admin] = await Promise.all([
    db.user.create({ data: { clerkId: `${marker}_owner` } }),
    db.user.create({ data: { clerkId: `${marker}_intruder` } }),
    db.user.create({ data: { clerkId: `${marker}_admin`, role: "ADMIN" } }),
  ]);
});

afterAll(async () => {
  await db.eventLog.deleteMany({
    where: { userId: { in: [owner.id, intruder.id] } },
  });
  await db.userSkill.deleteMany({
    where: { userId: { in: [owner.id, intruder.id] } },
  });
  await db.project.deleteMany({
    where: { userId: { in: [owner.id, intruder.id] } },
  });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("projects (T05 + S1 T04: first-class entities, skills array, backfill, tenant isolation)", () => {
  it("creates and lists projects newest-first", async () => {
    await createProject(owner.id, { title: "Spine", description: "The hub." });
    const projects = await listProjects(owner.id);
    expect(projects).toHaveLength(1);
    expect(projects[0].title).toBe("Spine");
    expect(projects[0].skills).toEqual([]);
  });

  it("edits and deletes only through the owner's scope", async () => {
    const project = await createProject(owner.id, {
      title: "Repo",
      description: "An OSS rebuild.",
      links: [{ label: "GitHub", url: "https://github.com/x/y" }],
    });

    await updateProject(owner.id, project.id, { title: "Rebuild" });
    const updated = await getProject(owner.id, project.id);
    expect(updated.title).toBe("Rebuild");

    await expect(getProject(intruder.id, project.id)).rejects.toThrow(
      "project not found"
    );
    await expect(
      updateProject(intruder.id, project.id, { title: "hacked" })
    ).rejects.toThrow("project not found");
    await expect(deleteProject(intruder.id, project.id)).rejects.toThrow(
      "project not found"
    );

    await deleteProject(owner.id, project.id);
    await expect(getProject(owner.id, project.id)).rejects.toThrow(
      "project not found"
    );
  });

  it("idempotently backfills project.skills from project_added events, resolving merged skills", async () => {
    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });
    const react = await db.skill.findUniqueOrThrow({
      where: { name: "react" },
    });
    const candidate = await db.skill.create({
      data: {
        name: `reactjs_${Date.now()}`,
        display: "ReactJSTmp",
        status: "CANDIDATE",
      },
    });

    const project = await createProject(owner.id, {
      title: "Legacy Project",
      description: "Created before projects carried skills column",
    });

    // Simulate historical project_added event referencing canonical ts + a candidate that later got merged into react
    await appendEvent({
      userId: owner.id,
      type: "project_added",
      source: "web",
      skills: [ts.id, candidate.id],
      payload: { project_id: project.id },
    });

    await mergeCandidate(admin, candidate.id, react.id);

    const firstRun = await backfillProjectSkills();
    expect(firstRun.updatedProjects).toBeGreaterThanOrEqual(1);

    const afterFirst = await getProject(owner.id, project.id);
    expect(afterFirst.skills).toEqual(
      expect.arrayContaining([ts.id, react.id])
    );
    expect(afterFirst.skills).not.toContain(candidate.id);
    expect(afterFirst.skills).toHaveLength(2);

    // Second run is idempotent: no duplicate skills, 0 projects changed
    const secondRun = await backfillProjectSkills();
    expect(secondRun.updatedProjects).toBe(0);
    const afterSecond = await getProject(owner.id, project.id);
    expect(afterSecond.skills).toHaveLength(2);
  });

  it("adds and removes skills on a project via the resolution ladder and enforces tenant scoping", async () => {
    const project = await createProject(owner.id, {
      title: "Skill Carrier",
      description: "Carries canonical and confirmed skills",
    });

    // Exact / alias resolution
    const withTs = await addProjectSkill(owner.id, project.id, "TypeScript");
    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });
    expect(withTs.skills).toEqual([ts.id]);

    // Adding the same skill again is a no-op (deduplicated)
    const dedup = await addProjectSkill(owner.id, project.id, "ts");
    expect(dedup.skills).toEqual([ts.id]);

    // Ambiguous short tag ("js" vs "ts" / "c" / "go") requires confirmation unless confirmedSkillId is provided
    await expect(addProjectSkill(owner.id, project.id, "rx")).rejects.toThrow(
      /confirmation required/
    );

    const go = await db.skill.findUniqueOrThrow({ where: { name: "go" } });
    const withConfirmed = await addProjectSkill(owner.id, project.id, "rx", {
      confirmedSkillId: go.id,
    });
    expect(withConfirmed.skills).toEqual([ts.id, go.id]);

    // Tenant isolation on skill edits
    await expect(
      addProjectSkill(intruder.id, project.id, "python")
    ).rejects.toThrow("project not found");
    await expect(
      removeProjectSkill(intruder.id, project.id, ts.id)
    ).rejects.toThrow("project not found");

    // Owner removes skill
    const afterRemove = await removeProjectSkill(owner.id, project.id, ts.id);
    expect(afterRemove.skills).toEqual([go.id]);
  });
});
