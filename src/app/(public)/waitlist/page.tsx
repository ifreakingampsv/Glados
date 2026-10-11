import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { isGateOpen } from "@/services/waitlist";
import { redeemCodeAction } from "@/app/actions/waitlist";

export const dynamic = "force-dynamic";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();

  if (user && isGateOpen(user)) {
    return (
      <main className="section-card">
        <h1>Access unlocked</h1>
        <p className="lede">Your invite code is active.</p>
        <Link href="/profile" className="btn btn-primary">
          Open your spine workspace
        </Link>
      </main>
    );
  }

  return (
    <main>
      <header className="site-header">
        <Link href="/" className="brand-mark">
          GLaDOS
        </Link>
        <Link href="/" className="nav-link">
          Back to home
        </Link>
      </header>

      <section className="section-card">
        <h1>Waitlist &amp; invite redemption</h1>
        {params.joined && (
          <div className="alert alert-success" role="status">
            You are on the waitlist. We will send your invite code when the next
            cohort opens.
          </div>
        )}
        {params.error === "bad-code" && (
          <div className="alert alert-danger" role="alert">
            Invalid or already-redeemed invite code. Check the code and try
            again.
          </div>
        )}
        {!user && (
          <p className="muted">
            Sign in first, then enter your single-use invite code below.
          </p>
        )}
        <form action={redeemCodeAction} className="row">
          <input
            name="code"
            placeholder="Invite code"
            aria-label="Invite code"
            required
          />
          <button type="submit" className="btn btn-primary">
            Redeem invite code
          </button>
        </form>
      </section>
    </main>
  );
}
