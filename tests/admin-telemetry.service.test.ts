import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  getAdminEvidenceReadouts,
  getAdminQuizTelemetry,
} from "@/services/economics";
import { ensureQuizBanksForSkill } from "@/services/quiz-banks";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";

const TEST_PREFIX = "test-telemetry-";
const createdUserIds: string[] = [];

async function makeUser(suffix: string, role: "USER" | "ADMIN" = "USER") {
  const id = `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createdUserIds.push(id);
  return db.user.create({
    data: {
      id,
      clerkId: `clerk_${id}`,
      email: `${id}@example.test`,
      role,
    },
  });
}

function makeBankStubFetch() {
  const fetchFn: typeof fetch = async (_url, init) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "{}";
    if (bodyStr.includes("Generate one concise")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Rust is a systems programming language focused on safety and concurrency.",
              },
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const questions = Array.from({ length: 24 }, (_, idx) => ({
      prompt: `Rust telemetry question #${idx + 1}: Which ownership rule applies in case ${idx + 1}?`,
      options: [
        `Option A for Q${idx + 1}`,
        `Option B for Q${idx + 1}`,
        `Option C for Q${idx + 1}`,
        `Option D for Q${idx + 1}`,
      ],
      correctIndex: 0,
      tags: ["ownership", `subtopic-${(idx % 4) + 1}`],
    }));

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ questions }),
            },
          },
        ],
        usage: { prompt_tokens: 150, completion_tokens: 300 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return fetchFn;
}

let admin: User;

beforeAll(async () => {
  process.env.PLATFORM_GOOGLE_API_KEY = "test-platform-google-key";
  await seedCanonicalSkills();
  await seedConfig();
  await seedRoutes();
  admin = await makeUser("admin-main", "ADMIN");
});

afterEach(async () => {
  const nonAdminIds = createdUserIds.filter((id) => id !== admin.id);
  if (nonAdminIds.length > 0) {
    await db.user.deleteMany({
      where: { id: { in: nonAdminIds } },
    });
    createdUserIds.length = 0;
    createdUserIds.push(admin.id);
  }
});

afterAll(async () => {
  const rustSkill = await db.skill.findUnique({ where: { name: "rust" } });
  if (rustSkill) {
    await db.quizBank.deleteMany({ where: { skillId: rustSkill.id } });
  }
  await db.user.deleteMany({ where: { id: admin.id } });
});

describe("admin quiz telemetry, divergence, and broken-question alerts (Ticket 06)", () => {
  it("renders 'Not enough data' states below per-readout minimums and renders aggregate-only metrics above N", async () => {
    const u1 = await makeUser("u1");
    const rustSkill = await db.skill.findUniqueOrThrow({
      where: { name: "rust" },
    });

    const banks = await ensureQuizBanksForSkill(
      rustSkill.id,
      admin.id,
      makeBankStubFetch()
    );
    const l01Bank = banks.find((b) => b.band === "L0-1")!;
    const q1 = l01Bank.questions[0];
    const q2 = l01Bank.questions[1];

    const now = new Date("2026-06-15T12:00:00.000Z");

    // Seed only 5 sessions (< 10 completion minimum, < 20 drop-off minimum) and 10 answers (< 20 per-question minimum, < 50 time minimum)
    const smallSessionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await db.quizSession.create({
        data: {
          userId: u1.id,
          skillId: rustSkill.id,
          bankVersion: l01Bank.version,
          bandStart: "L0-1",
          bandSettled: "L0-1",
          startedAt: new Date(now.getTime() - (i + 1) * 3600_000),
          endedAt: new Date(now.getTime() - i * 3600_000),
          outcome: "completed",
          questionsAsked: 6,
          correctCount: 4,
        },
      });
      smallSessionIds.push(s.id);
      await db.quizAnswer.createMany({
        data: [
          {
            sessionId: s.id,
            questionId: q1.id,
            band: "L0-1",
            correct: true,
            ms: 4000,
            position: 1,
          },
          {
            sessionId: s.id,
            questionId: q2.id,
            band: "L0-1",
            correct: true,
            ms: 5000,
            position: 2,
          },
        ],
      });
    }

    const belowN = await getAdminQuizTelemetry(admin, {
      userIds: [u1.id],
      skillIds: [rustSkill.id],
      now,
    });

    expect(belowN.completionRate.sufficientSample).toBe(false);
    expect(belowN.completionRate.rows).toEqual([]);
    expect(belowN.completionRate.statusNote).toMatch(/Not enough data/i);

    expect(belowN.dropOffIndex.sufficientSample).toBe(false);
    expect(belowN.dropOffIndex.rows).toEqual([]);
    expect(belowN.dropOffIndex.statusNote).toMatch(/Not enough data/i);

    expect(belowN.perQuestionSuccess.sufficientSample).toBe(false);
    expect(belowN.perQuestionSuccess.rows).toEqual([]);
    expect(belowN.perQuestionSuccess.statusNote).toMatch(/Not enough data/i);

    expect(belowN.retakeFrequency.sufficientSample).toBe(false);
    expect(belowN.retakeFrequency.data).toBeNull();
    expect(belowN.retakeFrequency.statusNote).toMatch(/Not enough data/i);

    expect(belowN.timePerQuestion.sufficientSample).toBe(false);
    expect(belowN.timePerQuestion.overallAvgMs).toBeNull();
    expect(belowN.timePerQuestion.statusNote).toMatch(/Not enough data/i);

    // Now add 15 more sessions (total = 20 sessions: 15 completed, 5 abandoned at question 4)
    // and 40 more answers (so q1 has 20 answers, q2 has 30 answers, total answers = 50 >= 50 time minimum)
    for (let i = 5; i < 20; i++) {
      const isAbandoned = i >= 15;
      const s = await db.quizSession.create({
        data: {
          userId: u1.id,
          skillId: rustSkill.id,
          bankVersion: l01Bank.version,
          bandStart: "L0-1",
          bandSettled: isAbandoned ? null : "L0-1",
          startedAt: new Date(now.getTime() - (i + 1) * 3600_000),
          endedAt: new Date(now.getTime() - i * 3600_000),
          outcome: isAbandoned ? "abandoned" : "completed",
          questionsAsked: isAbandoned ? 4 : 6,
          correctCount: isAbandoned ? 1 : 4,
        },
      });
      smallSessionIds.push(s.id);

      await db.quizAnswer.createMany({
        data: [
          {
            sessionId: s.id,
            questionId: q1.id,
            band: "L0-1",
            correct: true,
            ms: 4000,
            position: 1,
          },
          {
            sessionId: s.id,
            questionId: q2.id,
            band: "L0-1",
            correct: true,
            ms: 6000,
            position: 2,
          },
          ...(i < 15
            ? [
                {
                  sessionId: s.id,
                  questionId: q2.id,
                  band: "L0-1",
                  correct: false,
                  ms: 5000,
                  position: 3,
                },
              ]
            : []),
        ],
      });
    }

    const aboveN = await getAdminQuizTelemetry(admin, {
      userIds: [u1.id],
      skillIds: [rustSkill.id],
      now,
    });

    expect(aboveN.completionRate.sufficientSample).toBe(true);
    expect(aboveN.completionRate.rows).toHaveLength(1);
    expect(aboveN.completionRate.rows[0].totalSessions).toBe(20);
    expect(aboveN.completionRate.rows[0].completedSessions).toBe(15);
    expect(aboveN.completionRate.rows[0].completionRate).toBe(0.75);

    expect(aboveN.dropOffIndex.sufficientSample).toBe(true);
    expect(aboveN.dropOffIndex.rows).toEqual([
      { questionIndex: 4, droppedSessions: 5, shareOfAbandons: 1 },
    ]);

    expect(aboveN.perQuestionSuccess.sufficientSample).toBe(true);
    expect(aboveN.perQuestionSuccess.rows).toHaveLength(2);

    expect(aboveN.retakeFrequency.sufficientSample).toBe(true);
    expect(aboveN.retakeFrequency.data?.totalCompletedSessions).toBe(15);
    expect(aboveN.retakeFrequency.data?.retakeSessions).toBe(14);

    expect(aboveN.timePerQuestion.sufficientSample).toBe(true);
    expect(aboveN.timePerQuestion.overallAvgMs).toBeGreaterThan(0);

    // Aggregate-only check: serialized telemetry JSON never contains user ID or email
    const serialized = JSON.stringify(aboveN);
    expect(serialized).not.toContain(u1.id);
    expect(serialized).not.toContain(u1.email!);
  });

  it("enforces broken-question alert boundary: 19 answers at 0% does not flag, 20 answers at 15% (<20%) auto-flags into spot-review queue", async () => {
    const u1 = await makeUser("alert-boundary");
    const rustSkill = await db.skill.findUniqueOrThrow({
      where: { name: "rust" },
    });

    const banks = await ensureQuizBanksForSkill(
      rustSkill.id,
      admin.id,
      makeBankStubFetch()
    );
    const l23Bank = banks.find((b) => b.band === "L2-3")!;
    const brokenQ = l23Bank.questions[5];

    const s = await db.quizSession.create({
      data: {
        userId: u1.id,
        skillId: rustSkill.id,
        bankVersion: l23Bank.version,
        bandStart: "L2-3",
        bandSettled: "L0-1",
        outcome: "completed",
        questionsAsked: 19,
        correctCount: 3,
      },
    });

    // 19 answers (3 correct, 16 wrong = 15.8% < 20%, but only 19 answers < 20 minimum) -> NO alert
    await db.quizAnswer.createMany({
      data: Array.from({ length: 19 }, (_, idx) => ({
        sessionId: s.id,
        questionId: brokenQ.id,
        band: "L2-3",
        correct: idx < 3,
        ms: 3500,
        position: idx + 1,
      })),
    });

    const at19 = await getAdminQuizTelemetry(admin, {
      userIds: [u1.id],
      skillIds: [rustSkill.id],
    });
    expect(at19.brokenQuestionAlerts).toHaveLength(0);

    const qAfter19 = await db.quizQuestion.findUniqueOrThrow({
      where: { id: brokenQ.id },
    });
    expect(qAfter19.tags).not.toContain("alert:broken");

    // Add 20th answer (wrong -> 3/20 = 15% < 20% at 20 answers) -> AUTO-FLAGS into spot-review queue!
    await db.quizAnswer.create({
      data: {
        sessionId: s.id,
        questionId: brokenQ.id,
        band: "L2-3",
        correct: false,
        ms: 3500,
        position: 20,
      },
    });

    const at20 = await getAdminQuizTelemetry(admin, {
      userIds: [u1.id],
      skillIds: [rustSkill.id],
    });
    expect(at20.brokenQuestionAlerts).toHaveLength(1);
    expect(at20.brokenQuestionAlerts[0].questionId).toBe(brokenQ.id);
    expect(at20.brokenQuestionAlerts[0].answerCount).toBe(20);
    expect(at20.brokenQuestionAlerts[0].successRate).toBe(0.15);

    const qAfter20 = await db.quizQuestion.findUniqueOrThrow({
      where: { id: brokenQ.id },
    });
    expect(qAfter20.tags).toContain("alert:broken");

    // Verify bank appears in spotReviewQueue with brokenQuestionAlerts
    const flaggedBankInQueue = at20.spotReviewQueue.find(
      (item) => item.bankId === l23Bank.id
    );
    expect(flaggedBankInQueue).toBeDefined();
    expect(
      flaggedBankInQueue?.flaggedQuestions.some(
        (a) => a.questionId === brokenQ.id
      )
    ).toBe(true);
  });

  it("fills evidenceVsQuizDivergence only when >= 3 users hold both evidenced level and completed quiz settled band", async () => {
    const u1 = await makeUser("div1");
    const u2 = await makeUser("div2");
    const u3 = await makeUser("div3");
    const rustSkill = await db.skill.findUniqueOrThrow({
      where: { name: "rust" },
    });

    // Seed 2 users with both UserSkill and completed QuizSession (< 3 minimum)
    for (const u of [u1, u2]) {
      await db.userSkill.create({
        data: {
          userId: u.id,
          skillId: rustSkill.id,
          level: 3,
          score: 35,
        },
      });
      await db.quizSession.create({
        data: {
          userId: u.id,
          skillId: rustSkill.id,
          bankVersion: 1,
          bandStart: "L2-3",
          bandSettled: "L0-1",
          outcome: "completed",
          endedAt: new Date(),
          questionsAsked: 6,
          correctCount: 1,
        },
      });
    }

    const with2Users = await getAdminEvidenceReadouts(admin, {
      userIds: [u1.id, u2.id, u3.id],
    });
    expect(with2Users.evidenceVsQuizDivergence.sufficientSample).toBe(false);
    expect(with2Users.evidenceVsQuizDivergence.rows).toEqual([]);

    // Add 3rd user holding both -> skill now appears in divergence readout!
    await db.userSkill.create({
      data: {
        userId: u3.id,
        skillId: rustSkill.id,
        level: 3,
        score: 40,
      },
    });
    await db.quizSession.create({
      data: {
        userId: u3.id,
        skillId: rustSkill.id,
        bankVersion: 1,
        bandStart: "L2-3",
        bandSettled: "L0-1",
        outcome: "completed",
        endedAt: new Date(),
        questionsAsked: 6,
        correctCount: 2,
      },
    });

    const with3Users = await getAdminEvidenceReadouts(admin, {
      userIds: [u1.id, u2.id, u3.id],
    });
    expect(with3Users.evidenceVsQuizDivergence.sufficientSample).toBe(true);
    expect(with3Users.evidenceVsQuizDivergence.rows).toHaveLength(1);
    const row = with3Users.evidenceVsQuizDivergence.rows[0];
    expect(row.skillId).toBe(rustSkill.id);
    expect(row.userCount).toBe(3);
    expect(row.evidencedLevel).toBe(3);
    expect(row.quizLevel).toBe(0.5);
    expect(row.settledBands["L0-1"]).toBe(3);
  });
});
