import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDecaySweep } from "@/services/levels";

export const dynamic = "force-dynamic";

// Vercel Cron stopgap (D31/D32): drains the nightly decay job. Hobby cron is
// daily-only — acceptable for this sweep; real queue volume triggers the
// container-platform move per D31.
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
