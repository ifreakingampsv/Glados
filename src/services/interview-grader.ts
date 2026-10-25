import { db } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { gatewayCall } from "@/services/gateway";
import { getConfig, DEFAULT_POINTS } from "@/services/levels";
import {
  buildVisibleSurfacePack,
  type VisibleSurfacePack,
} from "@/services/interview";
import { resolveSkillId } from "@/lib/skill-resolution";

// Grader emits skill NAMES; evidence events need canonical ids. Resolve by
// canonical name (through any alias chain); unresolvable names stay in the
// report but write no evidence.
async function resolveSkillByName(name: string): Promise<string | null> {
  const row = await db.skill.findUnique({
    where: { name: name.trim().toLowerCase() },
  });
  if (!row) return null;
  try {
    return await resolveSkillId(row.id);
  } catch {
    return null;
  }
}

// S2 grader (D81/D82/D88). One queued platform-side call per completed
// session; the ONLY writer of interview evidence. Intrinsic mode here —
// decision-records mode lands with ticket 05.

export const GRADING_QUEUE = "interview_grading";
export const INTERVIEW_GRADER_FEATURE = "interview_grader";

export const DIMENSION_KEYS = [
  "techDepth",
  "problemSolving",
  "tradeoffs",
  "communication",
  "composure",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export type Verdict = "green" | "amber" | "red";

export interface GraderVerdict {
  turnIdx: number;
  verdict: Verdict;
}

export interface GraderProbedSkill {
  skill: string;
  verdict: Verdict;
}

export interface GraderGroundedness {
  finding: string;
  turnIdx: number;
  recordId?: string;
}

export interface GraderCoaching {
  say: string;
  avoid: string;
  fix?: string;
}

export interface GraderOutput {
  dimensions: Record<DimensionKey, number>;
  verdicts: GraderVerdict[];
  probedSkills: GraderProbedSkill[];
  groundedness: GraderGroundedness[];
  coaching: GraderCoaching[];
}

// Deterministic band from dimension scores (no AI at render time, D30/D82).
export function readinessBandFor(
  dimensions: Record<DimensionKey, number>
): "Developing" | "Ready" | "Strong" {
  const avg =
    DIMENSION_KEYS.reduce((sum, k) => sum + (dimensions[k] ?? 0), 0) /
    DIMENSION_KEYS.length;
  if (avg >= 3) return "Strong";
  if (avg >= 2) return "Ready";
  return "Developing";
}

function parseGraderContent(content: string): GraderOutput | null {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as GraderOutput;
  } catch {
    return null;
  }
}

function isVerdict(v: unknown): v is Verdict {
  return v === "green" || v === "amber" || v === "red";
}

// Deterministic validation — a hallucinated citation fails grading LOUDLY
// (D83's zero-hallucinated-citation guarantee, enforced at the source).
export function validateGraderOutput(
  raw: GraderOutput | null,
  answeredTurnIdx: number[],
  validRecordIds: Set<string> = new Set()
): { ok: boolean; errors: string[]; output: GraderOutput | null } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["unparseable_output"], output: null };
  }
  const dims = raw.dimensions ?? ({} as Record<DimensionKey, number>);
  for (const key of DIMENSION_KEYS) {
    const v = dims[key];
    if (!Number.isInteger(v) || v < 1 || v > 4) {
      errors.push(`dimension:${key}`);
    }
  }
  const validIdx = new Set(answeredTurnIdx);
  if (!Array.isArray(raw.verdicts) || raw.verdicts.length === 0) {
    errors.push("verdicts:missing");
  } else {
    for (const v of raw.verdicts) {
      if (!validIdx.has(v.turnIdx))
        errors.push(`verdict:bad_turn_idx:${v.turnIdx}`);
      if (!isVerdict(v.verdict))
        errors.push(`verdict:bad_verdict:${v.verdict}`);
    }
  }
  if (!Array.isArray(raw.probedSkills) || raw.probedSkills.length === 0) {
    errors.push("probedSkills:missing");
  } else {
    for (const p of raw.probedSkills) {
      if (!p.skill || !isVerdict(p.verdict))
        errors.push("probedSkills:invalid");
    }
  }
  if (Array.isArray(raw.groundedness)) {
    for (const g of raw.groundedness) {
      if (!validIdx.has(g.turnIdx))
        errors.push(`groundedness:bad_turn_idx:${g.turnIdx}`);
      if (!g.finding) errors.push("groundedness:missing_finding");
      if (g.recordId && !validRecordIds.has(g.recordId)) {
        errors.push(`groundedness:bad_record_id:${g.recordId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, output: raw };
}

const GRADER_SYSTEM_PROMPT = `You grade a completed startup-mode technical interview transcript. Score five dimensions, each an integer 1-4 (1 = absent, 2 = weak, 3 = solid, 4 = strong): techDepth (per-skill technical substance), problemSolving, tradeoffs (alternatives named, costs owned), communication, composure (resistance to follow-up pressure; pushes used is in the transcript). Give a verdict per answered turn: green (defended), amber (partially defended), red (hand-waved). List the probed skills with their overall verdict. Groundedness findings are CONTRADICTIONS between answers and the supplied context (project surface, and decision records when present) — each MUST cite an existing turn index, and a record contradiction MUST cite the record's id; if none, return an empty array. Coaching: one Say (model answer shape) and one Avoid (what weakened the answers). Return JSON only: {"dimensions": {"techDepth": 1-4, "problemSolving": 1-4, "tradeoffs": 1-4, "communication": 1-4, "composure": 1-4}, "verdicts": [{"turnIdx": 0, "verdict": "green|amber|red"}], "probedSkills": [{"skill": "name", "verdict": "green|amber|red"}], "groundedness": [{"finding": "...", "turnIdx": 0, "recordId": "only when contradicting a decision record"}], "coaching": [{"say": "...", "avoid": "...", "fix": "..."}]}`;

export interface GradeResult {
  reportId: string;
  readinessBand: string;
  graded: boolean;
}

export async function gradeInterviewSession(
  sessionId: string,
  fetchImpl?: typeof fetch
): Promise<GradeResult | null> {
  const existing = await db.interviewReport.findUnique({
    where: { sessionId },
  });
  if (existing) {
    return {
      reportId: existing.id,
      readinessBand: existing.readinessBand ?? "",
      graded: true,
    };
  }

  const session = await db.interviewSession.findUnique({
    where: { id: sessionId },
    include: { turns: { orderBy: { idx: "asc" } } },
  });
  if (!session) throw new Error("session not found");
  if (session.status === "deleted") throw new Error("session deleted");

  const answered = session.turns.filter((t) => t.answerText !== null);
  const payload = (session.payload ?? {}) as {
    questionCount?: number;
    grounding?: { projectId?: string | null };
    groundingPack?: VisibleSurfacePack;
  };
  const total = payload.questionCount ?? session.turns.length;
  // D80: under half answered = abandoned, writes nothing.
  if (answered.length < Math.ceil(total / 2)) {
    await db.interviewSession.update({
      where: { id: session.id },
      data: { status: "abandoned", abandonedAt: new Date() },
    });
    return null;
  }

  const project = payload.grounding?.projectId
    ? await db.project.findFirst({
        where: { id: payload.grounding.projectId, userId: session.userId },
      })
    : null;
  // Prefer the session's frozen grounding pack (works for every scope);
  // single-project fallback keeps pre-pack sessions gradeable.
  const surface: VisibleSurfacePack | null =
    payload.groundingPack ??
    (project ? buildVisibleSurfacePack(project) : null);

  // D79 records mode: confirmed decision records join the grading context.
  // Staleness (record predates the project's latest change) demotes a record
  // to corroboration-only; the evidence basis flips on FRESH records only.
  const groundingProjectId = payload.grounding?.projectId ?? null;
  const confirmedRecords = groundingProjectId
    ? await db.decisionRecord.findMany({
        where: {
          userId: session.userId,
          projectId: groundingProjectId,
          status: "confirmed",
        },
      })
    : [];
  const projectUpdatedAt = project?.updatedAt ?? new Date(0);
  const freshRecords = confirmedRecords.filter(
    (r) => r.updatedAt.getTime() >= projectUpdatedAt.getTime()
  );
  const staleRecords = confirmedRecords.filter(
    (r) => r.updatedAt.getTime() < projectUpdatedAt.getTime()
  );
  const validRecordIds = new Set(freshRecords.map((r) => r.id));
  const evidenceBasis = freshRecords.length > 0 ? "records" : "intrinsic";

  const gw = await gatewayCall(
    {
      userId: session.userId,
      feature: INTERVIEW_GRADER_FEATURE,
      skipEnergy: true, // queued platform spend, D88f — not user-visible energy
      messages: [
        { role: "system", content: GRADER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            surface,
            decisionRecords: {
              fresh: freshRecords.map((r) => ({
                id: r.id,
                choice: r.choice,
                alternatives: r.alternatives,
                rationale: r.rationale,
              })),
              staleCorroborationOnly: staleRecords.map((r) => ({
                id: r.id,
                choice: r.choice,
              })),
            },
            transcript: session.turns.map((t) => ({
              turnIdx: t.idx,
              question: t.questionText,
              answer: t.answerText,
              pushesUsed: t.pushesUsed,
              durationMs: t.durationMs,
            })),
          }),
        },
      ],
    },
    fetchImpl
  );
  if (gw.status !== "ok") {
    throw new Error(`grader call failed: ${gw.status}`);
  }

  const answeredIdx = answered.map((t) => t.idx);
  const { ok, errors, output } = validateGraderOutput(
    parseGraderContent(gw.content),
    answeredIdx,
    validRecordIds
  );
  if (!ok || !output) {
    throw new Error(`grading failed validation: ${errors.join("; ")}`);
  }

  const readinessBand = readinessBandFor(output.dimensions);
  const report = await db.interviewReport.create({
    data: {
      sessionId: session.id,
      techDepth: output.dimensions.techDepth,
      problemSolving: output.dimensions.problemSolving,
      tradeoffs: output.dimensions.tradeoffs,
      communication: output.dimensions.communication,
      composure: output.dimensions.composure,
      evidenceBasis,
      readinessBand,
      payload: {
        verdicts: output.verdicts,
        probedSkills: output.probedSkills,
        groundedness: output.groundedness,
        coaching: output.coaching,
        model: "interview_grader:route",
        promptVersion: 1,
      } as never,
    },
  });
  await db.interviewSession.update({
    where: { id: session.id },
    data: { status: "graded" },
  });

  // Evidence write-back (D81/D88c): one event per probed skill, verdict-scaled.
  const fractions = await getConfig<Record<Verdict, number>>(
    "interview.verdictFractions",
    { green: 1, amber: 0.5, red: 0 }
  );
  const pointsTypes = await getConfig("points.types", DEFAULT_POINTS);
  const base =
    (pointsTypes as Record<string, number>).interview_completed ??
    DEFAULT_POINTS.interview_completed ??
    10;

  for (const probed of output.probedSkills) {
    const skillId = await resolveSkillByName(probed.skill);
    if (!skillId) continue; // unresolvable skill name: report keeps it, no evidence event
    const fraction = fractions[probed.verdict] ?? 0;
    const points = Math.max(0, Math.round(base * fraction));
    await appendEvent({
      userId: session.userId,
      source: "system",
      type: "interview_completed",
      skills: [skillId],
      pointsOverride: points,
      payload: {
        sessionId: session.id,
        reportId: report.id,
        origin: session.origin,
        verdict: probed.verdict,
      },
    });
  }

  return { reportId: report.id, readinessBand, graded: true };
}
