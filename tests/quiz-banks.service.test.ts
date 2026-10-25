import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { addCredential } from "@/services/credentials";
import {
  adminGenerateQuizBanksNow,
  approveQuizBankReview,
  buildDeterministicBankPayload,
  ensureQuizBanksForSkill,
  getLiveQuizBanksForSkill,
  lintQuestionBank,
  listAdminBankSpotReviewQueue,
  QUESTIONS_PER_BANK,
  QUIZ_BANDS,
  retireAndReplaceQuizBank,
  setQuizStrictReviewGating,
  STRICT_REVIEW_GATING_FLAG,
} from "@/services/quiz-banks";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";

describe("S1.5 T02: Quiz banks — lazy generation, lint gate, platform-only routing, and admin spot-review queue", () => {
  let user: User;
  let admin: User;
  const marker = `s15_t02_${Date.now()}`;
  const createdSkillIds: string[] = [];

  beforeAll(async () => {
    process.env.PLATFORM_GOOGLE_API_KEY = "test-platform-google-key";
    process.env.CREDENTIALS_KEK =
      process.env.CREDENTIALS_KEK ||
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    await seedCanonicalSkills();
    await seedConfig();
    await seedRoutes();

    [user, admin] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_user`, role: "USER" } }),
      db.user.create({ data: { clerkId: `${marker}_admin`, role: "ADMIN" } }),
    ]);
  });

  afterAll(async () => {
    await db.featureFlag.deleteMany({
      where: { key: STRICT_REVIEW_GATING_FLAG },
    });
    await db.quizSession.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    if (createdSkillIds.length > 0) {
      await db.quizBank.deleteMany({
        where: { skillId: { in: createdSkillIds } },
      });
      await db.skill.deleteMany({
        where: { id: { in: createdSkillIds } },
      });
    }
    await db.credential.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.usage.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.dailyCounter.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.energyAccount.deleteMany({
      where: { userId: { in: [user.id, admin.id] } },
    });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("lazily generates all 3 bands (~24 questions each) grounded in skill definition, caches via D4, and routes PLATFORM-only even when user has BYO key", async () => {
    const skill = await db.skill.create({
      data: {
        name: `elixir_${marker}`,
        display: "Elixir",
        status: "ACTIVE",
      },
    });
    createdSkillIds.push(skill.id);

    // Give the user a BYO Google key to prove bank_gen NEVER uses the user's BYO key (D78f)
    await addCredential(user.id, "google", "sk-user-byo-should-not-be-used");

    const authHeadersSeen: string[] = [];
    let bankGenCalls = 0;
    let defGenCalls = 0;

    const stubFetch: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      authHeadersSeen.push(headers.get("authorization") ?? "");
      const bodyStr = typeof init?.body === "string" ? init.body : "{}";
      const parsedBody = JSON.parse(bodyStr) as {
        messages?: Array<{ content?: string }>;
      };
      const userMsg = parsedBody.messages?.[1]?.content ?? "";

      if (userMsg.startsWith("Define the skill:")) {
        defGenCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Elixir is a functional, concurrent language built on the Erlang VM (BEAM) for fault-tolerant distributed systems.",
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 25 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      bankGenCalls += 1;
      const reqPayload = JSON.parse(userMsg) as {
        skill: string;
        definition: string;
        band: "L0-1" | "L2-3" | "L4-5";
      };
      // Assert generation is grounded in the skill's definition field
      expect(reqPayload.definition).toContain("Erlang VM (BEAM)");

      const payload = buildDeterministicBankPayload(
        reqPayload.skill,
        reqPayload.band,
        QUESTIONS_PER_BANK
      );
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 100, completion_tokens: 400 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    // First take request triggers definition generation + all 3 band generations
    const banks = await ensureQuizBanksForSkill(skill.id, user.id, stubFetch);
    expect(defGenCalls).toBe(1);
    expect(bankGenCalls).toBe(3);
    expect(banks).toHaveLength(3);

    for (const band of QUIZ_BANDS) {
      const b = banks.find((item) => item.band === band);
      expect(b).toBeDefined();
      expect(b!.version).toBe(1);
      expect(b!.status).toBe("live");
      expect(b!.questions).toHaveLength(QUESTIONS_PER_BANK);
      expect(b!.questions[0].tags.length).toBeGreaterThan(0);
    }

    // Verify platform-only routing: every call used the platform key, NEVER the user's BYO key
    for (const auth of authHeadersSeen) {
      expect(auth).toBe("Bearer test-platform-google-key");
    }
    const byoUsages = await db.usage.count({
      where: { userId: user.id, via: "byo" },
    });
    expect(byoUsages).toBe(0);

    // Second request is served from cached banks with ZERO additional gateway calls
    const secondCallBanks = await ensureQuizBanksForSkill(
      skill.id,
      user.id,
      stubFetch
    );
    expect(secondCallBanks).toHaveLength(3);
    expect(bankGenCalls).toBe(3);

    // Even if QuizBank rows are deleted, D4 GatewayCache serves the same version without hitting fetch
    await db.quizBank.deleteMany({ where: { skillId: skill.id } });
    const d4Restored = await ensureQuizBanksForSkill(
      skill.id,
      user.id,
      stubFetch
    );
    expect(d4Restored).toHaveLength(3);
    expect(bankGenCalls).toBe(3);
  });

  it("enforces deterministic lint (duplicates, zero/multiple correct options, missing tags): regenerates once on failure, and lands unlive in admin queue if second attempt also fails", async () => {
    // 1. Direct unit check on lintQuestionBank rules
    const dupResult = lintQuestionBank([
      ...buildDeterministicBankPayload("Rust", "L0-1", 6).questions,
      {
        prompt:
          "[Rust L0-1 Q1] Which statement accurately describes Rust fundamentals concept #1?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        tags: ["band:L0-1"],
      },
    ]);
    expect(dupResult.ok).toBe(false);
    expect(dupResult.errors.some((e) => e.includes("duplicate_prompt"))).toBe(
      true
    );

    const multiCorrectResult = lintQuestionBank(
      buildDeterministicBankPayload("Rust", "L0-1", 6).questions.map(
        (q, idx) => (idx === 0 ? { ...q, correctIndices: [0, 1] } : q)
      )
    );
    expect(multiCorrectResult.ok).toBe(false);
    expect(
      multiCorrectResult.errors.some((e) =>
        e.includes("invalid_correct_option_count")
      )
    ).toBe(true);

    const zeroCorrectResult = lintQuestionBank(
      buildDeterministicBankPayload("Rust", "L0-1", 6).questions.map(
        (q, idx) => (idx === 0 ? { ...q, correctIndex: 99 } : q)
      )
    );
    expect(zeroCorrectResult.ok).toBe(false);

    const missingTagsResult = lintQuestionBank(
      buildDeterministicBankPayload("Rust", "L0-1", 6).questions.map(
        (q, idx) => (idx === 0 ? { ...q, tags: [] } : q)
      )
    );
    expect(missingTagsResult.ok).toBe(false);
    expect(
      missingTagsResult.errors.some((e) => e.includes("missing_tags"))
    ).toBe(true);

    // 2. Service seam: attempt 1 fails lint for L0-1, attempt 2 passes -> goes live;
    // for L2-3, both attempt 1 and attempt 2 fail lint -> lands unlive ("needs_review") in admin queue
    const skill = await db.skill.create({
      data: {
        name: `haskell_${marker}`,
        display: "Haskell",
        definition: "Purely functional programming language with static types.",
        status: "ACTIVE",
      },
    });
    createdSkillIds.push(skill.id);

    const attemptsByBand: Record<string, number> = {};
    const lintFetch: typeof fetch = async (_url, init) => {
      const bodyStr = typeof init?.body === "string" ? init.body : "{}";
      const parsedBody = JSON.parse(bodyStr) as {
        messages?: Array<{ content?: string }>;
      };
      const req = JSON.parse(parsedBody.messages?.[1]?.content ?? "{}") as {
        skill: string;
        band: "L0-1" | "L2-3" | "L4-5";
        attempt: number;
      };
      attemptsByBand[req.band] = (attemptsByBand[req.band] ?? 0) + 1;

      if (req.band === "L0-1" && req.attempt === 1) {
        // Broken attempt 1 (missing tags)
        const broken = buildDeterministicBankPayload("Haskell", "L0-1", 6);
        broken.questions[0].tags = [];
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(broken) } }],
            usage: { prompt_tokens: 50, completion_tokens: 100 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (req.band === "L2-3") {
        // Both attempt 1 and attempt 2 fail lint (duplicate prompts)
        const broken = buildDeterministicBankPayload("Haskell", "L2-3", 6);
        broken.questions[1].prompt = broken.questions[0].prompt;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(broken) } }],
            usage: { prompt_tokens: 50, completion_tokens: 100 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      const valid = buildDeterministicBankPayload(
        "Haskell",
        req.band,
        QUESTIONS_PER_BANK
      );
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(valid) } }],
          usage: { prompt_tokens: 50, completion_tokens: 100 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const banks = await ensureQuizBanksForSkill(skill.id, user.id, lintFetch);
    expect(attemptsByBand["L0-1"]).toBe(2); // regenerated once and passed!
    expect(attemptsByBand["L2-3"]).toBe(2); // regenerated once and still failed!
    expect(attemptsByBand["L4-5"]).toBe(1); // passed on first try!

    const b01 = banks.find((b) => b.band === "L0-1")!;
    const b23 = banks.find((b) => b.band === "L2-3")!;
    const b45 = banks.find((b) => b.band === "L4-5")!;
    expect(b01.status).toBe("live");
    expect(b23.status).toBe("needs_review");
    expect(b45.status).toBe("live");

    // Live banks serve takes; unlive L2-3 bank is excluded from live map
    const liveMap = await getLiveQuizBanksForSkill(
      skill.id,
      user.id,
      lintFetch
    );
    expect(liveMap.has("L0-1")).toBe(true);
    expect(liveMap.has("L2-3")).toBe(false);
    expect(liveMap.has("L4-5")).toBe(true);

    // Admin spot-review queue lists both the unlive bank and the live banks
    const queue = await listAdminBankSpotReviewQueue(admin);
    const haskellQueue = queue.filter((q) => q.skillId === skill.id);
    expect(haskellQueue).toHaveLength(3);
    expect(haskellQueue[0].status).toBe("needs_review");
  });

  it("supports admin 'generate now', retire-and-replace versioning (keeping old session version references), and strict review-gating flag", async () => {
    const skill = await db.skill.create({
      data: {
        name: `ocaml_${marker}`,
        display: "OCaml",
        definition:
          "Industrial-strength functional language with Hindley-Milner type inference.",
        status: "ACTIVE",
      },
    });
    createdSkillIds.push(skill.id);

    const validFetch: typeof fetch = async (_url, init) => {
      const bodyStr = typeof init?.body === "string" ? init.body : "{}";
      const parsedBody = JSON.parse(bodyStr) as {
        messages?: Array<{ content?: string }>;
      };
      const req = JSON.parse(parsedBody.messages?.[1]?.content ?? "{}") as {
        skill: string;
        band: "L0-1" | "L2-3" | "L4-5";
        version: number;
      };
      const payload = buildDeterministicBankPayload(
        `${req.skill} v${req.version}`,
        req.band,
        QUESTIONS_PER_BANK
      );
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 50, completion_tokens: 100 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    // Non-admin rejected
    await expect(
      adminGenerateQuizBanksNow(user, skill.id, validFetch)
    ).rejects.toThrow(/admin/i);

    // Admin "generate now" creates v1 live banks
    const v1Banks = await adminGenerateQuizBanksNow(
      admin,
      skill.id,
      validFetch
    );
    expect(v1Banks).toHaveLength(3);
    const v1Band0 = v1Banks.find((b) => b.band === "L0-1")!;
    expect(v1Band0.version).toBe(1);
    expect(v1Band0.status).toBe("live");

    // Simulate an existing quiz session referencing bankVersion 1
    const oldSession = await db.quizSession.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        bankVersion: 1,
        bandStart: "L0-1",
        bandSettled: "L0-1",
        outcome: "completed",
        questionsAsked: 6,
        correctCount: 4,
      },
    });

    // Retire-and-replace publishes version 2 while retiring version 1
    const { retiredBank, replacementBank } = await retireAndReplaceQuizBank(
      admin,
      { bankId: v1Band0.id },
      validFetch
    );
    expect(retiredBank.status).toBe("retired");
    expect(retiredBank.version).toBe(1);
    expect(replacementBank.version).toBe(2);
    expect(replacementBank.status).toBe("live");

    // Old session keeps its bankVersion 1 reference
    const reloadedSession = await db.quizSession.findUniqueOrThrow({
      where: { id: oldSession.id },
    });
    expect(reloadedSession.bankVersion).toBe(1);

    // Flip publishing flag to strict review-gating -> new banks land as "needs_review" until approved
    await setQuizStrictReviewGating(admin, true);
    const { replacementBank: v3Bank } = await retireAndReplaceQuizBank(
      admin,
      { bankId: replacementBank.id },
      validFetch
    );
    expect(v3Bank.version).toBe(3);
    expect(v3Bank.status).toBe("needs_review");

    const approved = await approveQuizBankReview(admin, v3Bank.id);
    expect(approved.status).toBe("live");

    await setQuizStrictReviewGating(admin, false);
  });

  it("rejects parent categories and candidate skills from bank generation", async () => {
    const frontendParent = await db.skill.findUniqueOrThrow({
      where: { name: "frontend" },
    });
    const candidateSkill = await db.skill.create({
      data: {
        name: `cand_${marker}`,
        display: "CandidateTech",
        status: "CANDIDATE",
      },
    });
    createdSkillIds.push(candidateSkill.id);

    await expect(
      ensureQuizBanksForSkill(frontendParent.id, user.id)
    ).rejects.toThrow(/parent/i);

    await expect(
      ensureQuizBanksForSkill(candidateSkill.id, user.id)
    ).rejects.toThrow(/active canonical/i);
  });
});
