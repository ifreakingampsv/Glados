import { db } from "@/lib/db";

// D33b: merged skills keep aliasOf pointers so old event rows resolve
// read-time to the canonical skill. Cycle-free home (skills/events/levels all
// import this).
export async function resolveSkillId(skillId: string): Promise<string> {
  let current = await db.skill.findUnique({ where: { id: skillId } });
  const seen = new Set<string>();
  while (current?.aliasOfId && !seen.has(current.id)) {
    seen.add(current.id);
    current = await db.skill.findUnique({ where: { id: current.aliasOfId } });
  }
  if (!current) throw new Error(`unknown skill id: ${skillId}`);
  return current.id;
}
