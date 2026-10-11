import { getSessionUser } from "@/lib/auth";
import {
  LINKEDIN_PDF_GUIDE_COPY,
  type LinkedinReviewResult,
} from "@/services/linkedin-review";
import { runLinkedinReviewAction } from "@/app/actions/linkedin";

export const dynamic = "force-dynamic";

export default async function LinkedinReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ result?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="section-card">
        <p className="empty-state">
          Sign-in unavailable in this environment (no Clerk keys configured).
        </p>
      </main>
    );
  }

  const params = searchParams ? await searchParams : {};
  let reviewResult: LinkedinReviewResult | null = null;
  if (params.result) {
    try {
      const decoded = Buffer.from(params.result, "base64url").toString("utf8");
      reviewResult = JSON.parse(decoded) as LinkedinReviewResult;
    } catch {
      reviewResult = null;
    }
  }

  return (
    <main>
      <h1>LinkedIn Profile Review</h1>
      <p className="lede">
        Evaluate your LinkedIn profile against target engineering roles using
        your official PDF export or pasted profile text. Free tier limit: 1
        review per day.
      </p>

      {params.error && (
        <div className="alert alert-danger" role="alert">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <section className="section-card">
        <h2>Supply Your LinkedIn Data</h2>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          {LINKEDIN_PDF_GUIDE_COPY} Arbitrary profile URL scraping is never
          used.
        </p>

        <form action={runLinkedinReviewAction} className="stack">
          <div>
            <label htmlFor="target-roles" className="muted">
              Target Roles (comma-separated)
            </label>
            <input
              id="target-roles"
              name="targetRoles"
              placeholder="e.g. Senior Backend Engineer, Distributed Systems Engineer"
              defaultValue="Software Engineer"
              required
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>

          <div>
            <label htmlFor="linkedin-pdf" className="muted">
              LinkedIn Save-to-PDF Export (optional if pasting text)
            </label>
            <input
              id="linkedin-pdf"
              name="pdfFile"
              type="file"
              accept="application/pdf"
              style={{ display: "block", marginTop: "0.25rem" }}
            />
          </div>

          <div>
            <label htmlFor="linkedin-text" className="muted">
              Or Paste LinkedIn Profile Text
            </label>
            <textarea
              id="linkedin-text"
              name="rawText"
              rows={5}
              placeholder="Paste your headline, About section, and experience entries..."
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>

          <div>
            <button type="submit" className="btn btn-primary">
              Review LinkedIn Profile
            </button>
          </div>
        </form>
      </section>

      {reviewResult && (
        <section className="section-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Recruiter-Attractiveness Assessment</h2>
            <span className="pill">
              Headline Score: {reviewResult.recommendations.headlineScore}/100
              {reviewResult.cached ? " (Cached)" : ""}
            </span>
          </div>

          <p style={{ marginTop: "0.75rem" }}>
            {reviewResult.recommendations.summaryFeedback}
          </p>

          <div className="stack" style={{ marginTop: "1.25rem" }}>
            <div>
              <h3>What to Add</h3>
              <ul>
                {reviewResult.recommendations.add.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>What to Post (Feeds Commit-to-Post Drafts)</h3>
              <ul>
                {reviewResult.recommendations.post.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>Visibility &amp; Search Positioning</h3>
              <ul>
                {reviewResult.recommendations.visibility.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
