import { getSessionUser } from "@/lib/auth";
import { listTokens } from "@/services/tokens";
import { TokenCreator, TokenRevoke } from "@/components/token-manager";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const user = await getSessionUser();
  if (!user) {
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
  }
  const tokens = await listTokens(user.id);

  return (
    <main>
      <h1>Agent API tokens</h1>
      <p>
        For coding agents / MCP tools acting as you (D29). Requests carry
        <code> Authorization: Bearer gldos_…</code> and are recorded with source
        agent_plugin or extension.
      </p>
      <TokenCreator />
      <ul>
        {tokens.map((t) => (
          <li key={t.id}>
            <code>{t.prefix}…</code> · {t.name} ·{" "}
            {t.revokedAt
              ? "revoked"
              : `created ${t.createdAt.toISOString().slice(0, 10)}`}{" "}
            {!t.revokedAt && <TokenRevoke tokenId={t.id} />}
          </li>
        ))}
        {tokens.length === 0 && <li>No tokens yet.</li>}
      </ul>
    </main>
  );
}
