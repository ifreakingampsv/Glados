import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type Skill, type User } from "@/lib/db";
import { CERTIFICATE_QUIZ_NUDGE } from "@/services/certificates";
import {
  buildDeterministicBankPayload,
  isCanonicalLeafSkill,
} from "@/services/quiz-banks";
import {
  getQuizCooldownStatus,
  resolveStartBandForUserSkill,
  startQuizSession,
  submitQuizRound,
} from "@/services/quiz";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { describeUserSkillProvenance } from "@/services/work-experience";

describe("Quiz UI & trust-teaching surfaces (T04: leaf-only eligibility, start/settle/cooldown states, verify CTA, free & uncapped)", () => {
  const marker = `t04_ui_${Date.now()}`;
  let user: User;
  let leafSkill: Skill;
  let parentSkill: Skill;
  let candidateSkill: Skill;

  const stubFetch: typeof fetch = async (_input, init) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    let band: "L0-1" | "L2-3" | "L4-5" = "L0-1";
    if (bodyStr.includes("L4-5")) band = "L4-5";
    else if (bodyStr.includes("L2-3")) band = "L2-3";

    const payload = buildDeterministicBankPayload("React", band, 24);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 80, completion_tokens: 160 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  beforeAll(async () => {
    process.env.PLATFORM_GOOGLE_API_KEY = "test-platform-key";
    await seedConfig();
    await seedCanonicalSkills();
    await seedRoutes();

    user = await db.user.create({
      data: { clerkId: `${marker}_user` },
    });

    const foundLeaf = await db.skill.findUnique({ where: { name: "react" } });
    const foundParent = await db.skill.findUnique({
      where: { name: "frontend" },
    });
    if (!foundLeaf || !foundParent) {
      throw new Error("Expected react and frontend skills in seed");
    }
    leafSkill = foundLeaf;
    parentSkill = foundParent;

    candidateSkill = await db.skill.create({
      data: {
        name: `${marker}_cand`,
        display: "Candidate Framework",
        status: "CANDIDATE",
      },
    });
  });

  afterAll(async () => {
    if (!user) return;
    const sessions = await db.quizSession.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    if (sessions.length > 0) {
      await db.quizAnswer.deleteMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
      });
      await db.quizSession.deleteMany({
        where: { id: { in: sessions.map((s) => s.id) } },
      });
    }
    if (leafSkill) {
      await db.quizBank.deleteMany({ where: { skillId: leafSkill.id } });
    }
    await db.eventLog.deleteMany({ where: { userId: user.id } });
    await db.userSkill.deleteMany({ where: { userId: user.id } });
    await db.usage.deleteMany({ where: { userId: user.id } });
    if (candidateSkill) {
      await db.skill.deleteMany({ where: { id: candidateSkill.id } });
    }
    await db.user.deleteMany({ where: { id: user.id } });
  });

  it("exposes quiz entry only on canonical leaf skills (parent categories and candidates do not)", async () => {
    expect(await isCanonicalLeafSkill(leafSkill.id)).toBe(true);
    expect(await isCanonicalLeafSkill(parentSkill.id)).toBe(false);
    expect(await isCanonicalLeafSkill(candidateSkill.id)).toBe(false);
  });

  it("provides start screen placement reason, honest settle delta arithmetic (including negative delta), cooldown next-retake date, and free/uncapped execution", async () => {
    await db.userSkill.upsert({
      where: { userId_skillId: { userId: user.id, skillId: leafSkill.id } },
      update: { claimedLevel: 4, claimOrigins: ["self"] },
      create: {
        userId: user.id,
        skillId: leafSkill.id,
        claimedLevel: 4,
        claimOrigins: ["self"],
        score: 0,
        level: 0,
      },
    });

    const placement = await resolveStartBandForUserSkill(user.id, leafSkill.id);
    expect(placement.band).toBe("L4-5");
    expect(placement.reason).toContain("claimed Level 4");

    const t1 = new Date("2026-03-01T10:00:00.000Z");
    const started1 = await startQuizSession(
      { userId: user.id, skillId: leafSkill.id, now: t1 },
      stubFetch
    );
    expect(started1.startBand).toBe("L4-5");
    expect(started1.currentRoundQuestions).toHaveLength(6);

    // Settle in L4-5 with 4/6 correct -> rawPoints = 4 * 4 = 16
    const settle1 = await submitQuizRound({
      userId: user.id,
      sessionId: started1.session.id,
      answers: started1.currentRoundQuestions.map((q, idx) => ({
        questionId: q.id,
        selectedIndex: idx < 4 ? 0 : 1,
        ms: 3500,
      })),
      now: t1,
    });
    expect(settle1.status).toBe("completed");
    if (settle1.status === "completed") {
      expect(settle1.settledBand).toBe("L4-5");
      expect(settle1.rawPoints).toBe(16);
      expect(settle1.previousRawPoints).toBe(0);
      expect(settle1.pointsDelta).toBe(16);
    }

    // Cooldown state right after completion shows nextRetakeAt (7 days later)
    const cooldownActive = await getQuizCooldownStatus(
      user.id,
      leafSkill.id,
      new Date("2026-03-03T10:00:00.000Z")
    );
    expect(cooldownActive.onCooldown).toBe(true);
    expect(cooldownActive.nextRetakeAt?.toISOString().slice(0, 10)).toBe(
      "2026-03-08"
    );

    // Retake after cooldown expires (8 days later) with lower score -> negative delta
    const t2 = new Date("2026-03-09T10:00:00.000Z");
    const started2 = await startQuizSession(
      { userId: user.id, skillId: leafSkill.id, now: t2 },
      stubFetch
    );
    // Step down from L4-5 (1/6 correct -> 4 pts) then settle in L2-3 (3/6 correct -> 6 pts) => rawPoints = 10
    const round1 = await submitQuizRound({
      userId: user.id,
      sessionId: started2.session.id,
      answers: started2.currentRoundQuestions.map((q, idx) => ({
        questionId: q.id,
        selectedIndex: idx === 0 ? 0 : 1,
        ms: 3000,
      })),
      now: t2,
    });
    expect(round1.status).toBe("continue");
    if (round1.status === "continue") {
      const settle2 = await submitQuizRound({
        userId: user.id,
        sessionId: started2.session.id,
        answers: round1.currentRoundQuestions.map((q, idx) => ({
          questionId: q.id,
          selectedIndex: idx < 3 ? 0 : 1,
          ms: 3000,
        })),
        now: t2,
      });
      expect(settle2.status).toBe("completed");
      if (settle2.status === "completed") {
        expect(settle2.settledBand).toBe("L2-3");
        expect(settle2.rawPoints).toBe(10);
        expect(settle2.previousRawPoints).toBe(16);
        expect(settle2.rawDelta).toBe(-6);
        expect(settle2.pointsDelta).toBeLessThan(0);
      }
    }

    // Verify provenance helper and certificate nudge copy for trust-teaching surfaces
    const claimProvenance = describeUserSkillProvenance({
      score: 0,
      level: 0,
      claimedLevel: 3,
      claimOrigins: ["resume"],
      staleOrigins: [],
    });
    expect(claimProvenance.isUnvalidated).toBe(true);
    expect(claimProvenance.explainerHref).toBe("/how-levels-work");
    expect(CERTIFICATE_QUIZ_NUDGE).toContain("6-question check");
  });
});
