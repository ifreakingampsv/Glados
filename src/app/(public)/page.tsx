import Link from "next/link";
import { AuthSection } from "@/components/auth-section";
import { joinWaitlistAction } from "@/app/actions/waitlist";

export default function Landing() {
  return (
    <main>
      <header className="site-header">
        <span className="brand-mark">GLaDOS</span>
        <div className="row">
          <Link href="/waitlist" className="nav-link">
            Redeem invite
          </Link>
          <AuthSection />
        </div>
      </header>

      <section className="section-card">
        <h1>Evidence-backed job prep on one shared spine.</h1>
        <p className="lede">
          Stop guessing how your skills match a job description. Build one
          verified profile of shipped projects, evidenced skill levels, and
          target roles that powers gap diagnosis, tailored resumes, and grounded
          technical prep.
        </p>

        <div className="grid-3" style={{ marginTop: "1.25rem" }}>
          <div className="item-row">
            <h3>Evidenced skills</h3>
            <p className="muted">
              Skill levels are computed from append-only evidence events with
              90-day recency decay, separate from unverified self-claims.
            </p>
          </div>
          <div className="item-row">
            <h3>Project bank</h3>
            <p className="muted">
              Keep your shipped repositories, work history, and links structured
              once so every role comparison draws from real work.
            </p>
          </div>
          <div className="item-row">
            <h3>Dual-credential AI</h3>
            <p className="muted">
              Bring your own provider key for zero marginal cost or use the
              platform&apos;s metered route with transparent daily quotas.
            </p>
          </div>
        </div>
      </section>

      <section className="section-card">
        <h2>Join the waitlist</h2>
        <p className="muted">
          Enter your email to request an invite code for early cohort access, or{" "}
          <Link href="/waitlist">redeem an existing code</Link>.
        </p>
        <form action={joinWaitlistAction} className="row">
          <input
            name="email"
            type="email"
            placeholder="you@example.com"
            aria-label="Email address"
            required
          />
          <button type="submit" className="btn btn-primary">
            Join waitlist
          </button>
        </form>
      </section>
    </main>
  );
}
