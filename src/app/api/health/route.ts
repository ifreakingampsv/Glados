import { NextResponse } from "next/server";
import { getHealth } from "@/services/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health);
}
