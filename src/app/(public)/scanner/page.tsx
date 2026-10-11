"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { runScannerAction } from "@/app/actions/scanner";
import type { ScannerResult } from "@/services/scanner";

export default function ScannerPage() {
  const [jdText, setJdText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [result, setResult] = useState<ScannerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await runScannerAction(jdText, resumeText);
      if (!res.ok || !res.result) {
        setError(res.message ?? "Could not run scan.");
      } else {
        setResult(res.result);
      }
    });
  }

  return (
    <main>
      <h1>Free JD and Resume Gap Scanner</h1>
      <p className="lede">
        Paste a job description and optional resume text to calculate your
        deterministic fit percentage and top skill gaps. No energy bars are
        required.
      </p>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <section className="section-card">
        <h2>Run gap scan</h2>
        <form onSubmit={handleSubmit} className="stack">
          <label htmlFor="scanner-jd" className="muted">
            Job description (required)
          </label>
          <textarea
            id="scanner-jd"
            rows={5}
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the job description requirements and responsibilities..."
            required
          />

          <label htmlFor="scanner-resume" className="muted">
            Resume or LinkedIn summary text (optional)
          </label>
          <textarea
            id="scanner-resume"
            rows={4}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste your resume text to compare your claimed skills against the job description..."
          />

          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isPending || !jdText.trim()}
            >
              {isPending ? "Scanning..." : "Calculate fit score"}
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="section-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>
                {result.jdTitle}: {result.fitPercent}% Fit
              </h2>
              <p className="muted">
                {result.kind === "anonymous"
                  ? `Showing top ${result.topGaps.length} of ${result.totalGapCount} skill gaps (Resume mode preview).`
                  : `Showing all ${result.fullItems.length} evaluated requirements.`}
              </p>
            </div>
            <span className="badge badge-accent">
              {result.fitPercent}% Fit Score
            </span>
          </div>

          <ul className="item-list" style={{ marginTop: "1rem" }}>
            {(result.kind === "authenticated"
              ? result.fullItems
              : result.topGaps
            ).map((item) => (
              <li key={item.requiredSkillId} className="item-row row-between">
                <div>
                  <strong>{item.requiredSkillDisplay}</strong>
                  <span className="muted" style={{ marginLeft: "0.5rem" }}>
                    Expected L{item.expectedLevel}
                  </span>
                </div>
                <div className="row">
                  <span
                    className={`badge ${
                      item.provenance === "evidenced"
                        ? "badge-accent"
                        : item.provenance === "missing"
                          ? "badge-danger"
                          : "badge-warn"
                    }`}
                  >
                    {item.provenance}
                  </span>
                  <span className="badge">
                    Credit: {(item.credit * 100).toFixed(0)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {result.kind === "anonymous" && (
            <div className="item-row stack" style={{ marginTop: "1rem" }}>
              <strong>
                Unlock the full gap list and evidence-backed profile mode
              </strong>
              <p className="muted">
                Your scanned job description and result are saved in your
                browser session for 30 days and automatically claimed into your
                account when you redeem an invite code.
              </p>
              <div className="row">
                <Link
                  href={result.cta.waitlistHref}
                  className="btn btn-primary"
                >
                  Join the waitlist
                </Link>
                <Link href={result.cta.redeemHref} className="btn">
                  Redeem invite code
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
