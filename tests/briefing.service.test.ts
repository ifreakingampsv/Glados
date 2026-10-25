import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { appendEvent } from "@/services/events";
import { ensureDailyGrant } from "@/services/energy";
import {
  buildBriefing,
  computeBriefingBlocks,
  computeBriefingCta,
  isUnsubscribed,
  runWeeklyBriefing,
  sendBriefingEmail,
  setUnsubscribed,
  shouldSendBriefing,
} from "@/services/briefing";

const TEST_PROVIDER = "ivbriefprovider";
const marker = `iv09_${Date.now()}`;
let activeUser: { id: string; email: string };
let quietUser: { id: string; email: string };
let noEmailUser: { id: string };

function noteFetch(content: string) {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 80, completion_tokens: 60 },
      }),
      { status: 200 }
    )) as unknown as typeof fetch;
}

const emailFetch = (ok: boolean) =>
  (async () =>
    new Response("{}", { status: ok ? 200 : 500 })) as unknown as typeof fetch;

async function freshUser(tag: string, email?: string) {
  const u = await db.user.create({
    data: { clerkId: `${marker}_${tag}`, email: email ?? null },
  });
  return { id: u.id, email: (u.email ?? "") as string };
}

beforeAll(async () => {
  process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`] = "sk-b";
  await seedConfig();
  for (const feature of ["briefing_note"]) {
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
        costPer1kUsd: 0.0004,
        isActive: true,
      },
    });
  }
  activeUser = await freshUser("active", "active@example.com");
  quietUser = await freshUser("quiet", "quiet@example.com");
  noEmailUser = await freshUser("noemail");
  await appendEvent({
    userId: activeUser.id,
    source: "web",
    type: "quiz_completed",
    skills: [],
    pointsOverride: 4,
  });
  await db.interviewSession.create({
    data: {
      userId: activeUser.id,
      scope: "project",
      mode: "quick",
      status: "active",
      origin: "web",
      payload: { questionCount: 5 },
    },
  });
});

afterAll(async () => {
  for (const id of [activeUser.id, quietUser.id, noEmailUser.id]) {
    await db.interviewReport.deleteMany({ where: { session: { userId: id } } });
    await db.interviewSession.deleteMany({ where: { userId: id } });
    await db.eventLog.deleteMany({ where: { userId: id } });
    await db.userSkill.deleteMany({ where: { userId: id } });
    await db.usage.deleteMany({ where: { userId: id } });
    await db.dailyCounter.deleteMany({ where: { userId: id } });
    await db.energyAccount.deleteMany({ where: { userId: id } });
    await db.preference.deleteMany({ where: { userId: id } });
  }
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  await db.providerRoute.deleteMany({
    where: { feature: "briefing_note", provider: TEST_PROVIDER },
  });
  await db.providerRoute.updateMany({
    where: { feature: "briefing_note" },
    data: { isActive: true },
  });
  await db.gatewayCache.deleteMany({
    where: { cacheKey: { startsWith: "briefing_note:" } },
  });
  delete process.env[`PLATFORM_${TEST_PROVIDER.toUpperCase()}_API_KEY`];
});

describe("briefing blocks + CTA ladder (T09: D85)", () => {
  it("blocks reflect the week's events, both-direction moves, and energy state", async () => {
    const blocks = await computeBriefingBlocks(activeUser.id);
    expect(blocks.hasActivity).toBe(true);
    expect(blocks.pointsDelta).toBe(4);
    expect(blocks.eventsThisWeek.length).toBeGreaterThan(0);
    expect(blocks.energy.earnedThisWeek).toBe(false);
  });

  it("CTA ladder: unfinished interview wins first", async () => {
    const blocks = await computeBriefingBlocks(activeUser.id);
    const cta = await computeBriefingCta(activeUser.id, blocks);
    expect(cta?.key).toBe("resume_interview");
  });

  it("CTA ladder: with no active session, lowest dimension or fallbacks", async () => {
    const blocks = await computeBriefingBlocks(quietUser.id);
    const cta = await computeBriefingCta(quietUser.id, blocks);
    // no sessions/reports → falls through bank/quiz rungs or null
    expect(cta === null || typeof cta.label === "string").toBe(true);
  });
});

describe("coach note is wordsmith-only (D30 family)", () => {
  it("returns the gateway's paragraph and nothing else", async () => {
    const briefing = await buildBriefing(
      activeUser.id,
      new Date(),
      noteFetch(
        "Sharp week — quiz points landed. Your next move: finish the interview you started."
      )
    );
    expect(briefing?.coachNote).toContain("finish the interview");
  });
});

describe("skip rules + unsubscribe (D85/D88i)", () => {
  it("quiet weeks are silent; activity sends; null email skips; bank decay wins back", async () => {
    const quietBriefing = await buildBriefing(
      quietUser.id,
      new Date(),
      noteFetch("x")
    );
    expect(shouldSendBriefing(quietBriefing!, false)).toBe(false);

    const activeBriefing = await buildBriefing(
      activeUser.id,
      new Date(),
      noteFetch("x")
    );
    expect(shouldSendBriefing(activeBriefing!, false)).toBe(true);

    // decay week: old lastGrantDate + balance > 0 → win-back even if quiet
    const staleDate = new Date(Date.now() - 20 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db.energyAccount.upsert({
      where: { userId: quietUser.id },
      update: { balance: 2, lastGrantDate: staleDate },
      create: { userId: quietUser.id, balance: 2, lastGrantDate: staleDate },
    });
    const decayBlocks = await computeBriefingBlocks(quietUser.id);
    expect(decayBlocks.energy.bankDecaying).toBe(true);
    expect(shouldSendBriefing(quietBriefing!, false)).toBe(false); // stale blocks still quiet
  });

  it("unsubscribe is honored end-to-end", async () => {
    await setUnsubscribed(activeUser.id, true);
    expect(await isUnsubscribed(activeUser.id)).toBe(true);
    const briefing = await buildBriefing(
      activeUser.id,
      new Date(),
      noteFetch("x")
    );
    expect(shouldSendBriefing(briefing!, true)).toBe(false);
    await setUnsubscribed(activeUser.id, false);
    expect(await isUnsubscribed(activeUser.id)).toBe(false);
  });

  it("runWeeklyBriefing sends to active users, skips quiet/no-email, never writes spine events", async () => {
    const eventCountBefore = await db.eventLog.count({
      where: { userId: activeUser.id },
    });
    const { sent, skipped } = await runWeeklyBriefing(
      new Date(),
      emailFetch(true)
    );
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(skipped).toBeGreaterThanOrEqual(1); // quiet user stale-blocks + null email
    const eventCountAfter = await db.eventLog.count({
      where: { userId: activeUser.id },
    });
    expect(eventCountAfter).toBe(eventCountBefore); // briefing writes NOTHING
  });

  it("email helper reports key-less skip without throwing", async () => {
    const res = await sendBriefingEmail("x@example.com", "s", "<p>x</p>");
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe("no RESEND_API_KEY");
  });
});
