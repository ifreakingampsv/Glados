import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, last4 } from "@/lib/crypto";

// D26: pasted once over HTTPS, encrypted server-side, decrypted ONLY in
// gateway memory, never logged, never returned to the client (mask to last 4).
export async function addCredential(
  userId: string,
  provider: string,
  apiKey: string
) {
  const key = apiKey.trim();
  if (!provider.trim()) throw new Error("provider required");
  if (key.length < 8) throw new Error("api key looks too short");
  return db.credential.upsert({
    where: { userId_provider: { userId, provider } },
    update: { data: encryptSecret(key), last4: last4(key) },
    create: { userId, provider, data: encryptSecret(key), last4: last4(key) },
  });
}

// Masked view only — the encrypted blob never leaves the server.
export function listCredentials(userId: string) {
  return db.credential.findMany({
    where: { userId },
    select: { id: true, provider: true, last4: true, createdAt: true },
    orderBy: { provider: "asc" },
  });
}

// The ONLY decryption path; called by the gateway per request, in memory.
export async function getDecryptedCredential(
  userId: string,
  provider: string
): Promise<string | null> {
  const credential = await db.credential.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  return credential ? decryptSecret(credential.data) : null;
}

export async function deleteCredential(userId: string, credentialId: string) {
  const credential = await db.credential.findFirst({
    where: { id: credentialId, userId },
  });
  if (!credential) throw new Error("credential not found");
  await db.credential.delete({ where: { id: credentialId } });
}
