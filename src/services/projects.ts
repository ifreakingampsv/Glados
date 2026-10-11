import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { normalizeTag, resolveTag } from "@/services/skills";
import { resolveSkillId } from "@/lib/skill-resolution";
import type { Source } from "@/lib/auth";

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectInput {
  title: string;
  description: string;
  links?: ProjectLink[];
  skills?: string[];
}

async function resolveCanonicalSkillIds(skillIds: string[]): Promise<string[]> {
  const unique = new Set<string>();
  for (const rawId of skillIds) {
    if (!rawId) continue;
    try {
      const canonicalId = await resolveSkillId(rawId);
      const row = await db.skill.findUnique({ where: { id: canonicalId } });
      if (row && row.status !== "RETIRED") {
        unique.add(canonicalId);
      }
    } catch {
      // ignore unknown skill id
    }
  }
  return Array.from(unique);
}

export async function createProject(
  userId: string,
  input: ProjectInput,
  source: Source = "web"
) {
  if (!input.title.trim()) throw new Error("title required");
  if (!input.description.trim()) throw new Error("description required");
  const skills = input.skills
    ? await resolveCanonicalSkillIds(input.skills)
    : [];
  const project = await db.project.create({
    data: {
      userId,
      title: input.title.trim(),
      description: input.description.trim(),
      links: (input.links ?? []) as unknown as Prisma.InputJsonValue,
      skills,
    },
  });
  // History lives in the log (D25); the recruiter view JOINs projects × events.
  await appendEvent({
    userId,
    source,
    type: "project_added",
    skills,
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
  const resolvedSkills =
    patch.skills !== undefined
      ? await resolveCanonicalSkillIds(patch.skills)
      : undefined;
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
      ...(resolvedSkills !== undefined ? { skills: resolvedSkills } : {}),
    },
  });
}

export async function deleteProject(userId: string, projectId: string) {
  await getProject(userId, projectId);
  await db.project.delete({ where: { id: projectId } });
}

export interface ProjectSkillTagOptions {
  confirmedSkillId?: string;
  createCandidate?: boolean;
}

export async function addProjectSkill(
  userId: string,
  projectId: string,
  input: string,
  options: ProjectSkillTagOptions = {}
) {
  const project = await getProject(userId, projectId);
  let targetSkillId: string;

  if (options.confirmedSkillId) {
    targetSkillId = options.confirmedSkillId;
  } else if (options.createCandidate) {
    const tag = normalizeTag(input);
    if (!tag) throw new Error("empty tag");
    const existing = await db.skill.findFirst({ where: { name: tag } });
    if (existing) {
      if (existing.status === "RETIRED") throw new Error("skill name retired");
      targetSkillId = existing.id;
    } else {
      const created = await db.skill.create({
        data: { name: tag, display: input.trim(), status: "CANDIDATE" },
      });
      targetSkillId = created.id;
    }
  } else {
    const resolution = await resolveTag(input);
    if (resolution.status === "confirm") {
      throw new Error("confirmation required: ambiguous tag");
    }
    targetSkillId = resolution.skillId;
  }

  const canonicalId = await resolveSkillId(targetSkillId);
  const skill = await db.skill.findUnique({ where: { id: canonicalId } });
  if (!skill || skill.status === "RETIRED") {
    throw new Error("skill not taggable");
  }

  const existingSkills = await resolveCanonicalSkillIds(project.skills ?? []);
  if (existingSkills.includes(canonicalId)) {
    if (
      existingSkills.length === project.skills.length &&
      existingSkills.every((id, idx) => id === project.skills[idx])
    ) {
      return project;
    }
  }
  const nextSkills = Array.from(new Set([...existingSkills, canonicalId]));
  return db.project.update({
    where: { id: project.id },
    data: { skills: nextSkills },
  });
}

export async function removeProjectSkill(
  userId: string,
  projectId: string,
  skillIdToRemove: string
) {
  const project = await getProject(userId, projectId);
  let targetCanonical = skillIdToRemove;
  try {
    targetCanonical = await resolveSkillId(skillIdToRemove);
  } catch {
    // keep raw id if unknown
  }

  const nextSkills: string[] = [];
  for (const id of project.skills) {
    if (id === skillIdToRemove || id === targetCanonical) continue;
    try {
      const resolved = await resolveSkillId(id);
      if (resolved === targetCanonical) continue;
      if (!nextSkills.includes(resolved)) nextSkills.push(resolved);
    } catch {
      if (!nextSkills.includes(id)) nextSkills.push(id);
    }
  }

  return db.project.update({
    where: { id: project.id },
    data: { skills: nextSkills },
  });
}

// D66: Idempotent one-time backfill populating project.skills from
// project_added evidence events (resolving merged skill aliases via D33b).
export async function backfillProjectSkills(): Promise<{
  updatedProjects: number;
}> {
  const events = await db.eventLog.findMany({
    where: { type: "project_added" },
    orderBy: { occurredAt: "asc" },
  });

  const skillsByProject = new Map<string, Set<string>>();
  for (const ev of events) {
    const payload = ev.payload as { project_id?: string } | null;
    const projectId = payload?.project_id;
    if (!projectId || !ev.skills || ev.skills.length === 0) continue;
    let set = skillsByProject.get(projectId);
    if (!set) {
      set = new Set<string>();
      skillsByProject.set(projectId, set);
    }
    for (const rawSkillId of ev.skills) {
      try {
        const canonicalId = await resolveSkillId(rawSkillId);
        const skill = await db.skill.findUnique({ where: { id: canonicalId } });
        if (skill && skill.status !== "RETIRED") {
          set.add(canonicalId);
        }
      } catch {
        // skip unknown
      }
    }
  }

  let updatedProjects = 0;
  for (const [projectId, eventSkillSet] of skillsByProject.entries()) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) continue;
    const currentResolved = await resolveCanonicalSkillIds(
      project.skills ?? []
    );
    const merged = Array.from(new Set([...currentResolved, ...eventSkillSet]));

    const unchanged =
      merged.length === project.skills.length &&
      merged.every((id) => project.skills.includes(id));
    if (!unchanged) {
      await db.project.update({
        where: { id: project.id },
        data: { skills: merged },
      });
      updatedProjects += 1;
    }
  }

  return { updatedProjects };
}
