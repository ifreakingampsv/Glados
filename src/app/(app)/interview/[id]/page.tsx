import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getInterviewSession,
  resumeInterviewSession,
} from "@/services/interview";
import { InterviewAnswerForm } from "@/components/interview-answer-form";
import { GradeOnView } from "@/components/interview-grade-on-view";
import {
  deleteSessionAction,
  demandVoiceAction,
  draftRecordsAction,
  confirmRecordAction,
} from "@/app/actions/interview";

export const dynamic = "force-dynamic";

type SessionPayload = {
  grounding?: { projectId?: string };
  questionCount?: number;
  pushCap?: number;
};

type ReportPayload = {
  verdicts?: Array<{ turnIdx: number; verdict: string }>;
  probedSkills?: Array<{ skill: string; verdict: string }>;
  groundedness?: Array<{ finding: string; turnIdx: number }>;
  coaching?: Array<{ say: string; avoid: string; fix?: string }>;
  deleted?: boolean;
};

const VERDICT_ICON: Record<string, string> = {
  green: "🟢",
  amber: "🟡",
  red: "🔴",
};

const DIMENSION_LABELS: Array<[string, string]> = [
  ["techDepth", "Technical depth"],
  ["problemSolving", "Problem solving"],
  ["tradeoffs", "Tradeoffs"],
  ["communication", "Communication"],
  ["composure", "Composure"],
];

export default async function InterviewSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ paused?: string; error?: string; voice?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) notFound();
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const session = await getInterviewSession(user.id, id);
  if (!session) notFound();
  if (session.status === "active") {
    await resumeInterviewSession(user.id, id); // regenerate bank if stale
  }

  const payload = (session.payload ?? {}) as SessionPayload;
  const total = payload.questionCount ?? session.turns.length;
  const answered = session.turns.filter((t) => t.answerText !== null).length;
  const lastTurn = session.turns[session.turns.length - 1];
  const awaitingAnswer =
    session.status === "active" && lastTurn && lastTurn.answerText === null;
  const report = await db.interviewReport.findUnique({
    where: { sessionId: session.id },
  });
  const shareCardFlag = await db.featureFlag.findUnique({
    where: { key: "interview.shareCard" },
  });
  const reportPayload = (report?.payload ?? {}) as ReportPayload;
  const debriefRecords = session.status.match(/graded|completed/)
    ? await db.decisionRecord.findMany({
        where: { userId: user.id, sessionId: session.id },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <main className="section-card">
      <h1>Interview · {session.mode}</h1>
      <p>
        {Math.min(answered + (awaitingAnswer ? 1 : 0), total)} of {total}{" "}
        questions · status: {session.status}
      </p>
      {query.voice === "1" ? (
        <p>Thanks — noted. Voice ships when enough people ask.</p>
      ) : null}

      <ol className="stack transcript">
        {session.turns.map((t) => {
          const verdict = reportPayload.verdicts?.find(
            (v) => v.turnIdx === t.idx
          );
          return (
            <li key={t.id} className="turn">
              <p>
                <strong>Interviewer:</strong> {t.questionText}
                {t.pushesUsed > 0 ? (
                  <small> · follow-up {t.pushesUsed}</small>
                ) : null}
                {verdict ? ` ${VERDICT_ICON[verdict.verdict] ?? ""}` : null}
              </p>
              {t.answerText ? (
                <p>
                  <strong>You:</strong> {t.answerText}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {awaitingAnswer ? (
        <InterviewAnswerForm
          sessionId={session.id}
          paused={query.paused === "1"}
        />
      ) : null}

      {session.status === "completed" && !report ? (
        <GradeOnView sessionId={session.id} />
      ) : null}

      {report && !reportPayload.deleted ? (
        <section className="stack">
          <h2>
            Report · {report.readinessBand}{" "}
            <small>
              (graded{" "}
              {report.evidenceBasis === "records"
                ? "against your decision records"
                : "on reasoning quality — add decision records to sharpen future grading"}
              )
            </small>
          </h2>
          <ul>
            {DIMENSION_LABELS.map(([key, label]) => (
              <li key={key}>
                {label}: {report[key as "techDepth"] ?? "–"}/4
              </li>
            ))}
          </ul>
          {reportPayload.probedSkills?.length ? (
            <p>
              Probed:{" "}
              {reportPayload.probedSkills
                .map((s) => `${s.skill} ${VERDICT_ICON[s.verdict] ?? ""}`)
                .join(" · ")}
            </p>
          ) : null}
          {session.scope === "application" &&
          reportPayload.probedSkills?.some((s) => s.verdict !== "green") ? (
            <div>
              <h3>Resume claim audit</h3>
              <ul>
                {reportPayload.probedSkills
                  .filter((s) => s.verdict !== "green")
                  .map((s, i) => (
                    <li key={i}>
                      {s.skill} {VERDICT_ICON[s.verdict]} — a claim on your
                      resume you couldn&apos;t fully defend.
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {reportPayload.groundedness?.length ? (
            <div>
              <h3>Groundedness findings</h3>
              <ul>
                {reportPayload.groundedness.map((g, i) => (
                  <li key={i}>
                    (turn {g.turnIdx}) {g.finding}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reportPayload.coaching?.length ? (
            <div>
              <h3>Coaching</h3>
              <ul>
                {reportPayload.coaching.map((c, i) => (
                  <li key={i}>
                    <strong>Say:</strong> {c.say} · <strong>Avoid:</strong>{" "}
                    {c.avoid}
                    {c.fix ? (
                      <>
                        {" "}
                        · <strong>Fix:</strong> {c.fix}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="row">
            {shareCardFlag?.enabled ? (
              <Link href={`/card/${session.id}`}>Shareable readiness card</Link>
            ) : null}
            <form action={demandVoiceAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button type="submit" className="secondary">
                I&apos;d want this with voice
              </button>
            </form>
          </div>
          {session.status === "graded" && debriefRecords.length === 0 ? (
            <form action={draftRecordsAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button type="submit" className="secondary">
                Save the choices you defended as decision records
              </button>
            </form>
          ) : null}
          {debriefRecords.length > 0 ? (
            <div className="stack">
              <h3>Decision records from this session</h3>
              <ul>
                {debriefRecords.map((r) => (
                  <li key={r.id} className="stack">
                    <strong>{r.choice}</strong>
                    {r.alternatives.length > 0 ? (
                      <small> (vs {r.alternatives.join(", ")})</small>
                    ) : null}
                    <p className="muted">{r.rationale}</p>
                    {r.status === "draft" ? (
                      <form action={confirmRecordAction}>
                        <input
                          type="hidden"
                          name="sessionId"
                          value={session.id}
                        />
                        <input type="hidden" name="recordId" value={r.id} />
                        <button type="submit">Confirm this record</button>
                      </form>
                    ) : (
                      <small>confirmed</small>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {session.status === "abandoned" ? (
        <p className="empty-state">This session expired and was abandoned.</p>
      ) : null}
      {session.status === "deleted" ? (
        <p className="empty-state">
          Deleted — transcript removed; levels from this session no longer
          count.
        </p>
      ) : null}

      <div className="row">
        <Link href="/interview">← All sessions</Link>
        {session.status !== "deleted" ? (
          <form action={deleteSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button type="submit" className="secondary">
              Delete session
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
