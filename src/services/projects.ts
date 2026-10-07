import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendEvent } from "@/services/events";
import type { Source } from "@/lib/auth";

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectInput {
  title: string;
  description: string;
  links?: ProjectLink[];
}

export async function createProject(
  userId: string,
  input: ProjectInput,
  source: Source = "web"
) {
  if (!input.title.trim()) throw new Error("title required");
  if (!input.description.trim()) throw new Error("description required");
  const project = await db.project.create({
    data: {
      userId,
      title: input.title.trim(),
      description: input.description.trim(),
      links: (input.links ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
  // History lives in the log (D25); the recruiter view JOINs projects × events.
  await appendEvent({
    userId,
    source,
    type: "project_added",
    payload: { project_id: project.id },
  });
  return project;
}

export function listProjects(userId: string) {
  return db.project.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProject(userId: string, projectId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw new Error("project not found");
  return project;
}

export async function updateProject(
  userId: string,
  projectId: string,
  patch: Partial<ProjectInput>
) {
  await getProject(userId, projectId); // tenant scope enforced here
  return db.project.update({
    where: { id: projectId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description.trim() }
        : {}),
      ...(patch.links !== undefined
        ? { links: patch.links as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
}

export async function deleteProject(userId: string, projectId: string) {
  await getProject(userId, projectId);
  await db.project.delete({ where: { id: projectId } });
}
