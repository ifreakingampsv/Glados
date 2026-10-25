import { Prisma } from "@prisma/client";
import { db, type EventLog } from "@/lib/db";
import type { Source } from "@/lib/auth";
import {
  clampQuizDeltaForSkill,
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
  getConfig,
  recomputeUserSkill,
} from "@/services/levels";

// Fixed vocabulary (D25 + S1 + S1.5). skill_tagged, project_added,
// resume_imported, and post_drafted carry zero points: they are history/audit,
// not evidence — idle clicks can't farm the earned bar (D36).
export const EVENT_TYPES = [
  "skill_tagged",
  "project_added",
  "manual_evidence",
  "interview_passed", // reserved for S2
  "quiz_completed", // S1.5 calibration quizzes (signed deltas allowed)
  "system_adjustment",
  "repo_imported",
  "work_experience_added",
  "work_experience_confirmed",
  "resume_imported", // audit only, 0 points
  "certificate_added", // S1.5 externally anchored certificates
  "post_drafted", // S1.5 commit->post anchor, audit only, 0 points
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
  if (type === "resume_imported" || type === "post_drafted") return 0;
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
  now?: Date;
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
  const refNow = input.now ?? new Date();
  // Clamp to ≤ now: backdated evidence is honest, future-dated dodges decay.
  const occurredAt =
    input.occurredAt && input.occurredAt.getTime() <= refNow.getTime()
      ? input.occurredAt
      : refNow;

  let computedPoints: number;
  if (input.type === "resume_imported" || input.type === "post_drafted") {
    computedPoints = 0;
  } else if (input.pointsOverride !== undefined) {
    if (input.type === "quiz_completed") {
      // D59/D76: narrow negative lane ONLY for quiz_completed, bounded so the
      // decayed quiz-source contribution for the skill never drops below 0.
      const rawOverride = Math.round(input.pointsOverride);
      if (rawOverride < 0 && input.skills && input.skills.length > 0) {
        let bounded = rawOverride;
        for (const skillId of input.skills) {
          const perSkillBound = await clampQuizDeltaForSkill(
            input.userId,
            skillId,
            rawOverride,
            occurredAt
          );
          bounded = Math.max(bounded, perSkillBound);
        }
        computedPoints = bounded;
      } else {
        computedPoints = rawOverride;
      }
    } else {
      computedPoints = Math.max(0, Math.round(input.pointsOverride));
    }
  } else {
    computedPoints = await basePoints(input.type, input.source);
  }

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
