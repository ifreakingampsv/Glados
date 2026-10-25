import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";
import {
  gradeInterviewSession,
  readinessBandFor,
  validateGraderOutput,
  type GraderOutput,
} from "@/services/interview-grader";
import { deleteInterviewSession } from "@/services/interview";

const TEST_PROVIDER = "ivgraderprovider";
const marker = `iv04_${Date.now()}`;
let userId: string;
let sessionId: string;
let skillId: string;

function graderJson(): string {
  return JSON.stringify({
    dimensions: {
      techDepth: 3,
      problemSolving: 2,
      tradeoffs: 2,
      communication: 3,
      composure: 2,
    },
    verdicts: [
      { turnIdx: 0, verdict: "green" },
      { turnIdx: 1, verdict: "amber" },
      { turnIdx: 2, verdict: "red" },
      { turnIdx: 3, verdict: "green" },
      { turnIdx: 4, verdict: "green" },
    ],
    probedSkills: [
      { skill: "postgresql", verdict: "green" },
      { skill: "typescript", verdict: "amber" },
    ],
    groundedness: [
      { finding: "claimed tests, surface shows none", turnIdx: 1 },
    ],
    coaching: [
      {
        say: "Name the alternative and the cost",
        avoid: '"it was easier"',
        fix: "Add the tradeoff to your README",
      },
    ],
  });
}

function makeFetch(content: string | (() => string)) {
  const state = { calls: 0 };
  const impl = (async () => {
    state.calls += 1;
    const body = typeof content === "function" ? content() : content;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: body } }],
        usage: { prompt_tokens: 200, completion_tokens: 300 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  return { impl, state };
}

async function makeCompletedSession(answered: number, total = 5) {
  const session = await db.interviewSession.create({
    data: {
      userId,
      scope: "project",
      mode: "quick",
      status: "completed",
      origin: "web",
      payload: { grounding: { projectId: null }, questionCount: total },
      completedAt: new Date(),
    },
  });
  for (let i = 0; i < total; i++) {
    await db.interviewTurn.create({
      data: {
        sessionId: session.id,
        idx: i,
        questionText: `Q${i}`,
        answerText: i < answered ? `A${i}` : null,
        pushesUsed: 0,
      },
    });
  }
  return session.id;
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-g";
  await seedConfig();
  await seedCanonicalSkills();
  await db.providerRoute.updateMany({
    where: { feature: "interview_grader" },
    data: { isActive: false },
  });
  await db.providerRoute.create({
    data: {
      feature: "interview_grader",
      provider: TEST_PROVIDER,
      model: "test-model",
      endpoint: "https://example.test/v1/chat/completions",
      costPer1kUsd: 0.001,
      isActive: true,
    },
  });
  const user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  userId = user.id;
  const skill = await db.skill.findFirst({ where: { name: "postgresql" } });
  skillId = skill?.id ?? "";
});

afterAll(async () => {
  await db.interviewReport.deleteMany({
    where: { session: { userId } },
  });
  await db.interviewSession.deleteMany({ where: { userId } });
  await db.eventLog.deleteMany({
    where: { userId, type: "interview_completed" },
  });
  await db.userSkill.deleteMany({ where: { userId } });
  await db.usage.deleteMany({ where: { userId } });
  await db.dailyCounter.deleteMany({ where: { userId } });
  await db.energyAccount.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  await db.providerRoute.deleteMany({
    where: { feature: "interview_grader", provider: TEST_PROVIDER },
  });
  await db.providerRoute.updateMany({
    where: { feature: "interview_grader" },
    data: { isActive: true },
  });
  delete process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`];
});

describe("interview grader (T04: D81/D82/D88)", () => {
  it("grades a completed session: report row, band, verdict-scaled evidence per skill", async () => {
    sessionId = await makeCompletedSession(5);
    const fetcher = makeFetch(graderJson());
    const res = await gradeInterviewSession(sessionId, fetcher.impl);
    expect(res?.graded).toBe(true);
    expect(res?.readinessBand).toBe("Ready"); // avg 2.4

    const report = await db.interviewReport.findUnique({
      where: { sessionId },
    });
    expect(report?.techDepth).toBe(3);
    expect(report?.evidenceBasis).toBe("intrinsic");

    const session = await db.interviewSession.findUnique({
      where: { id: sessionId },
    });
    expect(session?.status).toBe("graded");

    const events = await db.eventLog.findMany({
      where: {
        userId,
        type: "interview_completed",
        payload: { path: ["sessionId"], equals: sessionId },
      },
      orderBy: { points: "desc" },
    });
    expect(events).toHaveLength(2); // one per probed, resolvable skill
    expect(events[0]?.source).toBe("system");
    expect(events[0]?.points).toBe(10); // green = full base
    expect(events[1]?.points).toBe(5); // amber = half

    // the L3 uncap path: interview + existing evidence = corroborated buckets
    const userSkill = await db.userSkill.findUnique({
      where: {
        userId_skillId: { userId, skillId: events[0]?.skills[0] ?? "" },
      },
    });
    expect(Number(userSkill?.score ?? 0)).toBeGreaterThan(0);
  });

  it("is idempotent — a second grade call is a no-op", async () => {
    const fetcher = makeFetch(graderJson());
    const again = await gradeInterviewSession(sessionId, fetcher.impl);
    expect(again?.graded).toBe(true);
    expect(fetcher.state.calls).toBe(0); // never re-graded
    const count = await db.interviewReport.count({ where: { sessionId } });
    expect(count).toBe(1);
  });

  it("rejects hallucinated citations loudly (D83 zero-citation guarantee)", async () => {
    const bad = JSON.parse(graderJson()) as GraderOutput;
    bad.groundedness = [{ finding: "fabricated", turnIdx: 99 }];
    const sid = await makeCompletedSession(5);
    await expect(
      gradeInterviewSession(sid, makeFetch(JSON.stringify(bad)).impl)
    ).rejects.toThrow("validation");
    const report = await db.interviewReport.findUnique({
      where: { sessionId: sid },
    });
    expect(report).toBeNull(); // nothing persisted on hallucination
  });

  it("under-half answered = abandoned, writes nothing", async () => {
    const sid = await makeCompletedSession(2, 5); // 2 of 5 < half
    const fetcher = makeFetch(graderJson());
    const res = await gradeInterviewSession(sid, fetcher.impl);
    expect(res).toBeNull();
    expect(fetcher.state.calls).toBe(0); // grader never called
    const session = await db.interviewSession.findUnique({
      where: { id: sid },
    });
    expect(session?.status).toBe("abandoned");
  });

  it("tombstone deletion strips content and makes evidence stop counting", async () => {
    const before = await db.userSkill.findFirst({
      where: { userId, score: { gt: 0 } },
    });
    expect(before).not.toBeNull();

    const { affectedSkills } = await deleteInterviewSession(userId, sessionId);
    expect(affectedSkills.length).toBeGreaterThan(0);

    const session = await db.interviewSession.findUnique({
      where: { id: sessionId },
      include: { turns: true, reports: true },
    });
    expect(session?.status).toBe("deleted");
    expect(session?.turns).toHaveLength(0); // transcript stripped
    expect(session?.reports[0]?.techDepth).toBeNull(); // report stripped

    for (const skillId2 of affectedSkills) {
      const us = await db.userSkill.findUnique({
        where: { userId_skillId: { userId, skillId: skillId2 } },
      });
      // interview evidence excluded — score from this session is gone
      expect(Number(us?.score ?? 0)).toBe(0);
    }
    // event ROWS remain (append-only holds)
    const rows = await db.eventLog.count({
      where: {
        userId,
        type: "interview_completed",
        payload: { path: ["sessionId"], equals: sessionId },
      },
    });
    expect(rows).toBe(2);
  });

  it("readiness band thresholds are deterministic", () => {
    const dims = {
      techDepth: 3,
      problemSolving: 3,
      tradeoffs: 3,
      communication: 3,
      composure: 3,
    };
    expect(readinessBandFor(dims)).toBe("Strong");
    expect(readinessBandFor({ ...dims, composure: 1 })).toBe("Ready");
    expect(
      readinessBandFor({
        techDepth: 1,
        problemSolving: 1,
        tradeoffs: 1,
        communication: 2,
        composure: 1,
      })
    ).toBe("Developing");
  });

  it("validator rejects out-of-range dimensions and missing verdicts", () => {
    const base = JSON.parse(graderJson()) as GraderOutput;
    const badDim = validateGraderOutput(
      { ...base, dimensions: { ...base.dimensions, techDepth: 9 } },
      [0, 1, 2, 3, 4]
    );
    expect(badDim.ok).toBe(false);
    const noVerdicts = validateGraderOutput(
      { ...base, verdicts: [] },
      [0, 1, 2, 3, 4]
    );
    expect(noVerdicts.ok).toBe(false);
    const good = validateGraderOutput(base, [0, 1, 2, 3, 4]);
    expect(good.ok).toBe(true);
  });
});
