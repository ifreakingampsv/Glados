import { Prisma } from "@prisma/client";
import { db, type EventLog } from "@/lib/db";
import type { Source } from "@/lib/auth";
import {
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
  getConfig,
  recomputeUserSkill,
} from "@/services/levels";

// Fixed vocabulary (D25 + S1). skill_tagged, project_added, and resume_imported
// carry zero points: they are history/audit, not evidence — idle clicks can't
// farm the earned bar (D36).
export const EVENT_TYPES = [
  "skill_tagged",
  "project_added",
  "manual_evidence",
  "interview_passed", // reserved for S2
  "quiz_completed", // reserved for S1.5 / S4
  "system_adjustment",
  "repo_imported",
  "work_experience_added",
  "work_experience_confirmed",
  "resume_imported", // audit only, 0 points
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const SOURCES: Source[] = ["web", "system", "agent_plugin", "extension"];

// D24: base_points(type, source) — values live in config rows (T09); the
// defaults here only fill in until the seed runs. agent_plugin/extension are
// claim-grade (0.5) until platform grading runs (D29).
export async function basePoints(
  type: EventType,
  source: Source
): Promise<number> {
  if (type === "resume_imported") return 0;
  const [types, weights] = await Promise.all([
    getConfig("points.types", DEFAULT_POINTS),
    getConfig("points.sourceWeights", DEFAULT_SOURCE_WEIGHTS),
  ]);
  const base = types[type] ?? DEFAULT_POINTS[type] ?? 0;
  return Math.round(base * (weights[source] ?? 0));
}

export interface AppendEventInput {
  userId: string;
  source: Source;
  type: EventType;
  skills?: string[];
  occurredAt?: Date;
  payload?: Record<string, unknown>;
  pointsOverride?: number;
}

export async function appendEvent(input: AppendEventInput): Promise<EventLog> {
  if (!EVENT_TYPES.includes(input.type)) {
    throw new Error(`unknown event type: ${input.type}`);
  }
  if (!SOURCES.includes(input.source)) {
    throw new Error(`unknown source: ${input.source}`);
  }
  // Clamp to ≤ now: backdated evidence is honest, future-dated dodges decay.
  const occurredAt =
    input.occurredAt && input.occurredAt.getTime() < Date.now()
      ? input.occurredAt
      : new Date();

  const computedPoints =
    input.type === "resume_imported"
      ? 0
      : input.pointsOverride !== undefined
        ? Math.max(0, Math.round(input.pointsOverride))
        : await basePoints(input.type, input.source);

  const event = await db.eventLog.create({
    data: {
      userId: input.userId,
      type: input.type,
      points: computedPoints,
      occurredAt,
      source: input.source,
      skills: input.skills ?? [],
      payload: input.payload as Prisma.InputJsonValue | undefined,
    },
  });

  // Single-writer discipline (D24): the cache is rebuilt from the log on
  // every append — never mutated independently.
  for (const skillId of event.skills) {
    await recomputeUserSkill(input.userId, skillId, occurredAt);
  }
  return event;
}

export function listEvents(userId: string, limit = 100) {
  return db.eventLog.findMany({
    where: { userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}

export async function countEventsReferencingSkill(
  skillId: string
): Promise<number> {
  return db.eventLog.count({ where: { skills: { has: skillId } } });
}
