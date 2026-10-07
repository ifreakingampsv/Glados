import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "@/lib/env";

// D26: BYO keys encrypted at rest under a KEK from env (never DB/code).
// Accepted limit: protects against leaks, not a compromised app server.
function kekKey(): Buffer {
  return createHash("sha256").update(env.gatewayKek).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kekKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const [ivB64, tagB64, dataB64] = blob.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    kekKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function last4(secret: string): string {
  return secret.slice(-4);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
