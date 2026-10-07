import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, type User } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { runSmokeProbe } from "@/services/probe";
import { gatewayCall } from "@/services/gateway";

const marker = `t13_${Date.now()}`;
let admin: User;
let user: User;

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: "pong" } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  await seedConfig();
  process.env.PLATFORM_TESTPROVIDER_API_KEY = "sk-platform-test";
  [admin, user] = await Promise.all([
    db.user.create({ data: { clerkId: `${marker}_admin`, role: "ADMIN" } }),
    db.user.create({ data: { clerkId: `${marker}_user` } }),
  ]);
  await db.providerRoute.create({
    data: {
      feature: "smoke",
      provider: "testprovider",
      model: "test-model",
      endpoint: "https://api.test/v1/chat/completions",
      costPer1kUsd: 0.02,
    },
  });
  await db.featureFlag.create({ data: { key: "smoke", enabled: true } });
});

afterAll(async () => {
  await db.usage.deleteMany({ where: { feature: "smoke" } });
  await db.dailyCounter.deleteMany({});
  await db.energyAccount.deleteMany({});
  await db.budgetAlert.deleteMany({});
  await db.config.deleteMany({ where: { key: "budget.alertUsd" } });
  await db.providerRoute.deleteMany({ where: { feature: "smoke" } });
  await db.featureFlag.deleteMany({ where: { key: "smoke" } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  delete process.env.PLATFORM_TESTPROVIDER_API_KEY;
  vi.unstubAllGlobals();
});

describe("smoke probe (T13: gateway's first caller, admin-only)", () => {
  it("exercises resolver → adapter → metering end-to-end", async () => {
    stubFetch();
    const { result, usage } = await runSmokeProbe(admin);
    expect(result.status).toBe("ok");
    expect(usage?.feature).toBe("smoke");
    expect(usage?.provider).toBe("testprovider");
    expect(usage?.costUsd).toBeGreaterThan(0);
  });

  it("refuses non-admins", async () => {
    await expect(runSmokeProbe(user)).rejects.toThrow("admin role required");
  });
});

describe("budget alert (T13: D5 tripwire)", () => {
  it("fires when monthly platform spend crosses the configured threshold", async () => {
    stubFetch();
    await db.config.upsert({
      where: { key: "budget.alertUsd" },
      update: { value: 0.0001 },
      create: { key: "budget.alertUsd", value: 0.0001 },
    });

    await gatewayCall({ userId: admin.id, feature: "smoke", messages: [] });

    const month = new Date().toISOString().slice(0, 7);
    const alert = await db.budgetAlert.findUnique({ where: { month } });
    expect(alert).not.toBeNull();
    expect(alert!.amountUsd).toBeGreaterThan(0);
  });
});
