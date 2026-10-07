import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import type { User } from "@prisma/client";
import { countEventsReferencingSkill } from "@/services/events";

// D24/D33b: promotion is manual at launch. Skills are never hard-deleted —
// reject retires, merge retires + leaves aliasOf so old event rows resolve.
export function listCandidates() {
  return db.skill.findMany({
    where: { status: "CANDIDATE" },
    orderBy: { createdAt: "asc" },
  });
}

export async function approveCandidate(
  admin: User,
  skillId: string,
  parentId?: string
) {
  assertAdmin(admin);
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill || skill.status !== "CANDIDATE")
    throw new Error("not a candidate skill");
  if (parentId) {
    const parent = await db.skill.findUnique({ where: { id: parentId } });
    if (!parent || parent.status !== "ACTIVE")
      throw new Error("unknown parent skill");
  }
  return db.skill.update({
    where: { id: skillId },
    data: { status: "ACTIVE", ...(parentId ? { parentId } : {}) },
  });
}

export async function mergeCandidate(
  admin: User,
  skillId: string,
  targetId: string
) {
  assertAdmin(admin);
  const [skill, target] = await Promise.all([
    db.skill.findUnique({ where: { id: skillId } }),
    db.skill.findUnique({ where: { id: targetId } }),
  ]);
  if (!skill || skill.status === "RETIRED")
    throw new Error("skill not mergeable");
  if (!target || target.status !== "ACTIVE")
    throw new Error("merge target must be an active skill");
  if (skill.id === target.id)
    throw new Error("cannot merge a skill into itself");

  const retired = await db.skill.update({
    where: { id: skillId },
    data: { status: "RETIRED", aliasOfId: targetId },
  });
  await db.skillAlias.upsert({
    where: { alias: skill.name },
    update: { skillId: targetId },
    create: { alias: skill.name, skillId: targetId },
  });
  return retired;
}

export async function rejectCandidate(admin: User, skillId: string) {
  assertAdmin(admin);
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill || skill.status !== "CANDIDATE")
    throw new Error("not a candidate skill");
  const references = await countEventsReferencingSkill(skillId);
  if (references > 0) {
    // D33b: immutable history — once evidenced, merge is the only path.
    throw new Error(
      `referenced by ${references} event(s) — merge instead of reject`
    );
  }
  return db.skill.update({
    where: { id: skillId },
    data: { status: "RETIRED" },
  });
}
