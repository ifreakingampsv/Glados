import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import {
  getEvalAnchors,
  getEvalRunHistory,
  runGoldenSet,
  setEvalAnchor,
  summarizeRun,
  estimateEvalRunCostUsd,
} from "@/services/eval-runner";
import { GOLDEN_TRANSCRIPTS } from "@/services/eval-golden";

const TEST_PROVIDER = "ivrunnerprovider";
const marker = `iv08_${Date.now()}`;

// Deterministic fake grader: band per fixture derived from its label so the
// runner's consensus + drift logic is exercised without any LLM spend.
function fetchFor(bandFor: (fixtureId: string) => string) {
  const state = { requests: 0 };
  const impl = (async (_url: unknown, init?: { body?: string }) => {
    state.requests += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content: string }>;
    };
    const userMsg = body.messages?.[body.messages.length - 1]?.content ?? "";
    // the runner sends surface+transcript; fixture identity comes from turn text
    let dims = {
      techDepth: 3,
      problemSolving: 3,
      tradeoffs: 3,
      communication: 3,
      composure: 3,
    };
    let verdict = "green";
    const fixtureId = bandFor(currentFixtureOf(userMsg));
    const band = fixtureId;
    if (band === "Developing") {
      dims = {
        techDepth: 1,
        problemSolving: 2,
        tradeoffs: 1,
        communication: 2,
        composure: 1,
      };
      verdict = "red";
    } else if (band === "Ready") {
      dims = {
        techDepth: 3,
        problemSolving: 3,
        tradeoffs: 3,
        communication: 2,
        composure: 2,
      };
      verdict = "amber";
    }
    const turnCount = (userMsg.match(/"turnIdx"/g) ?? []).length;
    const verdicts = Array.from({ length: Math.max(1, turnCount) }, (_, i) => ({
      turnIdx: i,
      verdict,
    }));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                dimensions: dims,
                verdicts,
                probedSkills: [{ skill: "typescript", verdict }],
                groundedness: [],
                coaching: [{ say: "s", avoid: "a" }],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  return { impl, state };
}

const fixtureBand = new Map<string, string>();
function currentFixtureOf(userMsg: string): string {
  // fingerprint = first question + LAST answer + turn count — unique per
  // fixture even where individual answers are shared
  const turnCount = (userMsg.match(/"turnIdx"/g) ?? []).length;
  for (const f of GOLDEN_TRANSCRIPTS) {
    if (f.turns.length !== turnCount) continue;
    const firstQ = f.turns[0].question.slice(0, 25);
    const lastA = f.turns[f.turns.length - 1].answer.slice(0, 25);
    if (userMsg.includes(firstQ) && userMsg.includes(lastA)) {
      return f.id;
    }
  }
  return "GLD-03";
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-r";
  await seedConfig();
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
  for (const f of GOLDEN_TRANSCRIPTS) {
    fixtureBand.set(f.id, f.band);
  }
  // clean any prior eval history/anchors from other runs
  await db.config.deleteMany({
    where: { key: { in: ["eval.anchors", "eval.runHistory"] } },
  });
  await db.user.deleteMany({ where: { clerkId: "eval_golden_runner" } });
});

afterAll(async () => {
  await db.config.deleteMany({
    where: { key: { in: ["eval.anchors", "eval.runHistory"] } },
  });
  await db.user.deleteMany({ where: { clerkId: "eval_golden_runner" } });
  await db.providerRoute.deleteMany({
    where: { feature: "interview_grader", provider: TEST_PROVIDER },
  });
  await db.providerRoute.updateMany({
    where: { feature: "interview_grader" },
    data: { isActive: true },
  });
  delete process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`];
});

describe("eval runner (T08: D83/D88g)", () => {
  it("runs the golden set 3x per fixture, auto-anchors unanimity, records history", async () => {
    const fetcher = fetchFor(
      (fixtureId) => fixtureBand.get(fixtureId) ?? "Ready"
    );
    const summary = await runGoldenSet({
      fetchImpl: fetcher.impl,
      runsPerFixture: 3,
    });

    expect(summary.results).toHaveLength(10);
    expect(summary.autoAnchored.length).toBe(10); // deterministic fake = unanimous
    expect(summary.pendingAdjudication).toHaveLength(0);

    const anchors = await getEvalAnchors();
    expect(anchors["GLD-01"]).toBe("Developing");
    expect(anchors["GLD-03"]).toBe("Strong");

    const history = await getEvalRunHistory();
    expect(history[0]?.runId).toBe(summary.runId);

    // synthetic data cleaned: no sessions/reports/events left for eval user
    const evalUser = await db.user.findUnique({
      where: { clerkId: "eval_golden_runner" },
    });
    const sessions = await db.interviewSession.count({
      where: { userId: evalUser!.id },
    });
    expect(sessions).toBe(0);

    const gate = summarizeRun(summary);
    expect(gate.releaseGate).toBe(true); // no drift on first run
  });

  it("flags drift when the grader's band moves away from the anchor; splits pend", async () => {
    // flip one fixture's band: grader now says Strong where anchor says Developing
    fixtureBand.set("GLD-01", "Strong");
    // make requests alternate so at least one fixture produces split bands
    const underlying = fetchFor((id) => fixtureBand.get(id) ?? "Ready");
    let call = 0;
    const splitFetch = (async (url: unknown, init?: { body?: string }) => {
      call += 1;
      if (call % 5 === 0) {
        const userMsg = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content: string }>;
        };
        const id = currentFixtureOf(userMsg.messages?.at(-1)?.content ?? "");
        fixtureBand.set(
          id,
          fixtureBand.get(id) === "Strong" ? "Ready" : "Strong"
        );
      }
      return (
        underlying.impl as unknown as (
          u: unknown,
          i?: { body?: string }
        ) => Promise<Response>
      )(url, init);
    }) as unknown as typeof fetch;

    const summary = await runGoldenSet({
      fetchImpl: splitFetch,
      runsPerFixture: 3,
    });
    const drifted = summary.results
      .filter((r) => r.drift)
      .map((r) => r.fixtureId);
    expect(drifted).toContain("GLD-01");
    const gate = summarizeRun(summary);
    expect(gate.releaseGate).toBe(false); // drift → release gate red

    // manual adjudication sets/overrides an anchor
    await setEvalAnchor("GLD-01", "Strong");
    const anchors = await getEvalAnchors();
    expect(anchors["GLD-01"]).toBe("Strong");
  });

  it("estimates the run cost from the active route before anyone pays", async () => {
    const cost = await estimateEvalRunCostUsd(3);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1); // 10 fixtures × 3 runs × ~4k tokens at $0.001/1k
  });
});
