import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listInterviewSessions } from "@/services/interview";
import {
  startInterviewAction,
  createRecordAction,
} from "@/app/actions/interview";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "no-project": "Pick a project first.",
  "no-energy":
    "You're out of energy bars. They refill daily — or bring your own API key and interviews run on it.",
  "start-failed": "Couldn't start the interview. Try again.",
};

export default async function InterviewSetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
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
  const [projects, sessions, records, jds] = await Promise.all([
    db.project.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    listInterviewSessions(user.id),
    db.decisionRecord.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    db.jobDescription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  const error = params.error
    ? (ERRORS[params.error] ?? "Something went wrong.")
    : null;
  const recordsByProject = new Map<string, typeof records>();
  for (const r of records) {
    const list = recordsByProject.get(r.projectId) ?? [];
    list.push(r);
    recordsByProject.set(r.projectId, list);
  }

  return (
    <main className="section-card">
      <h1>Mock interview</h1>
      <p>
        A startup-mode interviewer that has skimmed your project and assumes
        it&apos;s vibe-coded until you prove otherwise. Five questions, ten-ish
        minutes — or a deep twelve. One energy bar either way.
      </p>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      {projects.length === 0 ? (
        <p className="empty-state">
          Add or import a project first — the interviewer grounds every question
          in one.
        </p>
      ) : (
        <form action={startInterviewAction} className="stack">
          <fieldset className="stack">
            <legend>What is the interviewer holding?</legend>
            <label className="radio-row">
              <input type="radio" name="scope" value="project" defaultChecked />
              <span>One project — the deep dive</span>
            </label>
            <label className="radio-row">
              <input type="radio" name="scope" value="portfolio" />
              <span>Portfolio — up to 3 projects, rotating focus</span>
            </label>
            <label className="radio-row">
              <input type="radio" name="scope" value="application" />
              <span>
                Application — your resume (+ optional job description)
              </span>
            </label>
          </fieldset>
          <fieldset className="stack">
            <legend>
              Projects (single-select for deep dive, multi-select for portfolio)
            </legend>
            {projects.map((p) => (
              <label key={p.id} className="radio-row">
                <input type="radio" name="projectId" value={p.id} />
                <input type="checkbox" name="projectIds" value={p.id} />
                <span>
                  <strong>{p.title}</strong>
                  {p.skills.length > 0 ? (
                    <small> · {p.skills.join(", ")}</small>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
          {jds.length > 0 ? (
            <fieldset className="stack">
              <legend>Job description (application scope, optional)</legend>
              <select name="jdId" defaultValue="">
                <option value="">No JD — resume only</option>
                {jds.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </fieldset>
          ) : null}
          <fieldset className="row">
            <legend>Length</legend>
            <button type="submit" name="mode" value="quick">
              Quick — 5 questions
            </button>
            <button
              type="submit"
              name="mode"
              value="deep"
              className="secondary"
            >
              Deep — 12 questions
            </button>
          </fieldset>
        </form>
      )}
      {projects.length > 0 ? (
        <section className="stack">
          <h2>Decision records (optional)</h2>
          <p className="muted">
            ADR-lite notes — the choice, the alternatives, the why. The grader
            reads them (never the interviewer); records you write are claims,
            not evidence.
          </p>
          {projects.map((p) => {
            const list = recordsByProject.get(p.id) ?? [];
            return (
              <div key={p.id} className="stack">
                <h3>{p.title}</h3>
                {list.length > 0 ? (
                  <ul>
                    {list.map((r) => (
                      <li key={r.id}>
                        <strong>{r.choice}</strong>{" "}
                        {r.status === "draft" ? <small>(draft)</small> : null} —{" "}
                        {r.rationale}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    <small>No records yet.</small>
                  </p>
                )}
                <form action={createRecordAction} className="stack">
                  <input type="hidden" name="projectId" value={p.id} />
                  <input
                    name="choice"
                    placeholder="Choice (e.g. Postgres for the queue store)"
                    required
                  />
                  <input
                    name="alternatives"
                    placeholder="Alternatives, comma-separated (e.g. Redis, Mongo)"
                  />
                  <textarea
                    name="rationale"
                    rows={2}
                    placeholder="Why — the real reason you'd defend"
                    required
                  />
                  <button type="submit" className="secondary">
                    Add record
                  </button>
                </form>
              </div>
            );
          })}
        </section>
      ) : null}
      {sessions.length > 0 ? (
        <section className="stack">
          <h2>Past sessions</h2>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/interview/${s.id}`}>
                  {new Date(s.startedAt).toLocaleDateString()} · {s.mode} ·{" "}
                  {s.status}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
