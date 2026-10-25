import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import {
  confirmDecisionRecord,
  createDecisionRecord,
  draftDecisionRecordsFromSession,
} from "@/services/decision-records";
import { gradeInterviewSession } from "@/services/interview-grader";

const TEST_PROVIDER = "ivrecprovider";
const marker = `iv05_${Date.now()}`;
let userId: string;
let projectId: string;

function makeFetch(content: string) {
  const state = { calls: 0 };
  const impl = (async () => {
    state.calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 50, completion_tokens: 50 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  return { impl, state };
}

async function makeGradedSessionFixture(opts?: { record?: boolean }) {
  const session = await db.interviewSession.create({
    data: {
      userId,
      scope: "project",
      mode: "quick",
      status: "completed",
      origin: "web",
      payload: { grounding: { projectId }, questionCount: 2 },
      completedAt: new Date(),
    },
  });
  for (let i = 0; i < 2; i++) {
    await db.interviewTurn.create({
      data: {
        sessionId: session.id,
        idx: i,
        questionText: `Q${i}`,
        answerText: `defended answer ${i}`,
        pushesUsed: 0,
      },
    });
  }
  return session.id;
}

function graderJson(recordId?: string): string {
  return JSON.stringify({
    dimensions: {
      techDepth: 3,
      problemSolving: 3,
      tradeoffs: 3,
      communication: 3,
      composure: 3,
    },
    verdicts: [
      { turnIdx: 0, verdict: "green" },
      { turnIdx: 1, verdict: "green" },
    ],
    probedSkills: [{ skill: "typescript", verdict: "green" }],
    groundedness: recordId
      ? [{ finding: "answer contradicts the record", turnIdx: 0, recordId }]
      : [],
    coaching: [{ say: "keep naming costs", avoid: "vagueness" }],
  });
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-r";
  await seedConfig();
  for (const feature of ["interview_grader", "interview_turn"]) {
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
        costPer1kUsd: 0.001,
        isActive: true,
      },
    });
  }
  const user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  userId = user.id;
  const project = await db.project.create({
    data: {
      userId,
      title: "Records project",
      description: "d",
      skills: ["typescript"],
      links: [],
    },
  });
  projectId = project.id;
});

afterAll(async () => {
  await db.decisionRecord.deleteMany({ where: { userId } });
  await db.interviewReport.deleteMany({ where: { session: { userId } } });
  await db.interviewSession.deleteMany({ where: { userId } });
  await db.eventLog.deleteMany({
    where: { userId, type: "interview_completed" },
  });
  await db.userSkill.deleteMany({ where: { userId } });
  await db.gatewayCache.deleteMany({
    where: { cacheKey: { startsWith: "iv_debrief:" } },
  });
  await db.usage.deleteMany({ where: { userId } });
  await db.dailyCounter.deleteMany({ where: { userId } });
  await db.energyAccount.deleteMany({ where: { userId } });
  await db.project.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  for (const feature of ["interview_grader", "interview_turn"]) {
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

describe("decision records (T05: D79/D82)", () => {
  it("manual records are user-authored and confirmed; they never write evidence", async () => {
    const before = await db.eventLog.count({ where: { userId } });
    const record = await createDecisionRecord(userId, projectId, {
      choice: "pg-boss for the queue",
      alternatives: ["BullMQ", "cron"],
      rationale: "atomic enqueue in the same tx as event inserts",
    });
    expect(record.status).toBe("confirmed");
    expect(record.source).toBe("manual");
    const after = await db.eventLog.count({ where: { userId } });
    expect(after).toBe(before); // claim-tier: zero events
  });

  it("debrief drafts records from a graded session; idempotent, cached per session", async () => {
    const sid = await makeGradedSessionFixture();
    await gradeInterviewSession(sid, makeFetch(graderJson()).impl);
    const fetcher = makeFetch(
      JSON.stringify({
        records: [
          {
            choice: "Prisma over raw SQL",
            alternatives: ["Kysely"],
            rationale: "review-ability beats raw visibility for me",
          },
        ],
      })
    );
    const first = await draftDecisionRecordsFromSession(
      userId,
      sid,
      fetcher.impl
    );
    expect(first.drafted).toBe(1);
    expect(fetcher.state.calls).toBe(1);
    const rows = await db.decisionRecord.findMany({
      where: { sessionId: sid },
    });
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.source).toBe("interview_debrief");

    const second = await draftDecisionRecordsFromSession(
      userId,
      sid,
      fetcher.impl
    );
    expect(second.drafted).toBe(1);
    expect(fetcher.state.calls).toBe(1); // never drafted twice

    await confirmDecisionRecord(userId, rows[0]!.id);
    const confirmed = await db.decisionRecord.findUnique({
      where: { id: rows[0]!.id },
    });
    expect(confirmed?.status).toBe("confirmed");
  });

  it("records mode grades against fresh records and validates record citations", async () => {
    // fresh record: project untouched since creation
    const rec = await db.decisionRecord.findFirst({
      where: { userId, projectId, status: "confirmed" },
    });
    expect(rec).not.toBeNull();
    const sid = await makeGradedSessionFixture();

    const ok = await gradeInterviewSession(
      sid,
      makeFetch(graderJson(rec!.id)).impl
    );
    expect(ok?.graded).toBe(true);
    const report = await db.interviewReport.findUnique({
      where: { sessionId: sid },
    });
    expect(report?.evidenceBasis).toBe("records");

    // hallucinated record citation fails loudly
    const sid2 = await makeGradedSessionFixture();
    await expect(
      gradeInterviewSession(sid2, makeFetch(graderJson("no-such-record")).impl)
    ).rejects.toThrow("bad_record_id");
  });

  it("stale records fall back to intrinsic basis (corroboration-only)", async () => {
    // bump the project AFTER the record exists → record is now stale
    await db.project.update({
      where: { id: projectId },
      data: { description: "changed after records were written" },
    });
    const sid = await makeGradedSessionFixture();
    const ok = await gradeInterviewSession(sid, makeFetch(graderJson()).impl);
    expect(ok?.graded).toBe(true);
    const report = await db.interviewReport.findUnique({
      where: { sessionId: sid },
    });
    expect(report?.evidenceBasis).toBe("intrinsic"); // all records stale
  });
});
