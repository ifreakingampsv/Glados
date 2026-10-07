import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { handleClerkEvent, type ClerkEvent } from "@/services/users";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!env.clerkWebhookSecret) {
    return NextResponse.json(
      { error: "CLERK_WEBHOOK_SECRET not configured" },
      { status: 503 }
    );
  }
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  let event: ClerkEvent;
  try {
    event = new Webhook(env.clerkWebhookSecret).verify(
      payload,
      headers
    ) as unknown as ClerkEvent;
  } catch {
    return NextResponse.json(
      { error: "invalid webhook signature" },
      { status: 400 }
    );
  }
  const user = await handleClerkEvent(event);
  return NextResponse.json({ handled: true, userId: user?.id ?? null });
}
