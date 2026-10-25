import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { appendEvent } from "@/services/events";
import { ensureDailyGrant } from "@/services/energy";
import { enforceAttractorCap, QuotaExceededError } from "@/services/quotas";

const marker = `t14_${Date.now()}`;
let user: User;

async function freshUser(tag: string): Promise<User> {
  return db.user.create({ data: { clerkId: `${marker}_${tag}` } });
}

beforeAll(async () => {
  await seedConfig();
  user = await freshUser("main");
});

afterAll(async () => {
  await db.eventLog.deleteMany({ where: { userId: { startsWith: "" } } });
  await db.usage.deleteMany({});
  await db.energyAccount.deleteMany({});
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("earned replenishment (T14: D36)", () => {
  it("a platform-verified evidence event in the trailing week earns +1 bar", async () => {
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "manual_evidence",
    });
    const account = await ensureDailyGrant(user.id);
    // daily grant (1) + earned bar (1)
    expect(account.balance).toBe(2);
    expect(account.lastEarnedAt).not.toBeNull();
  });

  it("no evidence in the trailing week → no earned bar", async () => {
    const other = await freshUser("noevidence");
    await db.eventLog.create({
      data: {
        userId: other.id,
        type: "manual_evidence",
        points: 3,
        source: "web",
        occurredAt: new Date(Date.now() - 10 * 86_400_000), // 10 days ago
      },
    });
    const account = await ensureDailyGrant(other.id);
    expect(account.balance).toBe(1); // daily grant only
    expect(account.lastEarnedAt).toBeNull();
  });

  it("bank cap 3 binds even with daily + earned", async () => {
    const other = await freshUser("capped");
    await appendEvent({
      userId: other.id,
      source: "web",
      type: "interview_completed",
    });
    await db.energyAccount.create({
      data: { userId: other.id, balance: 2.5 },
    });
    const account = await ensureDailyGrant(other.id);
    expect(account.balance).toBe(3); // 2.5 + 1 capped at 3
  });

  it("skill claims (0 points) do NOT earn bars", async () => {
    const other = await freshUser("claims");
    await appendEvent({
      userId: other.id,
      source: "web",
      type: "skill_tagged",
    });
    const account = await ensureDailyGrant(other.id);
    expect(account.balance).toBe(1);
    expect(account.lastEarnedAt).toBeNull();
  });
});

describe("attractor caps (T14: D28, consumed by S1)", () => {
  it("enforces the configured per-feature daily cap", async () => {
    const other = await freshUser("capped_scan");
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      await db.usage.create({
        data: {
          userId: other.id,
          feature: "jd_scan",
          provider: "google",
          model: "gemini-2.0-flash",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          via: "platform",
          createdAt: startOfUtcDay,
        },
      });
    }
    await expect(
      enforceAttractorCap(other.id, "jd_scan")
    ).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(
      enforceAttractorCap(other.id, "resume_scan")
    ).resolves.toBeUndefined();
  });

  it("non-attractor features are uncapped", async () => {
    const other = await freshUser("uncapped");
    await expect(
      enforceAttractorCap(other.id, "smoke")
    ).resolves.toBeUndefined();
  });
});
