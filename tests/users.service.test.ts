import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  ensureUser,
  getUserByClerkId,
  handleClerkEvent,
  primaryEmail,
  type ClerkUserData,
} from "@/services/users";

const clerkId = `user_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const clerkUser = (overrides: Partial<ClerkUserData> = {}): ClerkUserData => ({
  id: clerkId,
  email_addresses: [{ id: "email_1", email_address: "spine@example.com" }],
  primary_email_address_id: "email_1",
  ...overrides,
});

afterAll(async () => {
  await db.user.deleteMany({ where: { clerkId } });
});

describe("users service (T02: Clerk sync + backstop)", () => {
  it("creates a local user on first use (lazy backstop)", async () => {
    const user = await ensureUser(clerkId, "first@example.com");
    expect(user.email).toBe("first@example.com");
    expect(user.role).toBe("USER");
  });

  it("upserts email on subsequent ensure (webhook update path)", async () => {
    await ensureUser(clerkId, "changed@example.com");
    const user = await getUserByClerkId(clerkId);
    expect(user?.email).toBe("changed@example.com");
  });

  it("extracts the primary email from a Clerk payload", () => {
    expect(primaryEmail(clerkUser())).toBe("spine@example.com");
    expect(
      primaryEmail({
        id: "x",
        email_addresses: [{ id: "a", email_address: "only@x.com" }],
      })
    ).toBe("only@x.com");
  });

  it("removes the local user on user.deleted", async () => {
    await handleClerkEvent({ type: "user.deleted", data: { id: clerkId } });
    expect(await getUserByClerkId(clerkId)).toBeNull();
  });
});
