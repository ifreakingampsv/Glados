import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import type { User } from "@prisma/client";
import { countEventsReferencingSkill } from "@/services/events";
import { gatewayCall, hashContentForCache } from "@/services/gateway";

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

// D70: Skills gain a definition field — generated ONCE per skill through the
// gateway and cached (D4), reused by gap-map explainers and S1.5 quiz banks.
export async function ensureSkillDefinition(
  skillId: string,
  userId: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill) throw new Error("skill not found");
  if (skill.definition && skill.definition.trim().length > 0) {
    return skill.definition;
  }

  const cacheKey = hashContentForCache("skill_def", skill.name);
  const res = await gatewayCall(
    {
      userId,
      feature: "skill_definition",
      cacheKey,
      skipEnergy: true,
      messages: [
        {
          role: "system",
          content:
            "Provide a clear, plain-language 1-2 sentence technical definition of the requested skill for software engineering job preparation.",
        },
        {
          role: "user",
          content: `Define the skill: ${skill.display} (${skill.name})`,
        },
      ],
    },
    fetchImpl
  );

  if (res.status !== "ok") {
    throw new Error(`skill definition generation failed: ${res.message}`);
  }
  const definition = res.content.trim();
  await db.skill.update({
    where: { id: skill.id },
    data: { definition },
  });
  return definition;
}

export async function generateMissingSkillDefinitions(
  admin: User,
  fetchImpl: typeof fetch = fetch,
  limit = 50
): Promise<{
  generated: number;
  withDefinition: number;
  totalActive: number;
}> {
  assertAdmin(admin);
  const activeSkills = await db.skill.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  const missing = activeSkills.filter(
    (s) => !s.definition || s.definition.trim().length === 0
  );

  let generated = 0;
  for (const skill of missing.slice(0, limit)) {
    await ensureSkillDefinition(skill.id, admin.id, fetchImpl);
    generated += 1;
  }

  const withDefinition = await db.skill.count({
    where: { status: "ACTIVE", definition: { not: null } },
  });

  return {
    generated,
    withDefinition,
    totalActive: activeSkills.length,
  };
}
