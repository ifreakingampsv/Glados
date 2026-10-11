import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDecaySweep } from "@/services/levels";

export const dynamic = "force-dynamic";

// Manual backstop for the decay sweep (D65): nightly scheduled runs happen via
// pg-boss on the persistent worker (`decay_sweep` cron `0 3 * * *` UTC).
export async function GET(req: Request) {
  if (env.cronConfigured) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${env.cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const recomputed = await runDecaySweep();
  return NextResponse.json({ recomputed });
}
