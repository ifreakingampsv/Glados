import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, type ApiToken, type User } from "@/lib/db";
import type { Source } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";

// D35: GitHub-PAT pattern — full value shown once; prefix stored for lookup.
export interface CreatedToken {
  token: string;
  record: ApiToken;
}

export async function createToken(
  userId: string,
  name: string
): Promise<CreatedToken> {
  const prefix = randomBytes(4).toString("hex");
  // hex (not base64url): the token grammar is gldos_<prefix>_<secret>, so the
  // secret must never contain underscores.
  const secret = randomBytes(24).toString("hex");
  const token = `gldos_${prefix}_${secret}`;
  const record = await db.apiToken.create({
    data: {
      userId,
      name: name.trim() || "agent token",
      prefix,
      hash: sha256(token),
    },
  });
  return { token, record };
}

export async function authenticateToken(
  presented: string
): Promise<{ user: User; token: ApiToken } | null> {
  const parts = presented.split("_");
  if (parts.length !== 3 || parts[0] !== "gldos") return null;
  const record = await db.apiToken.findUnique({ where: { prefix: parts[1] } });
  if (!record || record.revokedAt) return null;

  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(sha256(presented), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;

  const updated = await db.apiToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });
  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user) return null;
  return { user, token: updated };
}

export async function revokeToken(userId: string, tokenId: string) {
  const token = await db.apiToken.findFirst({ where: { id: tokenId, userId } });
  if (!token) throw new Error("token not found");
  return db.apiToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
}

export function listTokens(userId: string) {
  return db.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// D35: token requests may declare agent_plugin | extension — never web or
// system. The channel is enforced server-side; client input can only narrow
// within the agent band.
export function resolveAgentSource(declared?: string | null): Source {
  if (declared === "agent_plugin" || declared === "extension") return declared;
  throw new Error(
    "token requests must declare source: agent_plugin | extension"
  );
}
