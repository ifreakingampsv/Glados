import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";

export class QuotaExceededError extends Error {
  constructor(
    public feature: string,
    public cap: number
  ) {
    super(`daily cap reached for ${feature} (${cap}/day)`);
  }
}

// D28: attractor features = fixed daily caps. Called BEFORE a gateway call by
// the S1 consumers (scanner, JD scan); the usage row written by the gateway's
// meter is the counter.
export async function enforceAttractorCap(
  userId: string,
  feature: string
): Promise<void> {
  const caps = await getConfig<Record<string, number>>("attractor.caps", {});
  const cap = caps[feature];
  if (cap === undefined) return; // not an attractor feature
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  const used = await db.usage.count({
    where: { userId, feature, createdAt: { gte: startOfUtcDay } },
  });
  if (used >= cap) {
    throw new QuotaExceededError(feature, cap);
  }
}
