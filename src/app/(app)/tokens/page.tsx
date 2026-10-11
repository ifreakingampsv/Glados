import { getSessionUser } from "@/lib/auth";
import { listTokens } from "@/services/tokens";
import { TokenCreator, TokenRevoke } from "@/components/token-manager";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
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
  const tokens = await listTokens(user.id);

  return (
    <main>
      <h1>Agent API tokens</h1>
      <p className="lede">
        Mint personal API tokens for coding agents or MCP tools acting on your
        behalf. Requests carry <code>Authorization: Bearer gldos_...</code> and
        are recorded with source <code>agent_plugin</code> or{" "}
        <code>extension</code>.
      </p>

      <section className="section-card">
        <h2>Mint a new token</h2>
        <TokenCreator />
      </section>

      <section className="section-card">
        <h2>Issued tokens ({tokens.length})</h2>
        {tokens.length === 0 ? (
          <p className="empty-state">
            No API tokens created yet. Mint one above when connecting an agent.
          </p>
        ) : (
          <ul className="item-list">
            {tokens.map((t) => (
              <li key={t.id} className="item-row row-between">
                <div className="row">
                  <code>{t.prefix}...</code>
                  <strong>{t.name}</strong>
                  <span className="badge tabular">
                    {t.revokedAt
                      ? "Revoked"
                      : `Created ${t.createdAt.toISOString().slice(0, 10)}`}
                  </span>
                </div>
                {!t.revokedAt && <TokenRevoke tokenId={t.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
