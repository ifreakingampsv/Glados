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
      <main className="section-card">
        <h1>Invite required</h1>
        <p className="lede">
          You are signed in, but your account has not redeemed an invite code
          yet.
        </p>
        <Link href="/waitlist" className="btn btn-primary">
          Redeem an invite code
        </Link>
      </main>
    );
  }
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand-mark">
          GLaDOS
        </Link>
        <nav className="site-nav" aria-label="Workspace navigation">
          <Link href="/profile" className="nav-link">
            Profile
          </Link>
          <Link href="/projects" className="nav-link">
            Projects
          </Link>
          <Link href="/skills" className="nav-link">
            Skills
          </Link>
          <Link href="/gaps" className="nav-link">
            Gap Map
          </Link>
          <Link href="/resume" className="nav-link">
            Resume
          </Link>
          <Link href="/linkedin" className="nav-link">
            LinkedIn
          </Link>
          <Link href="/events" className="nav-link">
            Events
          </Link>
          <Link href="/gateway" className="nav-link">
            AI Keys
          </Link>
          <Link href="/tokens" className="nav-link">
            Tokens
          </Link>
          <Link href="/admin" className="nav-link">
            Admin
          </Link>
        </nav>
      </header>
      {!isClerkConfigured() && (
        <div className="alert alert-warning" role="status">
          Local dev mode: Clerk keys are not configured.
        </div>
      )}
      {children}
    </>
  );
}
