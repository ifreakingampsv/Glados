import crypto from "node:crypto";
import { db, type ProviderRoute } from "@/lib/db";
import { getConfig } from "@/services/levels";
import { deductEnergy, ensureDailyGrant, todayUtc } from "@/services/energy";
import { getDecryptedCredential } from "@/services/credentials";

// D2/D29: the ONLY path by which the platform spends money on AI. Every call
// is metered (usage row + daily counter [+ energy deduction] in ONE
// transaction, D38c) and feature-flagged (D6).

export interface GatewayMessage {
  role: string;
  content: string;
}

export interface GatewayCallInput {
  userId: string;
  feature: string;
  messages: GatewayMessage[];
  interactive?: boolean; // UI call (fallback consent possible) vs queued job
  forcePlatform?: boolean; // set AFTER the user pressed the fallback button (D34)
  cacheKey?: string; // D4 content-hash cache key
  skipEnergy?: boolean; // D60: attractor/free-capped calls never drain energy bars
}

export type GatewayResult =
  | {
      status: "ok";
      content: string;
      usageId: string;
      via: "byo" | "platform";
      cached?: boolean;
    }
  | {
      status: "byo_failed";
      provider: string;
      message: string;
      canFallback: true;
    };

export class FeatureDisabledError extends Error {}
export class GatewayByoFailureError extends Error {
  constructor(
    public provider: string,
    message: string
  ) {
    super(message);
  }
}
export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    body: string
  ) {
    super(`provider ${status}: ${body.slice(0, 200)}`);
  }
}

export function hashContentForCache(prefix: string, payload: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(payload, "utf8")
    .digest("hex");
  return `${prefix}:${digest}`;
}

async function resolveRoute(feature: string): Promise<ProviderRoute> {
  const route = await db.providerRoute.findFirst({
    where: { feature, isActive: true },
  });
  if (!route)
    throw new Error(`no active provider route for feature: ${feature}`);
  return route;
}

// S2 (D84): does this user hold a BYO key for the feature's active route?
// Decides flat per-session bar charging without spending a gateway call.
export async function hasByoForFeature(
  userId: string,
  feature: string
): Promise<boolean> {
  const route = await resolveRoute(feature);
  return Boolean(await getDecryptedCredential(userId, route.provider));
}

async function checkFlag(feature: string): Promise<void> {
  const flag = await db.featureFlag.findUnique({ where: { key: feature } });
  if (flag && !flag.enabled)
    throw new FeatureDisabledError(`feature disabled: ${feature}`);
}

function platformKeyFor(provider: string): string | undefined {
  return process.env[`PLATFORM_${provider.toUpperCase()}_API_KEY`];
}

export interface ProviderResponse {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

// OpenAI-compatible adapter shape (D26): Google AI Studio / OpenRouter /
// Atria Dawn all expose this shape (verify per-provider at build time).
export async function callOpenAI(
  route: ProviderRoute,
  apiKey: string,
  messages: GatewayMessage[],
  fetchImpl: typeof fetch = fetch
): Promise<ProviderResponse> {
  const response = await fetchImpl(route.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: route.model, messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new ProviderHttpError(response.status, await response.text());
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: body.choices?.[0]?.message?.content ?? "",
    usage: {
      prompt_tokens: body.usage?.prompt_tokens ?? 0,
      completion_tokens: body.usage?.completion_tokens ?? 0,
    },
  };
}

async function meter(
  userId: string,
  route: ProviderRoute,
  response: ProviderResponse,
  via: "byo" | "platform",
  skipEnergy = false
): Promise<string> {
  const barUsd = await getConfig<number>("energy.barUsd", 0.1);
  const costUsd =
    ((response.usage.prompt_tokens + response.usage.completion_tokens) / 1000) *
    route.costPer1kUsd;
  const usageId = await db.$transaction(async (tx) => {
    const usage = await tx.usage.create({
      data: {
        userId,
        feature: route.feature,
        provider: route.provider,
        model: route.model,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        costUsd,
        via,
      },
    });
    await tx.dailyCounter.upsert({
      where: { userId_date: { userId, date: todayUtc() } },
      update: { count: { increment: 1 } },
      create: { userId, date: todayUtc(), count: 1 },
    });
    if (via === "platform" && !skipEnergy) {
      // BYO users and attractor calls (D60) are exempt from energy deduction.
      await deductEnergy(userId, costUsd / barUsd, tx);
    }
    return usage.id;
  });
  await checkBudgetAlert();
  return usageId;
}

// D5/D28: per-user caps stop one maniac; the budget alert stops the crowd.
async function checkBudgetAlert(): Promise<void> {
  const alertUsd = await getConfig<number>("budget.alertUsd", 4);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { _sum } = await db.usage.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: monthStart } },
  });
  const spend = _sum.costUsd ?? 0;
  if (spend >= alertUsd) {
    const month = monthStart.toISOString().slice(0, 7);
    await db.budgetAlert.upsert({
      where: { month },
      update: { amountUsd: spend },
      create: { month, amountUsd: spend },
    });
  }
}

// D78f: Shared-cache features (skill_definition, bank_gen, cert_course_map)
// route PLATFORM-only so a BYO user never funds a shared asset.
export const PLATFORM_ONLY_FEATURES = new Set([
  "skill_definition",
  "bank_gen",
  "cert_course_map",
]);

export async function gatewayCall(
  input: GatewayCallInput,
  fetchImpl: typeof fetch = fetch
): Promise<GatewayResult> {
  await checkFlag(input.feature);

  if (input.cacheKey) {
    const cached = await db.gatewayCache.findUnique({
      where: { cacheKey: input.cacheKey },
    });
    if (cached) {
      return {
        status: "ok",
        content: cached.content,
        usageId: "cached",
        via: "platform",
        cached: true,
      };
    }
  }

  const route = await resolveRoute(input.feature);

  const isPlatformOnly =
    Boolean(input.forcePlatform) || PLATFORM_ONLY_FEATURES.has(input.feature);
  const byoKey = isPlatformOnly
    ? null
    : await getDecryptedCredential(input.userId, route.provider);
  if (byoKey && !isPlatformOnly) {
    // BYO auto-wins (D34): zero marginal cost is the D2 principle.
    try {
      const response = await callOpenAI(
        route,
        byoKey,
        input.messages,
        fetchImpl
      );
      const usageId = await meter(
        input.userId,
        route,
        response,
        "byo",
        input.skipEnergy
      );
      if (input.cacheKey) {
        await db.gatewayCache.upsert({
          where: { cacheKey: input.cacheKey },
          update: { content: response.content, feature: input.feature },
          create: {
            cacheKey: input.cacheKey,
            feature: input.feature,
            content: response.content,
          },
        });
      }
      return { status: "ok", content: response.content, usageId, via: "byo" };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        // D34: never a silent toggle. Interactive calls surface the consent
        // button ("costs 1 energy bar"); queued jobs hard-fail.
        if (input.interactive) {
          return {
            status: "byo_failed",
            provider: route.provider,
            message: error.message,
            canFallback: true,
          };
        }
        throw new GatewayByoFailureError(route.provider, error.message);
      }
      throw error;
    }
  }

  const platformKey = platformKeyFor(route.provider);
  if (!platformKey) {
    throw new Error(
      `no platform key configured for provider: ${route.provider}`
    );
  }
  if (!input.skipEnergy) {
    await ensureDailyGrant(input.userId); // lazy 1-bar/day grant before deduction
  }
  const response = await callOpenAI(
    route,
    platformKey,
    input.messages,
    fetchImpl
  );
  const usageId = await meter(
    input.userId,
    route,
    response,
    "platform",
    input.skipEnergy
  );
  if (input.cacheKey) {
    await db.gatewayCache.upsert({
      where: { cacheKey: input.cacheKey },
      update: { content: response.content, feature: input.feature },
      create: {
        cacheKey: input.cacheKey,
        feature: input.feature,
        content: response.content,
      },
    });
  }
  return { status: "ok", content: response.content, usageId, via: "platform" };
}
