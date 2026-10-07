import type { ReactNode } from "react";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { isClerkConfigured } from "@/lib/env";
import { isGateOpen } from "@/services/waitlist";

export const dynamic = "force-dynamic";

// The single gate choke point (D38b): every spine page lives under this
// layout, so an unredeemed user can never reach app features.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (isClerkConfigured() && user && !isGateOpen(user)) {
    return (
      <main>
        <h1>Invite required</h1>
        <p>
          You&apos;re signed in but not yet invited. Join the waitlist or redeem
          your code.
        </p>
        <Link href="/waitlist">Redeem an invite code →</Link>
      </main>
    );
  }
  return (
    <>
      <nav style={{ marginBottom: "1.5rem", display: "flex", gap: "1rem" }}>
        <Link href="/profile">Profile</Link>
        <Link href="/projects">Projects</Link>
        <Link href="/skills">Skills</Link>
        <Link href="/events">Events</Link>
        <Link href="/gateway">AI&nbsp;Keys</Link>
        <Link href="/tokens">Tokens</Link>
        <Link href="/admin">Admin</Link>
      </nav>
      {!isClerkConfigured() && (
        <p style={{ color: "#a66" }}>dev mode: no auth configured</p>
      )}
      {children}
    </>
  );
}
