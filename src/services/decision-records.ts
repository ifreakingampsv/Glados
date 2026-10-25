import { db } from "@/lib/db";
import { gatewayCall, hashContentForCache } from "@/services/gateway";
import { INTERVIEW_TURN_FEATURE } from "@/services/interview";

// S2 decision records (D79/D82). ADR-lite, claim-tier — these NEVER write
// evidence events; they make grading richer, never more trusting.

export interface DecisionRecordInput {
  choice: string;
  alternatives: string[];
  rationale: string;
}

export async function createDecisionRecord(
  userId: string,
  projectId: string,
  input: DecisionRecordInput,
  options?: {
    source?: "manual" | "interview_debrief" | "plugin";
    sessionId?: string;
    status?: "draft" | "confirmed";
  }
) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) throw new Error("project not found");
  const choice = input.choice.trim();
  const rationale = input.rationale.trim();
  if (!choice || !rationale)
    throw new Error("choice and rationale are required");
  return db.decisionRecord.create({
    data: {
      userId,
      projectId,
      choice,
      alternatives: input.alternatives.map((a) => a.trim()).filter(Boolean),
      rationale,
      status: options?.status ?? "confirmed",
      source: options?.source ?? "manual",
      sessionId: options?.sessionId ?? null,
    },
  });
}

export async function confirmDecisionRecord(userId: string, recordId: string) {
  const record = await db.decisionRecord.findFirst({
    where: { id: recordId, userId },
  });
  if (!record) throw new Error("record not found");
  return db.decisionRecord.update({
    where: { id: recordId },
    data: { status: "confirmed" },
  });
}

export async function listDecisionRecords(userId: string, projectId: string) {
  return db.decisionRecord.findMany({
    where: { userId, projectId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listDecisionRecordsForProjects(
  userId: string,
  projectIds: string[]
) {
  return db.decisionRecord.findMany({
    where: { userId, projectId: { in: projectIds }, status: "confirmed" },
    orderBy: { updatedAt: "desc" },
  });
}

// D79: the interview is the ingestion mechanism. After a graded session,
// draft the choices the user defended; the user confirms — AI constructs,
// the user selects (D30).
export async function draftDecisionRecordsFromSession(
  userId: string,
  sessionId: string,
  fetchImpl?: typeof fetch
): Promise<{
  drafted: number;
  records: Array<{
    id: string;
    choice: string;
    alternatives: string[];
    rationale: string;
  }>;
}> {
  const session = await db.interviewSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { idx: "asc" } } },
  });
  if (!session) throw new Error("session not found");
  const payload = (session.payload ?? {}) as {
    grounding?: { projectId?: string };
  };
  const projectId = payload.grounding?.projectId;
  if (!projectId) throw new Error("session has no grounding project");

  const existing = await db.decisionRecord.findMany({
    where: { userId, sessionId },
  });
  if (existing.length > 0) {
    return {
      drafted: existing.length,
      records: existing.map((r) => ({
        id: r.id,
        choice: r.choice,
        alternatives: r.alternatives,
        rationale: r.rationale,
      })),
    };
  }

  const cacheKey = hashContentForCache(
    "iv_debrief",
    JSON.stringify({ sessionId })
  );
  const gw = await gatewayCall(
    {
      userId,
      feature: INTERVIEW_TURN_FEATURE,
      cacheKey, // per-session: drafting twice never pays twice
      interactive: true,
      skipEnergy: true,
      messages: [
        {
          role: "system",
          content:
            'From the interview transcript, extract up to 3 real technical decisions the candidate DEFENDED with specifics (not ones they hand-waved). For each: the choice, the named alternatives, and the rationale in the candidate\'s own substance. Return JSON only: {"records": [{"choice": "...", "alternatives": ["..."], "rationale": "..."}]} — empty array if nothing was genuinely defended.',
        },
        {
          role: "user",
          content: JSON.stringify({
            transcript: session.turns.map((t) => ({
              question: t.questionText,
              answer: t.answerText,
            })),
          }),
        },
      ],
    },
    fetchImpl
  );
  if (gw.status !== "ok") {
    throw new Error(
      `debrief drafting failed: ${gw.status === "byo_failed" ? gw.message : "unknown"}`
    );
  }
  const parsed = (() => {
    try {
      const cleaned = gw.content
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      return JSON.parse(cleaned) as { records?: DecisionRecordInput[] };
    } catch {
      return null;
    }
  })();
  const list = Array.isArray(parsed?.records) ? parsed!.records! : [];
  const created: Array<{
    id: string;
    choice: string;
    alternatives: string[];
    rationale: string;
  }> = [];
  for (const item of list.slice(0, 3)) {
    if (!item?.choice || !item?.rationale) continue;
    const row = await createDecisionRecord(
      userId,
      projectId,
      {
        choice: String(item.choice),
        alternatives: Array.isArray(item.alternatives)
          ? item.alternatives.map(String)
          : [],
        rationale: String(item.rationale),
      },
      { source: "interview_debrief", sessionId, status: "draft" }
    );
    created.push({
      id: row.id,
      choice: row.choice,
      alternatives: row.alternatives,
      rationale: row.rationale,
    });
  }
  return { drafted: created.length, records: created };
}
