import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import type { User } from "@prisma/client";
import { gatewayCall } from "@/services/gateway";

// D37d: the admin smoke probe — the gateway's first caller. Proves
// resolver → adapter → metering before S1 depends on any of it.
export async function runSmokeProbe(
  admin: User,
  fetchImpl: typeof fetch = fetch
) {
  assertAdmin(admin);
  const result = await gatewayCall(
    {
      userId: admin.id,
      feature: "smoke",
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
      interactive: true,
    },
    fetchImpl
  );
  const usage =
    result.status === "ok"
      ? await db.usage.findUnique({ where: { id: result.usageId } })
      : null;
  return { result, usage };
}
