import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { createToken } from "@/services/tokens";
import { addCredential } from "@/services/credentials";
import {
  mcpGetReport,
  mcpGetSpineSnapshot,
  mcpSaveDecisionRecord,
  mcpStartInterviewSession,
  mcpSubmitTranscript,
  type McpSubmittedTurn,
} from "@/services/mcp";

const TEST_PROVIDER = "ivmcpprovider";
const marker = `iv10_${Date.now()}`;
let userId: string;
let projectId: string;
let token: string;

function bankJson(count: number): string {
  const cats = ["architecture", "tradeoff", "failure", "scale"];
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      text: `MCP question ${i + 1}`,
      category: cats[i % 4],
    })),
  });
}

const bankFetch = (async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: bankJson(5) } }],
      usage: { prompt_tokens: 30, completion_tokens: 30 },
    }),
    { status: 200 }
  )) as unknown as typeof fetch;

function fullTranscript(): McpSubmittedTurn[] {
  return Array.from({ length: 5 }, (_, i) => ({
    question: `MCP question ${i + 1}`,
    answer: `Specific defended answer ${i + 1} naming the alternative and the cost`,
    pushesUsed: 0,
    durationMs: 15000,
  }));
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-m";
  await seedConfig();
  for (const feature of ["interview_turn", "interview_grader"]) {
    await db.providerRoute.updateMany({
      where: { feature },
      data: { isActive: false },
    });
    await db.providerRoute.create({
      data: {
        feature,
        provider: TEST_PROVIDER,
        model: "test-model",
        endpoint: "https://example.test/v1/chat/completions",
        costPer1kUsd: 0.0001,
        isActive: true,
      },
    });
  }
  const user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  userId = user.id;
  await addCredential(userId, TEST_PROVIDER, "sk-byo-mcp-test");
  const created = await createToken(userId, "mcp test");
  token = created.token;
  const project = await db.project.create({
    data: {
      userId,
      title: "MCP project",
      description: "d",
      skills: ["typescript"],
      links: [],
    },
  });
  projectId = project.id;
});

afterAll(async () => {
  await db.interviewReport.deleteMany({ where: { session: { userId } } });
  await db.interviewSession.deleteMany({ where: { userId } });
  await db.decisionRecord.deleteMany({ where: { userId } });
  await db.gatewayCache.deleteMany({
    where: { cacheKey: { startsWith: "interview_bank:" } },
  });
  await db.credential.deleteMany({ where: { userId } });
  await db.apiToken.deleteMany({ where: { userId } });
  await db.usage.deleteMany({ where: { userId } });
  await db.dailyCounter.deleteMany({ where: { userId } });
  await db.energyAccount.deleteMany({ where: { userId } });
  await db.project.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  for (const feature of ["interview_turn", "interview_grader"]) {
    await db.providerRoute.deleteMany({
      where: { feature, provider: TEST_PROVIDER },
    });
    await db.providerRoute.updateMany({
      where: { feature },
      data: { isActive: true },
    });
  }
  delete process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`];
});

describe("MCP surface (T10: D86/D88b,e)", () => {
  it("token authentication + start returns the website's bank with policy", async () => {
    const authed = await (
      await import("@/services/tokens")
    ).authenticateToken(token);
    expect(authed?.user.id).toBe(userId);

    const started = await mcpStartInterviewSession(
      userId,
      { scope: "project", mode: "quick", projectId },
      bankFetch
    );
    expect(started.bank).toHaveLength(5);
    expect(started.policy.pushCap).toBe(2);
    expect(started.policy.questionCount).toBe(5);
    const session = await db.interviewSession.findUnique({
      where: { id: started.sessionId },
    });
    expect(session?.origin).toBe("mcp");
  });

  it("submitting a full transcript completes + queues grading; NOTHING writes evidence directly", async () => {
    const started = await mcpStartInterviewSession(
      userId,
      { scope: "project", mode: "quick", projectId },
      bankFetch
    );
    const eventsBefore = await db.eventLog.count({
      where: { userId, type: "interview_completed" },
    });
    const res = await mcpSubmitTranscript(
      userId,
      started.sessionId,
      fullTranscript()
    );
    expect(res.status).toBe("completed");
    expect(res.graded).toBe("queued");

    const session = await db.interviewSession.findUnique({
      where: { id: started.sessionId },
      include: { turns: true },
    });
    expect(session?.status).toBe("completed");
    expect(session?.turns).toHaveLength(5);
    expect(session?.turns[0]?.durationMs).toBe(15000);

    const eventsAfter = await db.eventLog.count({
      where: { userId, type: "interview_completed" },
    });
    expect(eventsAfter).toBe(eventsBefore); // submit NEVER writes evidence (D29 boundary)
  });

  it("under-half transcript = abandoned, writes nothing", async () => {
    const started = await mcpStartInterviewSession(
      userId,
      { scope: "project", mode: "quick", projectId },
      bankFetch
    );
    const twoTurns = fullTranscript().slice(0, 2);
    const res = await mcpSubmitTranscript(userId, started.sessionId, twoTurns);
    expect(res.status).toBe("abandoned");
    expect(res.graded).toBe("none");
  });

  it("report poll returns pending until graded, then the report", async () => {
    const started = await mcpStartInterviewSession(
      userId,
      { scope: "project", mode: "quick", projectId },
      bankFetch
    );
    await mcpSubmitTranscript(userId, started.sessionId, fullTranscript());
    const before = await mcpGetReport(userId, started.sessionId);
    expect(before.status).toBe("pending");
    expect(before.report).toBeNull();

    // grade through the queue processor (drains one job, fake grader fetch)
    await import("@/services/worker");
    const graderJson = JSON.stringify({
      dimensions: {
        techDepth: 3,
        problemSolving: 3,
        tradeoffs: 3,
        communication: 3,
        composure: 3,
      },
      verdicts: [0, 1, 2, 3, 4].map((i) => ({ turnIdx: i, verdict: "green" })),
      probedSkills: [{ skill: "typescript", verdict: "green" }],
      groundedness: [],
      coaching: [{ say: "s", avoid: "a" }],
    });
    const graderFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: graderJson } }],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    void graderFetch;
    // the queued job runs with the real fetch — for the test, call the grader directly
    const { gradeInterviewSession } =
      await import("@/services/interview-grader");
    await gradeInterviewSession(started.sessionId, graderFetch);

    const after = await mcpGetReport(userId, started.sessionId);
    expect(after.status).toBe("graded");
    expect(after.report?.readinessBand).toBe("Strong");
    expect(after.report?.dimensions.techDepth).toBe(3);
  });

  it("spine snapshot is read-only context", async () => {
    const snap = await mcpGetSpineSnapshot(userId);
    expect(snap.projects.map((p) => p.title)).toContain("MCP project");
    expect(Array.isArray(snap.evidencedSkills)).toBe(true);
  });

  it("save_decision_record demands explicit user confirmation", async () => {
    await expect(
      mcpSaveDecisionRecord(userId, {
        projectId,
        choice: "Postgres",
        rationale: "atomicity",
        userConfirmed: false,
      })
    ).rejects.toThrow("ask the user first");
    const saved = await mcpSaveDecisionRecord(userId, {
      projectId,
      choice: "Postgres",
      alternatives: ["Mongo"],
      rationale: "transactional event writes",
      userConfirmed: true,
    });
    expect(saved.status).toBe("confirmed");
    const record = await db.decisionRecord.findUnique({
      where: { id: saved.id },
    });
    expect(record?.source).toBe("plugin");
  });
});
