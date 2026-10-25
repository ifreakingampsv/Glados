import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import {
  getInterviewSession,
  startInterviewSession,
  type InterviewMode,
  type InterviewScope,
} from "@/services/interview";
import { createDecisionRecord } from "@/services/decision-records";
import { enqueueJob } from "@/services/worker";
import { GRADING_QUEUE } from "@/services/interview-grader";
import { todayUtc } from "@/services/energy";

// S2 MCP surface (D29/D35/D86). Five thin tools over the same service layer
// the website calls. NO tool writes evidence events — transcripts flow back
// and the PLATFORM grader is the only evidence writer (D29 as API surface).

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "start_interview_session",
    description:
      "Start a mock interview. Returns the SAME cached, ranked question bank the website uses, plus session policy (question count, push cap). Run the conversation on your own model; deliver questions one at a time; push back on vagueness by NAMING it, at most pushCap times per question.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["project", "portfolio", "application"],
        },
        mode: { type: "string", enum: ["quick", "deep"] },
        projectId: { type: "string" },
        projectIds: { type: "array", items: { type: "string" } },
        jdId: { type: "string" },
      },
      required: ["scope", "mode"],
    },
  },
  {
    name: "submit_interview_transcript",
    description:
      "Submit the finished interview in ONE call: every turn (question, answer, pushesUsed, durationMs). Under half answered = abandoned and writes nothing. A completed submission enqueues platform grading; over the daily cap it grades when the cap resets — poll get_interview_report.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        turns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
              pushesUsed: { type: "number" },
              durationMs: { type: "number" },
            },
            required: ["question", "answer"],
          },
        },
      },
      required: ["sessionId", "turns"],
    },
  },
  {
    name: "get_interview_report",
    description:
      "Poll the graded report for a session: five dimension scores, per-question verdicts, groundedness findings, coaching. Returns pending until the platform grader has run.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "get_spine_snapshot",
    description:
      "Read-only coaching context: projects with skills, evidenced skill levels vs claims, target roles. Use it to personalize the conversation — never to fabricate depth the user doesn't have.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "save_decision_record",
    description:
      "Save an ADR-lite decision record for a project (choice, alternatives, rationale). CLAIM-tier — it sharpens future grading, never adds evidence. You MUST ask the user and pass userConfirmed=true only after they agreed.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        choice: { type: "string" },
        alternatives: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
        sessionId: { type: "string" },
        userConfirmed: { type: "boolean" },
      },
      required: ["projectId", "choice", "rationale", "userConfirmed"],
    },
  },
];

export async function mcpStartInterviewSession(
  userId: string,
  input: {
    scope?: string;
    mode?: string;
    projectId?: string;
    projectIds?: string[];
    jdId?: string;
  },
  fetchImpl?: typeof fetch
) {
  const scope: InterviewScope =
    input.scope === "portfolio" || input.scope === "application"
      ? input.scope
      : "project";
  const mode: InterviewMode = input.mode === "deep" ? "deep" : "quick";
  const started = await startInterviewSession(userId, {
    scope,
    mode,
    projectId: input.projectId,
    projectIds: input.projectIds,
    jdId: input.jdId,
    origin: "mcp",
    forcePlatform: true, // D88d: MCP bank generation is platform-side
    fetchImpl,
  });
  const session = await getInterviewSession(userId, started.sessionId);
  const payload = (session?.payload ?? {}) as {
    questionCount?: number;
    pushCap?: number;
    bankCacheKey?: string;
  };
  // Re-read the bank from cache so the harness gets the full question list
  const cached = payload.bankCacheKey
    ? await db.gatewayCache.findUnique({
        where: { cacheKey: payload.bankCacheKey },
      })
    : null;
  let questions: Array<{ text: string; category: string }> = [];
  if (cached) {
    try {
      const parsed = JSON.parse(
        cached.content
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/```$/i, "")
      ) as { questions?: Array<{ text: string; category: string }> };
      questions = parsed.questions ?? [];
    } catch {
      questions = [];
    }
  }
  return {
    sessionId: started.sessionId,
    policy: {
      questionCount: payload.questionCount ?? started.bankSize,
      pushCap: payload.pushCap ?? 2,
    },
    bank: questions,
  };
}

export interface McpSubmittedTurn {
  question: string;
  answer: string;
  pushesUsed?: number;
  durationMs?: number;
}

export async function mcpSubmitTranscript(
  userId: string,
  sessionId: string,
  turns: McpSubmittedTurn[]
): Promise<{
  status: "completed" | "abandoned";
  graded: "queued" | "deferred" | "none";
}> {
  const session = await getInterviewSession(userId, sessionId);
  if (!session) throw new Error("session not found");
  if (session.status !== "active") {
    return { status: session.status as "completed", graded: "none" };
  }

  const payload = (session.payload ?? {}) as { questionCount?: number };
  const total = payload.questionCount ?? Math.max(1, turns.length);
  const answered = turns.filter((t) => t.answer && t.answer.trim().length > 0);
  const subHalf = answered.length < Math.ceil(total / 2);

  if (subHalf) {
    await db.interviewSession.update({
      where: { id: sessionId },
      data: { status: "abandoned", abandonedAt: new Date() },
    });
    return { status: "abandoned", graded: "none" };
  }

  // Replace the placeholder turn with the real transcript
  await db.$transaction(async (tx) => {
    await tx.interviewTurn.deleteMany({ where: { sessionId } });
    for (const [i, t] of turns.entries()) {
      await tx.interviewTurn.create({
        data: {
          sessionId,
          idx: i,
          questionText: t.question,
          answerText: t.answer,
          pushesUsed: Math.max(0, Math.round(t.pushesUsed ?? 0)),
          durationMs:
            t.durationMs !== undefined
              ? Math.max(0, Math.round(t.durationMs))
              : null,
        },
      });
    }
    await tx.interviewSession.update({
      where: { id: sessionId },
      data: { status: "completed", completedAt: new Date() },
    });
  });

  // Grading enqueued; the JOB enforces the per-user daily cap at run time
  // (D84/D88e): over-cap re-enqueues for the next UTC day.
  await enqueueJob(GRADING_QUEUE, { sessionId, origin: "mcp" });
  const cap = await getConfig<number>("interview.mcpGradeDailyCap", 3);
  const counter = await db.dailyCounter.findUnique({
    where: { userId_date: { userId, date: todayUtc() } },
  });
  return {
    status: "completed",
    graded: (counter?.count ?? 0) >= cap ? "deferred" : "queued",
  };
}

export async function mcpGetReport(userId: string, sessionId: string) {
  const session = await getInterviewSession(userId, sessionId);
  if (!session) throw new Error("session not found");
  const report = await db.interviewReport.findUnique({
    where: { sessionId },
  });
  if (!report) {
    return {
      status:
        session.status === "graded"
          ? "graded"
          : session.status === "completed"
            ? "pending"
            : session.status,
      report: null,
    };
  }
  const payload = report.payload as Record<string, unknown>;
  if (payload.deleted) {
    return { status: "deleted", report: null };
  }
  return {
    status: "graded",
    report: {
      readinessBand: report.readinessBand,
      evidenceBasis: report.evidenceBasis,
      dimensions: {
        techDepth: report.techDepth,
        problemSolving: report.problemSolving,
        tradeoffs: report.tradeoffs,
        communication: report.communication,
        composure: report.composure,
      },
      verdicts: payload.verdicts,
      probedSkills: payload.probedSkills,
      groundedness: payload.groundedness,
      coaching: payload.coaching,
    },
  };
}

export async function mcpGetSpineSnapshot(userId: string) {
  const [projects, userSkills, skills, targetRoles, profile] =
    await Promise.all([
      db.project.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          description: true,
          skills: true,
          links: true,
        },
      }),
      db.userSkill.findMany({ where: { userId } }),
      db.skill.findMany({ select: { id: true, display: true } }),
      db.targetRole.findMany({ where: { userId } }),
      db.profile.findUnique({ where: { userId } }),
    ]);
  const display = new Map(skills.map((s) => [s.id, s.display]));
  return {
    profile: profile?.fields ?? null,
    targetRoles: targetRoles.map((r) => ({
      title: r.title,
      seniority: r.seniority,
      primary: r.isPrimary,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      skills: p.skills,
    })),
    evidencedSkills: userSkills.map((s) => ({
      skill: display.get(s.skillId) ?? s.skillId,
      score: Number(s.score.toFixed(1)),
      level: s.level,
    })),
  };
}

export async function mcpSaveDecisionRecord(
  userId: string,
  input: {
    projectId: string;
    choice: string;
    alternatives?: string[];
    rationale: string;
    sessionId?: string;
    userConfirmed?: boolean;
  }
) {
  if (input.userConfirmed !== true) {
    throw new Error(
      "ask the user first — pass userConfirmed=true only after they agree"
    );
  }
  const record = await createDecisionRecord(
    userId,
    input.projectId,
    {
      choice: input.choice,
      alternatives: input.alternatives ?? [],
      rationale: input.rationale,
    },
    { source: "plugin", sessionId: input.sessionId, status: "confirmed" }
  );
  return {
    id: record.id,
    status: record.status,
    note: "claim-tier — sharpens grading, never evidence",
  };
}
