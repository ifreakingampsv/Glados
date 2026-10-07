import { auth } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/env";
import { ensureUser, getUserByClerkId } from "@/services/users";
import type { User } from "@prisma/client";

// D29/D35: source is DERIVED from the auth channel, never client input.
// Browser session → web. API token requests declare agent_plugin | extension
// (T11); server-internal callers use system.
export type Source = "web" | "agent_plugin" | "extension" | "system";

export interface AuthContext {
  user: User;
  source: Source;
}

// Resolves the signed-in browser user. Returns null when Clerk is not
// configured (local dev without keys) — pages render a setup notice then.
export async function getSessionUser(): Promise<User | null> {
  if (!isClerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;
  return (await getUserByClerkId(userId)) ?? (await ensureUser(userId));
}

export function assertAdmin(user: User): void {
  if (user.role !== "ADMIN") {
    throw new Error("forbidden: admin role required");
  }
}
