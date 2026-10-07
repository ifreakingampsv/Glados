import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listCandidates } from "@/services/skill-admin";
import { listInviteCodes, listWaitlist } from "@/services/waitlist";
import { ProbeButton } from "@/components/probe-button";
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
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
  }
  if (user.role !== "ADMIN") {
    return (
      <p>
        Admin role required (seed manually: update your users row role = ADMIN).
      </p>
    );
  }

  const [candidates, actives, codes, waitlist, flags, alerts, routes] =
    await Promise.all([
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
    ]);

  return (
    <main>
      <h1>Admin</h1>

      {alerts.length > 0 && (
        <p style={{ background: "#ffe8e8", padding: "0.5rem" }}>
          ⚠️ Budget alert (D5): platform AI spend crossed the tripwire —{" "}
          {alerts
            .map((a) => `${a.month}: $${a.amountUsd.toFixed(2)}`)
            .join(", ")}
        </p>
      )}

      <section>
        <h2>Candidate skill queue</h2>
        <ul>
          {candidates.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.8rem" }}>
              <strong>{c.display}</strong> <code>{c.name}</code>
              <div>
                <form
                  action={approveCandidateAction}
                  style={{ display: "inline" }}
                >
                  <input type="hidden" name="skillId" value={c.id} />
                  <button type="submit">approve</button>
                </form>{" "}
                <form
                  action={mergeCandidateAction}
                  style={{ display: "inline" }}
                >
                  <input type="hidden" name="skillId" value={c.id} />
                  <select name="targetId">
                    {actives.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.display}
                      </option>
                    ))}
                  </select>
                  <button type="submit">merge → alias</button>
                </form>{" "}
                <form
                  action={rejectCandidateAction}
                  style={{ display: "inline" }}
                >
                  <input type="hidden" name="skillId" value={c.id} />
                  <button type="submit">reject</button>
                </form>
              </div>
            </li>
          ))}
          {candidates.length === 0 && <li>Queue empty.</li>}
        </ul>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Gateway smoke probe (D37d)</h2>
        <p>
          Routes are data rows — editing the table swaps providers without
          redeploying (D26).
        </p>
        <ul>
          {routes.map((r) => (
            <li key={r.id}>
              {r.feature} → {r.provider}/{r.model}{" "}
              {r.isActive ? "" : "(inactive)"}
            </li>
          ))}
        </ul>
        <ProbeButton />
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Feature flags (D6)</h2>
        <ul>
          {flags.map((f) => (
            <li key={f.key}>
              <code>{f.key}</code> — {f.enabled ? "on" : "off"}{" "}
              <form action={setFlagAction} style={{ display: "inline" }}>
                <input type="hidden" name="key" value={f.key} />
                <input
                  type="hidden"
                  name="enabled"
                  value={f.enabled ? "false" : "true"}
                />
                <button type="submit">toggle</button>
              </form>
            </li>
          ))}
          {flags.length === 0 && (
            <li>
              No flags yet — created on first toggle or gateway registration.
            </li>
          )}
        </ul>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Invite codes (D7 ramp)</h2>
        <form action={createInviteCodeAction}>
          <button type="submit">Mint code</button>
        </form>
        <ul>
          {codes.slice(0, 20).map((c) => (
            <li key={c.id}>
              <code>{c.code}</code> —{" "}
              {c.redeemedAt
                ? `redeemed ${c.redeemedAt.toISOString()}`
                : "unused"}
            </li>
          ))}
        </ul>
        <p>{waitlist.length} waitlist emails.</p>
      </section>
    </main>
  );
}
