import { db, type User } from "@/lib/db";
import { grantWelcomeBar } from "@/services/energy";

export interface ClerkEmail {
  id: string;
  email_address: string;
}

export interface ClerkUserData {
  id: string;
  email_addresses?: ClerkEmail[];
  primary_email_address_id?: string | null;
}

export interface ClerkEvent {
  type: string;
  data: ClerkUserData;
}

export function primaryEmail(data: ClerkUserData): string | null {
  const primary = data.email_addresses?.find(
    (e) => e.id === data.primary_email_address_id
  );
  return (
    primary?.email_address ?? data.email_addresses?.[0]?.email_address ?? null
  );
}

// Lazy backstop (D35): called on first use of a known Clerk identity.
export async function ensureUser(
  clerkId: string,
  email?: string | null
): Promise<User> {
  return db.user.upsert({
    where: { clerkId },
    update: email ? { email } : {},
    create: { clerkId, email: email ?? null },
  });
}

// Clerk is the identity source of truth (D35); this is the webhook-driven sync.
export async function handleClerkEvent(
  event: ClerkEvent
): Promise<User | null> {
  switch (event.type) {
    case "user.created": {
      const created = await ensureUser(event.data.id, primaryEmail(event.data));
      await grantWelcomeBar(created.id); // D84: idempotent under retries
      return created;
    }
    case "user.updated":
      return ensureUser(event.data.id, primaryEmail(event.data));
    case "user.deleted":
      return db.user
        .delete({ where: { clerkId: event.data.id } })
        .catch(() => null);
    default:
      return null;
  }
}

export async function getUserByClerkId(clerkId: string): Promise<User | null> {
  return db.user.findUnique({ where: { clerkId } });
}
