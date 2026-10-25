import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  getAdminEconomicsDashboard,
  getAdminEvidenceReadouts,
  getAdminQuizTelemetry,
} from "@/services/economics";
import {
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
  getConfig,
} from "@/services/levels";
import { isStrictReviewGatingEnabled } from "@/services/quiz-banks";
import { getReplayFeatureFlags } from "@/services/replay";
import { listCandidates } from "@/services/skill-admin";
import { GOLDEN_TRANSCRIPTS } from "@/services/eval-golden";
import {
  estimateEvalRunCostUsd,
  getEvalAnchors,
  getEvalRunHistory,
} from "@/services/eval-runner";
import { GoldenRunButton } from "@/components/admin-golden-run";
import { interviewStorageReadout } from "@/services/interview-tiering";
import { shelfTelemetry } from "@/services/shelf-telemetry";
import { listInviteCodes, listWaitlist } from "@/services/waitlist";
import {
  GenerateDefinitionsButton,
  ProbeButton,
  StorageProbeButton,
} from "@/components/probe-button";
import {
  GenerateQuizBanksForm,
  WhatIfReplayPanel,
} from "@/components/admin-calibration-controls";
import {
  approveCandidateAction,
  approveQuizBankReviewAction,
  createInviteCodeAction,
  mergeCandidateAction,
  rejectCandidateAction,
  retireAndReplaceQuizBankAction,
  setFlagAction,
  toggleReplayFlagsAction,
  toggleStrictReviewGatingAction,
  setEvalAnchorAction,
  tierTranscriptsAction,
} from "@/app/actions/admin";

export const dynamic = "force-dynamic";

const PARENT_CATEGORY_NAMES = new Set([
  "languages",
  "frontend",
  "backend",
  "database",
  "devops",
  "mobile",
  "tooling",
]);

export default async function AdminPage() {
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
  const [
    evalEstimate,
    evalAnchors,
    evalHistory,
    voiceDemandRow,
    storageReadout,
  ] = await Promise.all([
    estimateEvalRunCostUsd(),
    getEvalAnchors(),
    getEvalRunHistory(),
    db.config.findUnique({ where: { key: "voice.demandCount" } }),
    interviewStorageReadout(),
  ]);
  const estimateUsd = evalEstimate;
  const GOLDEN_COUNT = GOLDEN_TRANSCRIPTS.length;
  const latestRun = evalHistory[0] ?? null;
  const anchoredIds = new Set(Object.keys(evalAnchors));
  const pendingFixtures = (latestRun?.pendingAdjudication ?? []).filter(
    (id) => !anchoredIds.has(id)
  );
  const voiceDemand = (voiceDemandRow?.value as number | undefined) ?? 0;
  if (user.role !== "ADMIN") {
    return (
      <main className="section-card">
        <div className="alert alert-danger" role="alert">
          Admin role required (to grant access in dev, set your user row{" "}
          <code>role = ADMIN</code>).
        </div>
      </main>
    );
  }

  const [
    candidates,
    actives,
    codes,
    waitlist,
    flags,
    alerts,
    routes,
    economics,
    readouts,
    quizTelemetry,
    replayFlags,
    strictReviewGating,
    pointsConfig,
    sourceWeightsConfig,
  ] = await Promise.all([
    listCandidates(),
    db.skill.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    listInviteCodes(),
    listWaitlist(),
    db.featureFlag.findMany({ orderBy: { key: "asc" } }),
    db.budgetAlert.findMany({ orderBy: { month: "desc" }, take: 3 }),
    db.providerRoute.findMany({
      orderBy: [{ feature: "asc" }, { provider: "asc" }],
    }),
    getAdminEconomicsDashboard(user),
    getAdminEvidenceReadouts(user),
    getAdminQuizTelemetry(user),
    getReplayFeatureFlags(),
    isStrictReviewGatingEnabled(),
    getConfig<Record<string, number>>("points.types", DEFAULT_POINTS),
    getConfig<Record<string, number>>("points.sources", DEFAULT_SOURCE_WEIGHTS),
  ]);

  const leafSkills = actives
    .filter((a) => !PARENT_CATEGORY_NAMES.has(a.name))
    .map((a) => ({ id: a.id, display: a.display }));

  const shelf = await shelfTelemetry();

  return (
    <main>
      <h1>Admin console</h1>
      <p className="lede">
        Manage the candidate skill taxonomy, AI gateway routes, economics
        readouts, quiz telemetry, spot-review queue, feature flags, and waitlist
        invite codes.
      </p>

      {alerts.length > 0 && (
        <div className="alert alert-danger" role="alert">
          Budget alert (D5): platform AI spend crossed the monthly tripwire (
          {alerts
            .map((a) => `${a.month}: $${a.amountUsd.toFixed(2)}`)
            .join(", ")}
          ).
        </div>
      )}

      <section className="section-card">
        <h2>Economics dashboard (D43)</h2>
        <div
          className="row"
          style={{ gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}
        >
          <div>
            <span className="muted">Actual Platform Spend: </span>
            <strong className="tabular">
              ${economics.actuals.totalSpendUsd.toFixed(4)}
            </strong>{" "}
            <span className="muted tabular">
              ({economics.actuals.totalCalls} calls)
            </span>
          </div>
          <div>
            <span className="muted">Projected Monthly Total: </span>
            <strong className="tabular">
              ${economics.projections.totalMonthlyCostUsd.toFixed(2)}/mo
            </strong>{" "}
            <span className="muted tabular">
              (${economics.projections.fixedServerCostUsd.toFixed(2)} fixed + $
              {economics.projections.projectedMonthlyAiSpendUsd.toFixed(2)} AI
              for {economics.projections.assumptions.activeUsers} users)
            </span>
          </div>
          <div>
            <span className="muted">Break-Even Price Floor: </span>
            <strong className="tabular">
              ${economics.breakEven.priceFloorPerPaidUserUsd.toFixed(2)}/user/mo
            </strong>{" "}
            <span className="muted tabular">
              (at {Math.round(economics.breakEven.targetMargin * 100)}% margin)
            </span>
          </div>
          <div>
            <span className="muted">JD Storage Watch (D61): </span>
            <strong className="tabular">
              {economics.jdStorage.totalJdCount} total JDs
            </strong>{" "}
            <span className="muted tabular">
              (soft cap: {economics.jdStorage.softCapPerUser}/user)
            </span>
          </div>
        </div>

        {economics.actuals.byFeatureDay.length === 0 ? (
          <p className="empty-state">No platform AI usage rows recorded yet.</p>
        ) : (
          <ul className="item-list">
            {economics.actuals.byFeatureDay.slice(0, 15).map((row) => (
              <li
                key={`${row.feature}-${row.date}`}
                className="item-row row-between"
              >
                <div className="row">
                  <code>{row.feature}</code>
                  <span className="muted tabular">{row.date}</span>
                </div>
                <span className="tabular">
                  {row.calls} call(s) · ${row.spendUsd.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-card">
        <h2>Evidence readouts (D68)</h2>
        <div className="stack">
          <div>
            <h3>Level Distribution per Skill</h3>
            {readouts.levelDistribution.length === 0 ? (
              <p className="empty-state">No evidenced skills recorded yet.</p>
            ) : (
              <ul className="item-list">
                {readouts.levelDistribution.slice(0, 15).map((row) => (
                  <li key={row.skillId} className="item-row row-between">
                    <div className="row">
                      <strong>{row.skillDisplay}</strong>
                      {row.isFlat && (
                        <span className="badge badge-warning">
                          flat distribution
                        </span>
                      )}
                    </div>
                    <span className="tabular muted">
                      {[0, 1, 2, 3, 4, 5]
                        .map((lvl) => `L${lvl}:${row.levels[lvl] ?? 0}`)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>Source Mix</h3>
            {readouts.sourceMix.length === 0 ? (
              <p className="empty-state">No evidence events recorded yet.</p>
            ) : (
              <ul className="item-list">
                {readouts.sourceMix.map((mix) => (
                  <li
                    key={`${mix.type}-${mix.source}`}
                    className="item-row row-between"
                  >
                    <div className="row">
                      <code>{mix.type}</code>
                      <span className="badge">{mix.source}</span>
                    </div>
                    <span className="tabular">
                      {mix.count} event(s) · {mix.totalPoints} pts
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>Top Movers</h3>
            {readouts.topMovers.length === 0 ? (
              <p className="empty-state">No skill score movement yet.</p>
            ) : (
              <ul className="item-list">
                {readouts.topMovers.map((mover) => (
                  <li
                    key={`${mover.userId}-${mover.skillId}`}
                    className="item-row row-between"
                  >
                    <strong>{mover.skillDisplay}</strong>
                    <span className="tabular">
                      L{mover.level} ({mover.score} pts)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>Evidence vs Quiz Divergence</h3>
            {!readouts.evidenceVsQuizDivergence.sufficientSample ||
            readouts.evidenceVsQuizDivergence.rows.length === 0 ? (
              <p className="empty-state">
                {readouts.evidenceVsQuizDivergence.note}
              </p>
            ) : (
              <ul className="item-list">
                {readouts.evidenceVsQuizDivergence.rows.map((row) => (
                  <li key={row.skillId} className="item-row row-between">
                    <div className="row">
                      <strong>{row.skillDisplay}</strong>
                      <span className="muted tabular">
                        ({row.userCount} users holding both)
                      </span>
                    </div>
                    <div className="row tabular">
                      <span>
                        Evidenced avg L{row.evidencedLevel.toFixed(2)} vs Quiz
                        avg L{row.quizLevel.toFixed(2)} (delta{" "}
                        {row.divergenceDelta >= 0 ? "+" : ""}
                        {row.divergenceDelta.toFixed(2)})
                      </span>
                      <span className="badge">
                        L0-1:{row.settledBands["L0-1"]} · L2-3:
                        {row.settledBands["L2-3"]} · L4-5:
                        {row.settledBands["L4-5"]}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="section-card">
        <h2>Quiz telemetry (D59 / D77)</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Aggregate-only telemetry over calibration sessions and answers. Each
          readout renders only above its configured minimum sample threshold (
          <code>telemetry.minimums</code>) and shows an honest &quot;Not enough
          data&quot; state below N.
        </p>

        {quizTelemetry.brokenQuestionAlerts.length > 0 && (
          <div
            className="alert alert-danger"
            role="alert"
            style={{ marginBottom: "1rem" }}
          >
            <strong>
              Broken-question alert ({quizTelemetry.brokenQuestionAlerts.length}
              ):
            </strong>{" "}
            {quizTelemetry.brokenQuestionAlerts
              .map(
                (q) =>
                  `${q.skillDisplay} (${q.band}): ${(q.successRate * 100).toFixed(0)}% success across ${q.answerCount} answers`
              )
              .join("; ")}{" "}
            (auto-flagged into the spot-review queue below).
          </div>
        )}

        <div className="stack">
          <div>
            <h3>
              Completion Rate per Bank (min{" "}
              {quizTelemetry.completionRate.minimumRequired} sessions)
            </h3>
            {!quizTelemetry.completionRate.sufficientSample ? (
              <p className="empty-state">
                {quizTelemetry.completionRate.statusNote}
              </p>
            ) : (
              <ul className="item-list">
                {quizTelemetry.completionRate.rows.map((r) => (
                  <li
                    key={`${r.skillId}-v${r.bankVersion}`}
                    className="item-row row-between"
                  >
                    <div>
                      <strong>{r.skillDisplay}</strong>{" "}
                      <span className="muted">v{r.bankVersion}</span>
                    </div>
                    <span className="tabular">
                      {(r.completionRate * 100).toFixed(1)}% completed (
                      {r.completedSessions}/{r.totalSessions} sessions)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>
              Drop-Off Question Index (min{" "}
              {quizTelemetry.dropOffIndex.minimumRequired} sessions)
            </h3>
            {!quizTelemetry.dropOffIndex.sufficientSample ? (
              <p className="empty-state">
                {quizTelemetry.dropOffIndex.statusNote}
              </p>
            ) : quizTelemetry.dropOffIndex.rows.length === 0 ? (
              <p className="empty-state">
                No abandoned sessions recorded across{" "}
                {quizTelemetry.dropOffIndex.totalSessionsSampled} sampled
                sessions.
              </p>
            ) : (
              <ul className="item-list">
                {quizTelemetry.dropOffIndex.rows.map((r) => (
                  <li
                    key={`dropoff-${r.questionIndex}`}
                    className="item-row row-between"
                  >
                    <strong>Question #{r.questionIndex}</strong>
                    <span className="tabular">
                      {r.droppedSessions} abandon(s) (
                      {(r.shareOfAbandons * 100).toFixed(1)}%)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>
              Per-Question Success Rate (min{" "}
              {quizTelemetry.perQuestionSuccess.minimumRequired} answers)
            </h3>
            {!quizTelemetry.perQuestionSuccess.sufficientSample ? (
              <p className="empty-state">
                {quizTelemetry.perQuestionSuccess.statusNote}
              </p>
            ) : (
              <ul className="item-list">
                {quizTelemetry.perQuestionSuccess.rows.slice(0, 20).map((q) => (
                  <li key={q.questionId} className="item-row row-between">
                    <div className="row">
                      <strong>{q.skillDisplay}</strong>
                      <span className="badge">{q.band}</span>
                      <span className="muted">{q.prompt}</span>
                    </div>
                    <div className="row tabular">
                      <span>
                        {(q.successRate * 100).toFixed(1)}% ({q.correctCount}/
                        {q.answerCount})
                      </span>
                      {q.flaggedBroken && (
                        <span className="badge badge-warning">
                          flagged broken
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>
              Retake Frequency ({quizTelemetry.retakeFrequency.windowDays}-day
              window, min {quizTelemetry.retakeFrequency.minimumRequired}{" "}
              completed sessions)
            </h3>
            {!quizTelemetry.retakeFrequency.sufficientSample ||
            !quizTelemetry.retakeFrequency.data ? (
              <p className="empty-state">
                {quizTelemetry.retakeFrequency.statusNote}
              </p>
            ) : (
              <div className="item-row row-between tabular">
                <span>
                  {quizTelemetry.retakeFrequency.data.retakeSessions} retake
                  session(s) across{" "}
                  {quizTelemetry.retakeFrequency.data.totalCompletedSessions}{" "}
                  completed session(s)
                </span>
                <strong>
                  {(
                    quizTelemetry.retakeFrequency.data.retakeRate * 100
                  ).toFixed(1)}
                  % retake rate
                </strong>
              </div>
            )}
          </div>

          <div>
            <h3>
              Time per Question (min{" "}
              {quizTelemetry.timePerQuestion.minimumRequired} timed answers)
            </h3>
            {!quizTelemetry.timePerQuestion.sufficientSample ? (
              <p className="empty-state">
                {quizTelemetry.timePerQuestion.statusNote}
              </p>
            ) : (
              <div className="item-row row-between tabular">
                <span>
                  Overall avg: {quizTelemetry.timePerQuestion.overallAvgMs ?? 0}{" "}
                  ms across {quizTelemetry.timePerQuestion.totalAnswersSampled}{" "}
                  answers
                </span>
                <div className="row">
                  {quizTelemetry.timePerQuestion.byBand.map((b) => (
                    <span key={b.band} className="badge">
                      {b.band}: {b.avgMs} ms ({b.answerCount})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="section-card">
        <h2>
          Quiz bank spot-review queue (D59 / D78b) (
          {quizTelemetry.spotReviewQueue.length})
        </h2>
        <div
          className="row-between"
          style={{ flexWrap: "wrap", marginBottom: "0.75rem" }}
        >
          <div className="row">
            <span className="muted">Publishing mode:</span>
            <span
              className={
                strictReviewGating
                  ? "badge badge-warning"
                  : "badge badge-success"
              }
            >
              {strictReviewGating
                ? "Strict review gating (needs_review before live)"
                : "Lint-gated auto-live (async spot review)"}
            </span>
          </div>
          <form action={toggleStrictReviewGatingAction}>
            <input
              type="hidden"
              name="enabled"
              value={strictReviewGating ? "false" : "true"}
            />
            <button type="submit" className="btn btn-sm">
              {strictReviewGating
                ? "Switch to lint-gated auto-live"
                : "Switch to strict review gating"}
            </button>
          </form>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <GenerateQuizBanksForm leafSkills={leafSkills} />
        </div>

        {quizTelemetry.spotReviewQueue.length === 0 ? (
          <p className="empty-state">
            No quiz banks in the spot-review queue yet. Generate banks above or
            take a skill quiz to populate banks.
          </p>
        ) : (
          <ul className="item-list">
            {quizTelemetry.spotReviewQueue.map((item) => (
              <li key={item.bankId} className="item-row stack">
                <div className="row-between" style={{ flexWrap: "wrap" }}>
                  <div className="row">
                    <strong>{item.skillDisplay}</strong>
                    <span className="badge">{item.band}</span>
                    <span className="muted tabular">
                      v{item.version} ({item.questionCount} questions)
                    </span>
                    <span
                      className={
                        item.status === "live"
                          ? "badge badge-success"
                          : "badge badge-warning"
                      }
                    >
                      {item.status}
                    </span>
                  </div>
                  <div className="row">
                    {item.status === "needs_review" && (
                      <form action={approveQuizBankReviewAction}>
                        <input
                          type="hidden"
                          name="bankId"
                          value={item.bankId}
                        />
                        <button
                          type="submit"
                          className="btn btn-sm btn-primary"
                        >
                          Approve live
                        </button>
                      </form>
                    )}
                    <form action={retireAndReplaceQuizBankAction}>
                      <input type="hidden" name="bankId" value={item.bankId} />
                      <button type="submit" className="btn btn-sm btn-danger">
                        Retire &amp; regenerate
                      </button>
                    </form>
                  </div>
                </div>
                {item.flaggedQuestions.length > 0 && (
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    Flagged broken questions ({item.flaggedQuestions.length}):{" "}
                    {item.flaggedQuestions
                      .map(
                        (fq) =>
                          `"${fq.prompt}" (${(fq.successRate * 100).toFixed(0)}% over ${fq.answerCount} answers)`
                      )
                      .join("; ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {replayFlags.whatIfEnabled && (
        <section className="section-card">
          <h2>What-if replay &amp; guarded apply (D47 / D68)</h2>
          <WhatIfReplayPanel
            initialPoints={pointsConfig}
            initialSourceWeights={sourceWeightsConfig}
            applyEnabled={replayFlags.applyEnabled}
          />
        </section>
      )}

      <section className="section-card">
        <h2>Candidate skill queue ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <p className="empty-state">
            Candidate queue is empty. Newly proposed user skill tags will appear
            here for review.
          </p>
        ) : (
          <ul className="item-list">
            {candidates.map((c) => (
              <li key={c.id} className="item-row row-between">
                <div className="row">
                  <strong>{c.display}</strong>
                  <code>{c.name}</code>
                </div>
                <div className="row">
                  <form action={approveCandidateAction}>
                    <input type="hidden" name="skillId" value={c.id} />
                    <button type="submit" className="btn btn-sm btn-primary">
                      Approve
                    </button>
                  </form>
                  <form action={mergeCandidateAction} className="row">
                    <input type="hidden" name="skillId" value={c.id} />
                    <select name="targetId" aria-label="Merge target skill">
                      {actives.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.display}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn btn-sm">
                      Merge to alias
                    </button>
                  </form>
                  <form action={rejectCandidateAction}>
                    <input type="hidden" name="skillId" value={c.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-card">
        <h2>Gateway smoke probe (D37d)</h2>
        <p className="muted">
          Routes are data rows: editing the routing table swaps providers
          without redeploying.
        </p>
        {routes.length === 0 ? (
          <p className="empty-state" style={{ marginBottom: "1rem" }}>
            No provider routes seeded yet. Run <code>npm run db:seed</code>.
          </p>
        ) : (
          <ul className="item-list" style={{ marginBottom: "1rem" }}>
            {routes.map((r) => (
              <li key={r.id} className="item-row row-between">
                <div className="row">
                  <code>{r.feature}</code>
                  <span>
                    {r.provider} / {r.model}
                  </span>
                </div>
                <span
                  className={
                    r.isActive ? "badge badge-success" : "badge badge-warning"
                  }
                >
                  {r.isActive ? "active" : "inactive"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ProbeButton />
      </section>

      <section className="section-card">
        <h2>Storage probe (D64)</h2>
        <p className="muted">
          Verifies Cloudflare R2 private bucket operations (put, get,
          short-lived signed URL, delete) through the storage service seam.
        </p>
        <StorageProbeButton />
      </section>

      <section className="section-card">
        <h2>Skill definitions (D70)</h2>
        <p className="muted">
          Lazy-generated once per canonical skill via the AI gateway and cached
          by content hash (D4) for gap-map explainers.
        </p>
        <GenerateDefinitionsButton
          initialWithDef={
            actives.filter(
              (a) => a.definition && a.definition.trim().length > 0
            ).length
          }
          totalActive={actives.length}
        />
      </section>

      <section className="section-card">
        <h2>Feature flags (D6)</h2>
        <div
          className="row"
          style={{ gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}
        >
          <form action={toggleReplayFlagsAction}>
            <input type="hidden" name="flagType" value="whatIf" />
            <input
              type="hidden"
              name="enabled"
              value={replayFlags.whatIfEnabled ? "false" : "true"}
            />
            <button type="submit" className="btn btn-sm">
              {replayFlags.whatIfEnabled
                ? "Disable replay.whatIf"
                : "Enable replay.whatIf"}
            </button>
          </form>
          <form action={toggleReplayFlagsAction}>
            <input type="hidden" name="flagType" value="apply" />
            <input
              type="hidden"
              name="enabled"
              value={replayFlags.applyEnabled ? "false" : "true"}
            />
            <button type="submit" className="btn btn-sm">
              {replayFlags.applyEnabled
                ? "Disable replay.apply"
                : "Enable replay.apply"}
            </button>
          </form>
        </div>
        {flags.length === 0 ? (
          <p className="empty-state">
            No feature flags registered yet. Flags are created on first toggle
            or gateway check.
          </p>
        ) : (
          <ul className="item-list">
            {flags.map((f) => (
              <li key={f.key} className="item-row row-between">
                <div className="row">
                  <code>{f.key}</code>
                  <span
                    className={
                      f.enabled ? "badge badge-success" : "badge badge-warning"
                    }
                  >
                    {f.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <form action={setFlagAction}>
                  <input type="hidden" name="key" value={f.key} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={f.enabled ? "false" : "true"}
                  />
                  <button type="submit" className="btn btn-sm">
                    Toggle
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-card">
        <h2>Invite codes (D7 ramp)</h2>
        <div className="row-between" style={{ marginBottom: "1rem" }}>
          <span className="muted tabular">
            {waitlist.length} waitlist email(s) captured
          </span>
          <form action={createInviteCodeAction}>
            <button type="submit" className="btn btn-primary">
              Mint invite code
            </button>
          </form>
        </div>
        {codes.length === 0 ? (
          <p className="empty-state">
            No invite codes minted yet. Click &quot;Mint invite code&quot; above
            to issue one.
          </p>
        ) : (
          <ul className="item-list">
            {codes.slice(0, 20).map((c) => (
              <li key={c.id} className="item-row row-between">
                <code>{c.code}</code>
                <span
                  className={c.redeemedAt ? "badge" : "badge badge-success"}
                >
                  {c.redeemedAt
                    ? `Redeemed ${c.redeemedAt.toISOString().slice(0, 10)}`
                    : "Unused"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-card">
        <h2>Grader eval — golden set (D83/D88g)</h2>
        <p className="muted">
          On-demand LLM run over the {GOLDEN_COUNT} synthetic transcripts (3
          independent gradings each — paid). Unanimous bands auto-anchor; splits
          queue for your rank/band adjudication. The weekly drift cron records
          the same run automatically. Deterministic asserts (citations,
          validation) already run in every <code>npm run check</code>.
        </p>
        <GoldenRunButton estimateUsd={estimateUsd} />
        {pendingFixtures.length > 0 ? (
          <div className="stack">
            <h3>Pending adjudication</h3>
            <ul className="item-list">
              {pendingFixtures.map((fixtureId) => (
                <li key={fixtureId} className="item-row row-between">
                  <span>{fixtureId}</span>
                  <form action={setEvalAnchorAction} className="row">
                    <input type="hidden" name="fixtureId" value={fixtureId} />
                    <select name="band" defaultValue="Developing">
                      <option>Developing</option>
                      <option>Ready</option>
                      <option>Strong</option>
                    </select>
                    <button type="submit" className="btn">
                      Set anchor
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {latestRun ? (
          <div className="stack">
            <h3>
              Latest run {latestRun.runId} (
              {new Date(latestRun.at).toISOString().slice(0, 16)} UTC)
            </h3>
            <ul className="item-list">
              {latestRun.results.map((r) => (
                <li key={r.fixtureId} className="item-row row-between">
                  <span>
                    {r.fixtureId} · {r.label}
                  </span>
                  <span className={r.drift ? "badge badge-warn" : "badge"}>
                    {r.bands.join(" / ")}{" "}
                    {r.anchorBand ? `· anchor ${r.anchorBand}` : "· unanchored"}
                    {r.drift ? " · DRIFT" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">No runs recorded yet.</p>
        )}
        <div className="stack">
          <h3>Interview transcript storage (D82 tiering)</h3>
          <p className="muted">
            {storageReadout.sessionsWithTurns} session(s) holding transcripts in
            Postgres — {Math.round(storageReadout.transcriptBytes / 1024)} KB of{" "}
            {Math.round(storageReadout.thresholdBytes / 1024)} KB threshold.
            {storageReadout.overThreshold
              ? " Over threshold: tier to R2 from the queue or force now."
              : " Under threshold — stay in Postgres."}
          </p>
          <form action={tierTranscriptsAction}>
            <input type="hidden" name="force" value="true" />
            <button type="submit" className="btn">
              Force tier to R2 now
            </button>
          </form>
        </div>
        <div className="stack">
          <h3>Voice cost bench (benched stack, D87)</h3>
          <p className="muted">
            Candidate stacks and refreshed numbers live in
            <code> docs/prior-art/interview-ai.md</code> (Oct 2026: OpenAI
            Realtime ≈ $1.20–2.70/session; Retell/Vapi ≈ $2.10–9.30; self-hosted
            Pipecat ≈ $0.75–1.50). The bench script is
            <code> scripts/voice-bench.ts</code> — on-demand only, each run
            bills real provider minutes. Un-bench ladder: harness-voice via the
            MCP skill file first (user tokens), platform voice only with paying
            users + demand signal (current demand count: {voiceDemand}).
          </p>
        </div>
      </section>
      <section className="section-card">
        <h2>Discover shelf (S3a)</h2>
        <div className="stack">
          <h3>
            Card CTR (aggregate, min {shelf.minImpressions} impressions — D77
            minimums)
          </h3>
          {shelf.repoCtr.length === 0 ? (
            <p className="muted">Not enough impressions yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Repo</th>
                  <th>Shown</th>
                  <th>Clicked</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {shelf.repoCtr.slice(0, 10).map((r) => (
                  <tr key={r.repo}>
                    <td>{r.repo}</td>
                    <td>{r.shown}</td>
                    <td>{r.clicked}</td>
                    <td>{(r.ctr * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Top unmatched topics (D91 readout — add these as aliases)</h3>
          {shelf.topUnmatched.length === 0 ? (
            <p className="muted">No unmatched topics recorded yet.</p>
          ) : (
            <ul>
              {shelf.topUnmatched.map((t) => (
                <li key={t.topic}>
                  <code>{t.topic}</code> × {t.count}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Shown-200/clicked-0 repos are scoring misses — tune the
            <code> discover.weights</code> config row.
          </p>
        </div>
      </section>
    </main>
  );
}
