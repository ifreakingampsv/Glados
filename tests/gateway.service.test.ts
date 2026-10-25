import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import { addCredential } from "@/services/credentials";
import {
  FeatureDisabledError,
  GatewayByoFailureError,
  gatewayCall,
} from "@/services/gateway";

const marker = `t12_${Date.now()}`;
const ENDPOINT = "https://api.test/v1/chat/completions";
const okResponse = {
  choices: [{ message: { content: "pong" } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
};

function stubFetch(overrides: Partial<Response> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(okResponse),
    ...overrides,
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  await seedConfig();
  process.env.PLATFORM_TESTPROVIDER_API_KEY = "sk-platform-test";
  // Hermetic routing: deactivate any seeded smoke routes so the testprovider
  // row below is the ONLY active route for this feature (findFirst is
  // otherwise order-dependent across parallel test files).
  await db.providerRoute.updateMany({
    where: { feature: "smoke" },
    data: { isActive: false },
  });
  await db.providerRoute.create({
    data: {
      feature: "smoke",
      provider: "testprovider",
      model: "test-model",
      endpoint: ENDPOINT,
      costPer1kUsd: 0.02,
    },
  });
  await db.featureFlag.create({ data: { key: "smoke", enabled: true } });
});

afterAll(async () => {
  await db.usage.deleteMany({ where: { feature: "smoke" } });
  await db.dailyCounter.deleteMany({
    where: { date: new Date().toISOString().slice(0, 10) },
  });
  await db.energyAccount.deleteMany({});
  await db.credential.deleteMany({ where: { provider: "testprovider" } });
  await db.providerRoute.deleteMany({ where: { feature: "smoke" } });
  await db.featureFlag.deleteMany({ where: { key: "smoke" } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  delete process.env.PLATFORM_TESTPROVIDER_API_KEY;
  vi.unstubAllGlobals();
});

describe("gateway (T12: routing, metering, energy, fallback)", () => {
  it("routes to the platform key, meters usage + counter + energy in one path", async () => {
    const fetchMock = stubFetch();
    const user = await db.user.create({
      data: { clerkId: `${marker}_platform` },
    });

    const result = await gatewayCall({
      userId: user.id,
      feature: "smoke",
      messages: [],
    });

    expect(result).toMatchObject({ status: "ok", via: "platform" });
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer sk-platform-test",
        }),
      })
    );
    const usage = await db.usage.findUnique({
      where: { id: (result as { usageId: string }).usageId },
    });
    expect(usage?.costUsd).toBeCloseTo(0.0006, 6); // 30 tokens @ $0.02/1k
    const counter = await db.dailyCounter.findUnique({
      where: {
        userId_date: {
          userId: user.id,
          date: new Date().toISOString().slice(0, 10),
        },
      },
    });
    expect(counter?.count).toBe(1);
    const energy = await db.energyAccount.findUnique({
      where: { userId: user.id },
    });
    expect(energy!.balance).toBeCloseTo(1 - 0.006, 5); // granted 1, spent 0.006 bars
  });

  it("caps the energy bank at 3 and skips an already-granted day", async () => {
    stubFetch();
    const user = await db.user.create({
      data: { clerkId: `${marker}_capped` },
    });
    const today = new Date().toISOString().slice(0, 10);
    await db.energyAccount.create({
      data: { userId: user.id, balance: 3, lastGrantDate: today },
    });

    await gatewayCall({ userId: user.id, feature: "smoke", messages: [] });
    const energy = await db.energyAccount.findUnique({
      where: { userId: user.id },
    });
    expect(energy!.balance).toBeCloseTo(3 - 0.006, 5); // no extra grant
  });

  it("BYO key auto-wins, is stored encrypted, and skips energy entirely", async () => {
    const fetchMock = stubFetch();
    const user = await db.user.create({ data: { clerkId: `${marker}_byo` } });
    const stored = await addCredential(
      user.id,
      "testprovider",
      "sk-byo-secret-9999"
    );
    expect(stored.last4).toBe("9999");
    expect(stored.data).not.toContain("sk-byo-secret");
    await db.energyAccount.create({ data: { userId: user.id, balance: 1 } });

    const result = await gatewayCall({
      userId: user.id,
      feature: "smoke",
      messages: [],
    });

    expect(result).toMatchObject({ status: "ok", via: "byo" });
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer sk-byo-secret-9999",
        }),
      })
    );
    const energy = await db.energyAccount.findUnique({
      where: { userId: user.id },
    });
    expect(energy!.balance).toBe(1); // BYO exempt (D28)
  });

  it("interactive BYO failure returns a fallback offer — never silent spend (D34)", async () => {
    stubFetch({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid key"),
    });
    const user = await db.user.create({ data: { clerkId: `${marker}_fail` } });
    await addCredential(user.id, "testprovider", "sk-dead-key-0001");
    await db.energyAccount.create({ data: { userId: user.id, balance: 1 } });

    const result = await gatewayCall({
      userId: user.id,
      feature: "smoke",
      messages: [],
      interactive: true,
    });
    expect(result).toMatchObject({ status: "byo_failed", canFallback: true });

    // The user pressed the button: platform route with energy deduction.
    vi.unstubAllGlobals();
    stubFetch();
    const retried = await gatewayCall({
      userId: user.id,
      feature: "smoke",
      messages: [],
      interactive: true,
      forcePlatform: true,
    });
    expect(retried).toMatchObject({ status: "ok", via: "platform" });
  });

  it("queued BYO failure hard-fails (D34: jobs can't ask)", async () => {
    stubFetch({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    });
    const user = await db.user.create({
      data: { clerkId: `${marker}_queued` },
    });
    await addCredential(user.id, "testprovider", "sk-dead-key-0002");

    await expect(
      gatewayCall({
        userId: user.id,
        feature: "smoke",
        messages: [],
        interactive: false,
      })
    ).rejects.toBeInstanceOf(GatewayByoFailureError);
  });

  it("a disabled feature flag short-circuits before any provider call (D6)", async () => {
    stubFetch();
    const user = await db.user.create({ data: { clerkId: `${marker}_flag` } });
    await db.featureFlag.update({
      where: { key: "smoke" },
      data: { enabled: false },
    });

    await expect(
      gatewayCall({ userId: user.id, feature: "smoke", messages: [] })
    ).rejects.toBeInstanceOf(FeatureDisabledError);

    await db.featureFlag.update({
      where: { key: "smoke" },
      data: { enabled: true },
    });
    const result = await gatewayCall({
      userId: user.id,
      feature: "smoke",
      messages: [],
    });
    expect(result).toMatchObject({ status: "ok" });
  });
});
