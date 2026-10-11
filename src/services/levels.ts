import { db, type Config, type UserSkill } from "@/lib/db";
import { resolveSkillId } from "@/lib/skill-resolution";

// Bands + point tables are CONFIG ROWS (D28 philosophy), seeded by db:seed.
export const DEFAULT_BANDS = [
  { level: 0, min: 0 },
  { level: 1, min: 5 },
  { level: 2, min: 20 },
  { level: 3, min: 50 },
  { level: 4, min: 100 },
  { level: 5, min: 200 },
];

export const DEFAULT_POINTS: Record<string, number> = {
  skill_tagged: 0,
  project_added: 0,
  manual_evidence: 3,
  interview_passed: 10,
  quiz_completed: 2,
  system_adjustment: 0,
  repo_imported: 5,
  work_experience_added: 4,
  work_experience_confirmed: 2,
  resume_imported: 0,
};

export const DEFAULT_SOURCE_WEIGHTS: Record<string, number> = {
  web: 1,
  system: 1,
  agent_plugin: 0.5,
  extension: 0.5,
};

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row: Config | null = await db.config.findUnique({ where: { key } });
  return (row?.value as T) ?? fallback;
}

export function scoreForEvents(
  events: Array<{ points: number; occurredAt: Date }>,
  now: Date = new Date()
): number {
  return events.reduce((score, event) => {
    const ageDays = Math.max(
      0,
      (now.getTime() - event.occurredAt.getTime()) / 86_400_000
    );
    return score + event.points * Math.pow(0.5, ageDays / 90);
  }, 0);
}

export async function levelForScore(score: number): Promise<number> {
  const bands = await getConfig("levels.bands", DEFAULT_BANDS);
  let level = 0;
  for (const band of bands) {
    if (score >= band.min) level = band.level;
  }
  return level;
}

// THE single writer (D24): rebuilds one user_skills row purely from the log —
// replay-safe, decay included, merged skill ids resolved to canonical first.
export async function recomputeUserSkill(
  userId: string,
  skillId: string,
  now: Date = new Date()
): Promise<UserSkill> {
  const canonicalId = await resolveSkillId(skillId);

  // Event rows store the skill id AT WRITE TIME (D33b): rows referencing
  // retired ids that merge into this canonical skill still count, so collect
  // the transitive alias closure and match against all of them.
  const referencedIds = [canonicalId];
  let frontier = [canonicalId];
  while (frontier.length > 0) {
    const retired = await db.skill.findMany({
      where: { aliasOfId: { in: frontier } },
      select: { id: true },
    });
    frontier = retired
      .map((r) => r.id)
      .filter((id) => !referencedIds.includes(id));
    referencedIds.push(...frontier);
  }

  const events = await db.eventLog.findMany({
    where: { userId, skills: { hasSome: referencedIds } },
    select: { points: true, occurredAt: true },
  });
  const score = scoreForEvents(events, now);
  const level = await levelForScore(score);
  const lastEvidencedAt = events.reduce<Date | null>(
    (latest, event) =>
      !latest || event.occurredAt > latest ? event.occurredAt : latest,
    null
  );
  return db.userSkill.upsert({
    where: { userId_skillId: { userId, skillId: canonicalId } },
    update: { score, level, lastEvidencedAt },
    create: { userId, skillId: canonicalId, score, level, lastEvidencedAt },
  });
}

// T10: the nightly sweep — quiet users' levels decay even with no new events.
// Same single-writer path as appendEvent's recompute; the cron route is a
// thin wrapper around this.
export async function runDecaySweep(): Promise<number> {
  const rows = await db.userSkill.findMany({
    select: { userId: true, skillId: true },
  });
  for (const row of rows) {
    await recomputeUserSkill(row.userId, row.skillId);
  }
  return rows.length;
}
