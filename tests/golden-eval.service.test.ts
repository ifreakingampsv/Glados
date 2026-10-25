import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { gradeInterviewSession } from "@/services/interview-grader";
import {
  GOLDEN_TRANSCRIPTS,
  cannedGraderResponseFor,
  goldenById,
} from "@/services/eval-golden";

// D83/D88g deterministic suite: the whole golden set runs through the REAL
// grading pipeline with canned grader outputs — zero LLM spend, runs in
// `npm run check`. A hallucinated citation variant must be rejected for every
// fixture (zero-hallucinated-citations guarantee).

const TEST_PROVIDER = "ivgoldprovider";
const marker = `iv07_${Date.now()}`;
let userId: string;
const sessionIds = new Map<string, string>();

function makeFetch(content: string) {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
      { status: 200 }
    )) as unknown as typeof fetch;
}

async function materialize(fixtureId: string) {
  const fixture = goldenById(fixtureId)!;
  const session = await db.interviewSession.create({
    data: {
      userId,
      scope: fixture.scope,
      mode: fixture.mode,
      status: "completed",
      origin: "web",
      payload: {
        grounding: { projectId: null, projectIds: [], jdId: null },
        groundingPack: {
          scope: fixture.scope,
          project: {
            id: "fixture-project",
            title: "Booking app",
            description: "Next.js + Postgres booking platform",
            skills: ["nextjs", "postgresql", "typescript"],
            links: [],
          },
        },
        questionCount: fixture.turns.length,
        pushCap: 2,
      },
      completedAt: new Date(),
    },
  });
  for (const [i, t] of fixture.turns.entries()) {
    await db.interviewTurn.create({
      data: {
        sessionId: session.id,
        idx: i,
        questionText: t.question,
        answerText: t.answer,
        pushesUsed: t.pushesUsed,
        durationMs: 20000,
      },
    });
  }
  return session.id;
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-gold";
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
  for (const fixture of GOLDEN_TRANSCRIPTS) {
    sessionIds.set(fixture.id, await materialize(fixture.id));
  }
});

afterAll(async () => {
  await db.interviewReport.deleteMany({ where: { session: { userId } } });
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

describe("golden set coverage (D83: both scopes, both modes, three edges)", () => {
  it("the set is exactly ten fixtures with the required coverage", () => {
    expect(GOLDEN_TRANSCRIPTS).toHaveLength(10);
    const scopes = new Set(GOLDEN_TRANSCRIPTS.map((g) => g.scope));
    expect(scopes.has("project")).toBe(true);
    expect(scopes.has("application")).toBe(true);
    expect(scopes.has("portfolio")).toBe(true);
    const labels = GOLDEN_TRANSCRIPTS.map((g) => g.label).join(" | ");
    expect(labels).toContain("hand-waver");
    expect(labels).toContain("hallucinated");
    expect(labels).toContain("ultra-short");
    expect(labels).toContain("records-vs-intrinsic");
  });

  it("fixture metadata is internally consistent", () => {
    for (const fixture of GOLDEN_TRANSCRIPTS) {
      for (const idx of fixture.knownVagueTurnIdx) {
        expect(idx).toBeLessThan(fixture.turns.length);
        expect(idx).toBeGreaterThanOrEqual(0);
      }
      // a hand-waver fixture must actually contain hand-waves
      if (
        fixture.label.includes("hand-waver") ||
        fixture.label.includes("ultra-short")
      ) {
        expect(fixture.knownVagueTurnIdx.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("deterministic grading over the golden set (zero LLM spend)", () => {
  for (const fixture of GOLDEN_TRANSCRIPTS) {
    it(`${fixture.id} (${fixture.label}): hallucinated citations rejected, valid outputs pass`, async () => {
      const sid = sessionIds.get(fixture.id)!;

      // 1. hallucination variants MUST be rejected loudly, nothing persisted
      await expect(
        gradeInterviewSession(
          sid,
          makeFetch(
            cannedGraderResponseFor(fixture, { hallucinate: "turnIdx" })
          )
        )
      ).rejects.toThrow("validation");
      await expect(
        gradeInterviewSession(
          sid,
          makeFetch(
            cannedGraderResponseFor(fixture, { hallucinate: "recordId" })
          )
        )
      ).rejects.toThrow("bad_record_id");
      expect(
        await db.interviewReport.count({ where: { sessionId: sid } })
      ).toBe(0);

      // 2. valid canned output passes the full pipeline
      const res = await gradeInterviewSession(
        sid,
        makeFetch(cannedGraderResponseFor(fixture))
      );
      expect(res?.graded).toBe(true);
      const report = await db.interviewReport.findUnique({
        where: { sessionId: sid },
      });
      expect(report?.readinessBand).toBe(fixture.band);
      expect(report?.evidenceBasis).toBe("intrinsic"); // no records materialized here

      // 3. evidence: one event per probed, resolvable skill — deterministic
      const events = await db.eventLog.count({
        where: {
          userId,
          type: "interview_completed",
          payload: { path: ["sessionId"], equals: sid },
        },
      });
      expect(events).toBe(fixture.probedSkills.length);
    });
  }
});
