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
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
  }
  const [credentials, energy] = await Promise.all([
    listCredentials(user.id),
    getOrCreateEnergyAccount(user.id),
  ]);

  return (
    <main>
      <h1>AI credentials</h1>
      <p>
        Paste your own provider key once — it is encrypted at rest, masked here,
        and used automatically before the platform&apos;s capped route
        (D26/D34).
      </p>
      <ul>
        {credentials.map(
          (c: { id: string; provider: string; last4: string }) => (
            <li key={c.id}>
              <strong>{c.provider}</strong> ····{c.last4}{" "}
              <form
                action={deleteCredentialAction}
                style={{ display: "inline" }}
              >
                <input type="hidden" name="credentialId" value={c.id} />
                <button type="submit">remove</button>
              </form>
            </li>
          )
        )}
        {credentials.length === 0 && (
          <li>No keys yet — platform route only (energy-metered).</li>
        )}
      </ul>
      <form action={addCredentialAction}>
        <select name="provider">
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input name="apiKey" type="password" placeholder="sk-…" required />
        <button type="submit">Save key</button>
      </form>

      <section style={{ marginTop: "2rem" }}>
        <h2>Energy</h2>
        <p>
          Balance: {energy.balance.toFixed(2)} bars (1 bar ≈ worst-case $0.10 of
          platform AI). Daily grant +1, bank caps at 3, weekly earn for logging
          evidence. BYO calls never drain it.
        </p>
      </section>
    </main>
  );
}
