import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  getAdminEconomicsDashboard,
  getAdminEvidenceReadouts,
} from "@/services/economics";
import { listCandidates } from "@/services/skill-admin";
import { listInviteCodes, listWaitlist } from "@/services/waitlist";
import {
  GenerateDefinitionsButton,
  ProbeButton,
  StorageProbeButton,
} from "@/components/probe-button";
import {
  approveCandidateAction,
  createInviteCodeAction,
  mergeCandidateAction,
  rejectCandidateAction,
  setFlagAction,
} from "@/app/actions/admin";

export const dynamic = "force-dynamic";

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
  ]);

  return (
    <main>
      <h1>Admin console</h1>
      <p className="lede">
        Manage the candidate skill taxonomy, AI gateway routes, economics
        readouts, feature flags, and waitlist invite codes.
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
            <p className="empty-state">
              {readouts.evidenceVsQuizDivergence.note}
            </p>
          </div>
        </div>
      </section>

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
    </main>
  );
}
