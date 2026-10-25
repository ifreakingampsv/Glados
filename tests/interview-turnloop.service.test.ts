import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { addCredential } from "@/services/credentials";
import {
  advanceSession,
  sweepAbandonedInterviews,
  submitAnswer,
  type InterviewBank,
} from "@/services/interview";

// Turn-loop tests run on the BYO route so no platform key is involved.
const TEST_PROVIDER = "ivturnprovider";
const marker = `iv03_${Date.now()}`;
let userId: string;
let projectId: string;
let sessionId: string;

function bankJson(count: number): string {
  const cats = ["architecture", "tradeoff", "failure", "scale"];
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      text: `Bank question ${i + 1}`,
      category: cats[i % 4],
    })),
  });
}

function advanceJson(action: "push" | "next", question?: string): string {
  return JSON.stringify({ action, question });
}

function makeFetch(responder: (body: string) => string) {
  const state = { calls: 0 };
  const impl = (async (_url: unknown, init?: { body?: string }) => {
    state.calls += 1;
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content: string }>;
    };
    const last =
      requestBody.messages?.[requestBody.messages.length - 1]?.content ?? "";
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: responder(last) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  return { impl, state };
}

// Bank generation fetch: always a valid bank; advance fetch: scripted by
// matching on the advance prompt marker.
function makeScriptedFetch(script: Array<"push" | "next">) {
  let step = 0;
  return makeFetch((body) => {
    if (body.includes('"transcript"')) {
      const action = script[Math.min(step, script.length - 1)] ?? "next";
      step += 1;
      return advanceJson(
        action,
        action === "push" ? `Push ${step}: easier than what?` : undefined
      );
    }
    return bankJson(5);
  });
}

async function startSession(fetchImpl: typeof fetch) {
  const { startInterviewSession } = await import("@/services/interview");
  return startInterviewSession(userId, { projectId, mode: "quick", fetchImpl });
}

async function freshSession(
  script: Array<"push" | "next">,
  fetchBox: { impl: typeof fetch }
) {
  const made = makeScriptedFetch(script);
  fetchBox.impl = made.impl;
  const { sessionId: sid } = await startSession(made.impl);
  return sid;
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-x";
  await seedConfig();
  await db.providerRoute.updateMany({
    where: { feature: "interview_turn" },
    data: { isActive: false },
  });
  await db.providerRoute.create({
    data: {
      feature: "interview_turn",
      provider: TEST_PROVIDER,
      model: "test-model",
      endpoint: "https://example.test/v1/chat/completions",
      costPer1kUsd: 0.0001,
      isActive: true,
    },
  });
  const user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  userId = user.id;
  await addCredential(userId, TEST_PROVIDER, "sk-byo-test-key-long");
  const project = await db.project.create({
    data: {
      userId,
      title: "Turn loop project",
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
  await db.gatewayCache.deleteMany({
    where: { cacheKey: { startsWith: "interview_bank:" } },
  });
  await db.credential.deleteMany({ where: { userId } });
  await db.usage.deleteMany({ where: { userId } });
  await db.dailyCounter.deleteMany({ where: { userId } });
  await db.energyAccount.deleteMany({ where: { userId } });
  await db.project.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  await db.providerRoute.deleteMany({
    where: { feature: "interview_turn", provider: TEST_PROVIDER },
  });
  await db.providerRoute.updateMany({
    where: { feature: "interview_turn" },
    data: { isActive: true },
  });
  delete process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`];
});

describe("interview turn loop (T03: D80/D88f)", () => {
  it("pushes on vague answers, names the vagueness, then moves on; caps at 2", async () => {
    const box: { impl: typeof fetch } = { impl: fetch };
    const sid = await freshSession(["push", "push", "next"], box);
    await submitAnswer(userId, sid, "it was easier");
    let res = await advanceSession(userId, sid, box.impl);
    expect(res.action).toBe("push");
    expect(res.question).toContain("easier than what");

    await submitAnswer(userId, sid, "easier than building a queue myself");
    res = await advanceSession(userId, sid, box.impl);
    expect(res.action).toBe("push"); // second push allowed

    await submitAnswer(
      userId,
      sid,
      "the alternative was BullMQ; I gave up at-most-once"
    );
    res = await advanceSession(userId, sid, box.impl);
    expect(res.action).toBe("next");
    expect(res.question).toContain("Bank question 2");

    const session = await db.interviewSession.findUnique({
      where: { id: sid },
      include: { turns: { orderBy: { idx: "asc" } } },
    });
    // q1 + two pushes + q2 = 4 turns; push telemetry recorded per turn
    expect(session?.turns).toHaveLength(4);
    expect(session?.turns[1]?.pushesUsed).toBe(1);
    expect(session?.turns[2]?.pushesUsed).toBe(2);
    expect(session?.turns[3]?.pushesUsed).toBe(0);
    sessionId = sid; // reuse for the abandon test below
  });

  it("forces a move-on when the model pushes past the cap", async () => {
    const box: { impl: typeof fetch } = { impl: fetch };
    const sid = await freshSession(["push", "push", "push"], box);
    await submitAnswer(userId, sid, "vague");
    await advanceSession(userId, sid, box.impl); // push 1
    await submitAnswer(userId, sid, "still vague");
    await advanceSession(userId, sid, box.impl); // push 2
    await submitAnswer(userId, sid, "vague again");
    const res = await advanceSession(userId, sid, box.impl); // model pushes, cap binds
    expect(res.action).toBe("next");
  });

  it("completes after the final bank question", async () => {
    const box: { impl: typeof fetch } = { impl: fetch };
    const sid = await freshSession(["next"], box);
    for (let i = 0; i < 5; i++) {
      await submitAnswer(userId, sid, `answer ${i}`);
      await advanceSession(userId, sid, box.impl);
    }
    const session = await db.interviewSession.findUnique({
      where: { id: sid },
    });
    expect(session?.status).toBe("completed");
    expect(session?.completedAt).not.toBeNull();
  });

  it("advance without a saved answer is rejected", async () => {
    const box: { impl: typeof fetch } = { impl: fetch };
    const sid = await freshSession(["next"], box);
    await expect(advanceSession(userId, sid, box.impl)).rejects.toThrow(
      "answer the current"
    );
  });

  it("a double gateway failure pauses (throws) but the answer stays saved", async () => {
    let mode: "ok" | "fail" = "ok";
    const box: { impl: typeof fetch } = { impl: fetch };
    const scripted = makeScriptedFetch(["next"]);
    const failing = (async (url: unknown, init?: { body?: string }) => {
      if (mode === "fail") return new Response("boom", { status: 500 });
      return (
        scripted.impl as unknown as (
          u: unknown,
          i?: { body?: string }
        ) => Promise<Response>
      )(url, init);
    }) as unknown as typeof fetch;
    box.impl = failing;
    const { sessionId: sid } = await startSession(scripted.impl);
    await submitAnswer(userId, sid, "my answer");
    mode = "fail";
    await expect(advanceSession(userId, sid, failing)).rejects.toThrow();
    const session = await db.interviewSession.findUnique({
      where: { id: sid },
      include: { turns: true },
    });
    expect(session?.status).toBe("active"); // paused, resumable
    expect(session?.turns[0]?.answerText).toBe("my answer"); // answer persisted
  });

  it("auto-abandon sweep marks stale active sessions abandoned", async () => {
    const stale = await db.interviewSession.findUnique({
      where: { id: sessionId },
    });
    expect(stale?.status).toBe("active");
    await db.interviewSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    const count = await sweepAbandonedInterviews();
    expect(count).toBeGreaterThanOrEqual(1);
    const after = await db.interviewSession.findUnique({
      where: { id: sessionId },
    });
    expect(after?.status).toBe("abandoned");
    expect(after?.abandonedAt).not.toBeNull();
  });

  it("bank reload regenerates when the cache row is missing", async () => {
    const box: { impl: typeof fetch } = { impl: fetch };
    const sid = await freshSession(["next"], box);
    await submitAnswer(userId, sid, "a1");
    await advanceSession(userId, sid, box.impl);
    const session = await db.interviewSession.findUnique({
      where: { id: sid },
    });
    const cacheKey = ((session?.payload as { bankCacheKey?: string }) ?? {})
      .bankCacheKey;
    expect(cacheKey).toBeTruthy();
    await db.gatewayCache.delete({ where: { cacheKey: cacheKey! } });
    await submitAnswer(userId, sid, "a2");
    const res = await advanceSession(userId, sid, box.impl); // triggers regen
    expect(res.action).toBe("next");
    const rows = await db.gatewayCache.count({
      where: { cacheKey: { startsWith: "interview_bank:" } },
    });
    expect(rows).toBeGreaterThan(0);
  });

  it("resume regenerates the bank when the project content version changed", async () => {
    const box: { impl: typeof fetch } = { impl: fetch };
    const sid = await freshSession(["next"], box);
    await db.project.update({
      where: { id: projectId },
      data: { description: "changed description — new content version" },
    });
    const { resumeInterviewSession } = await import("@/services/interview");
    const res = await resumeInterviewSession(
      userId,
      sid,
      makeScriptedFetch(["next"]).impl
    );
    expect(res.regeneratedBank).toBe(true);
    const unchanged = await resumeInterviewSession(
      userId,
      sid,
      makeScriptedFetch(["next"]).impl
    );
    expect(unchanged.regeneratedBank).toBe(false);
  });

  it("sanity: exported bank types remain parseable", () => {
    const b: InterviewBank = {
      questions: [{ text: "q", category: "tradeoff" }],
    };
    expect(b.questions).toHaveLength(1);
  });
});
