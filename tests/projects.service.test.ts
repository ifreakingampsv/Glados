import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/services/projects";

let owner: User;
let intruder: User;
const marker = `t05_${Date.now()}`;

beforeAll(async () => {
  [owner, intruder] = await Promise.all([
    db.user.create({ data: { clerkId: `${marker}_owner` } }),
    db.user.create({ data: { clerkId: `${marker}_intruder` } }),
  ]);
});

afterAll(async () => {
  await db.project.deleteMany({ where: { userId: owner.id } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("projects (T05: first-class entities + tenant isolation)", () => {
  it("creates and lists projects newest-first", async () => {
    await createProject(owner.id, { title: "Spine", description: "The hub." });
    const projects = await listProjects(owner.id);
    expect(projects).toHaveLength(1);
    expect(projects[0].title).toBe("Spine");
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
});
