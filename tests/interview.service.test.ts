import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { addCredential } from "@/services/credentials";
import { handleClerkEvent } from "@/services/users";
import { getOrCreateEnergyAccount } from "@/services/energy";
import {
  buildVisibleSurfacePack,
  InsufficientEnergyError,
  lintInterviewBank,
  packContentVersion,
  startInterviewSession,
} from "@/services/interview";

// Route override: interview_turn runs on a test provider with a fake platform
// key so the platform path never needs real credentials (gateway test pattern).
const TEST_PROVIDER = "ivtestprovider";
const marker = `iv02_${Date.now()}`;
let platformUser: { id: string };
let byoUser: { id: string };
let otherUser: { id: string };
let projectId: string;
let byoProjectId: string;

function bankJson(count: number): string {
  const cats = ["architecture", "tradeoff", "failure", "scale"];
  return JSON.stringify({
    questions: Array.from({ length: count }, (_, i) => ({
      text: `Question ${i + 1}: defend the ${cats[i % 4]} of this project`,
      category: cats[i % 4],
      skillFocus: ["postgres"],
    })),
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
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  return { impl, state };
}

async function freshUser(tag: string) {
  const u = await db.user.create({ data: { clerkId: `${marker}_${tag}` } });
  return { id: u.id };
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] =
    "sk-platform-test";
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

  [platformUser, byoUser, otherUser] = [
    await freshUser("platform"),
    await freshUser("byo"),
    await freshUser("other"),
  ];
  await addCredential(byoUser.id, TEST_PROVIDER, "sk-byo-test");

  const project = await db.project.create({
    data: {
      userId: platformUser.id,
      title: "Booking app",
      description: "Next.js + Postgres booking platform",
      skills: ["nextjs", "postgresql"],
      links: ["https://github.com/example/booking"],
    },
  });
  projectId = project.id;
  byoProjectId = (
    await db.project.create({
      data: {
        userId: byoUser.id,
        title: "Portfolio site",
        description: "Personal site",
        skills: ["typescript"],
        links: [],
      },
    })
  ).id;
});

afterAll(async () => {
  await db.interviewReport.deleteMany({
    where: {
      session: { userId: { in: [platformUser.id, byoUser.id, otherUser.id] } },
    },
  });
  await db.interviewSession.deleteMany({
    where: { userId: { in: [platformUser.id, byoUser.id, otherUser.id] } },
  });
  await db.gatewayCache.deleteMany({
    where: { cacheKey: { startsWith: "interview_bank:" } },
  });
  await db.credential.deleteMany({
    where: { userId: { in: [platformUser.id, byoUser.id, otherUser.id] } },
  });
  await db.usage.deleteMany({
    where: { userId: { in: [platformUser.id, byoUser.id, otherUser.id] } },
  });
  await db.dailyCounter.deleteMany({
    where: { userId: { in: [platformUser.id, byoUser.id, otherUser.id] } },
  });
  await db.energyAccount.deleteMany({
    where: { userId: { in: [platformUser.id, byoUser.id, otherUser.id] } },
  });
  await db.project.deleteMany({
    where: { userId: { in: [platformUser.id, byoUser.id] } },
  });
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

describe("interview session core (T02: D79/D80/D84)", () => {
  it("charges one flat bar for a platform-keyed session and blocks at zero balance", async () => {
    const fetch1 = makeFetch(bankJson(5));
    const first = await startInterviewSession(platformUser.id, {
      projectId,
      mode: "quick",
      fetchImpl: fetch1.impl,
    });
    expect(first.bankSize).toBe(5);
    expect(first.firstQuestion).toContain("Question 1");
    const account = await getOrCreateEnergyAccount(platformUser.id);
    expect(account.balance).toBe(0); // daily grant 1 − session bar 1

    const session = await db.interviewSession.findFirst({
      where: { id: first.sessionId },
      include: { turns: true },
    });
    expect(session?.status).toBe("active");
    expect(session?.origin).toBe("web");
    expect(session?.turns).toHaveLength(1);
    expect(session?.turns[0]?.idx).toBe(0);

    await expect(
      startInterviewSession(platformUser.id, {
        projectId,
        mode: "quick",
        fetchImpl: fetch1.impl,
      })
    ).rejects.toBeInstanceOf(InsufficientEnergyError);
  });

  it("BYO sessions cost no bar and the bank is generated once then cached", async () => {
    const fetcher = makeFetch(bankJson(5));
    const a = await startInterviewSession(byoUser.id, {
      projectId: byoProjectId,
      mode: "quick",
      fetchImpl: fetcher.impl,
    });
    expect(fetcher.state.calls).toBe(1);
    const b = await startInterviewSession(byoUser.id, {
      projectId: byoProjectId,
      mode: "quick",
      fetchImpl: fetcher.impl,
    });
    expect(fetcher.state.calls).toBe(1); // D4 cache hit — no second generation
    const account = await getOrCreateEnergyAccount(byoUser.id);
    expect(account.balance).toBe(0); // never granted, never deducted
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("rejects another user's project", async () => {
    await expect(
      startInterviewSession(otherUser.id, {
        projectId,
        mode: "quick",
        fetchImpl: makeFetch(bankJson(5)).impl,
      })
    ).rejects.toThrow("project not found");
  });

  it("welcome bar is granted exactly once on user.created (D84)", async () => {
    const event = {
      type: "user.created",
      data: {
        id: `${marker}_welcome`,
        email_addresses: [{ id: "e1", email_address: "welcome@example.com" }],
        primary_email_address_id: "e1",
      },
    };
    await handleClerkEvent(event);
    await handleClerkEvent(event); // webhook retry must not double-grant
    const user = await db.user.findUnique({
      where: { clerkId: `${marker}_welcome` },
    });
    const account = await getOrCreateEnergyAccount(user!.id);
    expect(account.balance).toBe(1);
    expect(account.welcomeBarGrantedAt).not.toBeNull();
  });

  it("visible-surface pack carries ONLY project claims (D79)", () => {
    const project = {
      id: "p1",
      userId: platformUser.id,
      title: "Booking app",
      description: "desc",
      links: ["https://github.com/x"],
      skills: ["nextjs"],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const pack = buildVisibleSurfacePack(project as never);
    expect(Object.keys(pack)).toEqual(["scope", "project"]);
    expect(Object.keys(pack.project!).sort()).toEqual(
      ["description", "id", "links", "skills", "title"].sort()
    );
    // content version is stable for identical content
    expect(packContentVersion(pack)).toBe(packContentVersion(pack));
  });

  it("bank lint rejects short or malformed banks", () => {
    const short = lintInterviewBank(
      { questions: [{ text: "q", category: "tradeoff" }] },
      5
    );
    expect(short.ok).toBe(false);
    const bad = lintInterviewBank(
      { questions: [{ text: "q", category: "nonsense" }] },
      1
    );
    expect(bad.ok).toBe(false);
    const garbage = lintInterviewBank("nope", 1);
    expect(garbage.ok).toBe(false);
  });

  it("malformed gateway output throws after the retry", async () => {
    const fetcher = makeFetch(() => "not json at all");
    await expect(
      startInterviewSession(byoUser.id, {
        projectId: byoProjectId,
        mode: "deep",
        fetchImpl: fetcher.impl,
      })
    ).rejects.toThrow("lint");
    expect(fetcher.state.calls).toBe(2); // one retry per the attempt loop
  });
});
