import { getSessionUser } from "@/lib/auth";
import { listCredentials } from "@/services/credentials";
import { getOrCreateEnergyAccount } from "@/services/energy";
import {
  addCredentialAction,
  deleteCredentialAction,
} from "@/app/actions/gateway";

export const dynamic = "force-dynamic";

const PROVIDERS = ["google", "openrouter", "atria-dawn"];

export default async function GatewayPage() {
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
  const [credentials, energy] = await Promise.all([
    listCredentials(user.id),
    getOrCreateEnergyAccount(user.id),
  ]);

  return (
    <main>
      <h1>AI credentials &amp; energy</h1>
      <p className="lede">
        Paste your own provider key once. Keys are encrypted at rest with
        AES-256-GCM, masked to the last 4 characters, and used automatically
        before the platform&apos;s metered route.
      </p>

      <section className="section-card">
        <h2>Saved provider keys</h2>
        {credentials.length === 0 ? (
          <p className="empty-state" style={{ marginBottom: "1rem" }}>
            No BYO keys saved yet. Calls use the platform route
            (energy-metered).
          </p>
        ) : (
          <ul className="item-list" style={{ marginBottom: "1rem" }}>
            {credentials.map(
              (c: { id: string; provider: string; last4: string }) => (
                <li key={c.id} className="item-row row-between">
                  <div className="row">
                    <strong>{c.provider}</strong>
                    <code>····{c.last4}</code>
                  </div>
                  <form action={deleteCredentialAction}>
                    <input type="hidden" name="credentialId" value={c.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Remove
                    </button>
                  </form>
                </li>
              )
            )}
          </ul>
        )}
        <form action={addCredentialAction} className="row">
          <select name="provider" aria-label="AI provider">
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            name="apiKey"
            type="password"
            placeholder="sk-..."
            aria-label="Provider API key"
            required
          />
          <button type="submit" className="btn btn-primary">
            Save key
          </button>
        </form>
      </section>

      <section className="section-card">
        <h2>Energy balance</h2>
        <div className="row" style={{ marginBottom: "0.5rem" }}>
          <span className="badge badge-accent tabular">
            {energy.balance.toFixed(2)} / 3.00 bars
          </span>
        </div>
        <p className="muted">
          1 bar equals worst-case $0.10 of platform AI spend. Daily grant +1 bar
          (bank capped at 3), plus +1 weekly bonus bar for logging verified
          evidence. BYO key calls never drain energy.
        </p>
      </section>
    </main>
  );
}
