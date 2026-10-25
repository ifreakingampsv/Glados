"use client";

import { useState, useTransition } from "react";
import {
  checkPostEligibilityAction,
  draftProjectPostsAction,
} from "@/app/actions/posts";
import type { ProjectPostEligibility } from "@/services/commit-post";

export function CommitPostPanel({
  initialEligibility,
  shareFlowGuide,
}: {
  initialEligibility: ProjectPostEligibility;
  shareFlowGuide: readonly string[];
}) {
  const [pending, startTransition] = useTransition();
  const [eligibility, setEligibility] =
    useState<ProjectPostEligibility>(initialEligibility);
  const [confirmForkWork, setConfirmForkWork] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [commitRange, setCommitRange] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!eligibility.isGithubLinked || !eligibility.showSurface) {
    return null;
  }

  return (
    <div
      className="item-row stack"
      style={{ marginTop: "0.5rem", background: "var(--surface-2, #f8fafc)" }}
    >
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div className="row">
          <strong>Commit to LinkedIn post</strong>
          {eligibility.repoFullName && (
            <span className="badge">{eligibility.repoFullName}</span>
          )}
          <span
            className={eligibility.eligible ? "badge badge-accent" : "badge"}
          >
            {eligibility.authoredCommitCount} /{" "}
            {eligibility.minCommitsPerMilestone} authored commits since{" "}
            {eligibility.anchorSource === "post_drafted"
              ? "last draft"
              : "import"}
          </span>
        </div>
        <span className="muted tabular" style={{ fontSize: "0.85rem" }}>
          Weekly drafts: {eligibility.weeklyDraftsUsed} /{" "}
          {eligibility.maxDraftsPerWeek}
        </span>
      </div>

      {eligibility.isFork && (
        <label
          className="row muted"
          style={{ fontSize: "0.85rem", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={confirmForkWork}
            onChange={(e) => setConfirmForkWork(e.target.checked)}
            style={{ width: "auto" }}
          />
          <span>
            I confirm these commits are my own authored work on this forked
            repository (D22 guardrail).
          </span>
        </label>
      )}

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await checkPostEligibilityAction(
                eligibility.projectId
              );
              if (!res.ok) {
                setError(res.message);
                return;
              }
              setEligibility(res.eligibility);
            });
          }}
        >
          {pending ? "Checking commits..." : "Refresh commit count"}
        </button>

        {eligibility.eligible && !eligibility.weeklyCapReached && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={pending || (eligibility.isFork && !confirmForkWork)}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await draftProjectPostsAction(
                  eligibility.projectId,
                  { confirmForkWork }
                );
                if (!res.ok) {
                  setError(res.message);
                  return;
                }
                setDrafts(res.result.drafts);
                setCommitRange(res.result.commitRange);
                const refreshed = await checkPostEligibilityAction(
                  eligibility.projectId
                );
                if (refreshed.ok) {
                  setEligibility(refreshed.eligibility);
                }
              });
            }}
          >
            {pending
              ? "Drafting from commit range..."
              : "Draft LinkedIn posts from commit range"}
          </button>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <div className="row-between">
            <strong>
              Candidate drafts ({drafts.length}) grounded in commit range{" "}
              <code>{commitRange}</code>
            </strong>
            <span className="badge badge-accent">
              Milestone anchor reset (post_drafted logged)
            </span>
          </div>
          {drafts.map((draft, idx) => (
            <div key={idx} className="stack">
              <label className="muted" style={{ fontSize: "0.85rem" }}>
                Option {idx + 1} (edit in your own voice before copying):
              </label>
              <textarea
                rows={4}
                value={draft}
                onChange={(e) => {
                  const val = e.target.value;
                  setDrafts((prev) =>
                    prev.map((d, i) => (i === idx ? val : d))
                  );
                }}
              />
            </div>
          ))}
          <div className="item-row stack" style={{ fontSize: "0.85rem" }}>
            <strong>Self-serve LinkedIn share guide (D40):</strong>
            <ul className="stack" style={{ paddingLeft: "1.25rem" }}>
              {shareFlowGuide.map((step, i) => (
                <li key={i} className="muted">
                  {step}
                </li>
              ))}
            </ul>
            <div>
              <a
                href="https://www.linkedin.com/feed/?shareActive=true"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-primary"
              >
                Open LinkedIn share box
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
