import { NextFetchEvent, NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const clerkConfigured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !!process.env.CLERK_SECRET_KEY;

// Without Clerk keys (local dev) we pass everything through; pages render a
// setup notice. With keys, the waitlist gate (T03) hooks in below.
const clerk = clerkConfigured ? clerkMiddleware() : null;

export default function middleware(req: NextRequest, evt: NextFetchEvent) {
  if (!clerk) return NextResponse.next();
  return clerk(req, evt);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
