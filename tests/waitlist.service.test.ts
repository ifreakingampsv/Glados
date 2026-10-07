import { afterAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  createInviteCode,
  isGateOpen,
  joinWaitlist,
  redeemInviteCode,
} from "@/services/waitlist";

const marker = `t03_${Date.now()}`;
const email = `${marker}@example.com`;

async function makeUser(role: "USER" | "ADMIN"): Promise<User> {
  return db.user.create({
    data: {
      clerkId: `${marker}_${role}_${Math.random().toString(36).slice(2, 6)}`,
      role,
    },
  });
}

afterAll(async () => {
  await db.user.deleteMany({
    where: { clerkId: { startsWith: `${marker}_` } },
  });
  await db.waitlistEmail.deleteMany({ where: { email } });
  await db.inviteCode.deleteMany({
    where: { createdBy: { startsWith: `${marker}_` } },
  });
});

describe("waitlist (T03: emails, codes, gate)", () => {
  it("captures a waitlist email once (dedupe)", async () => {
    await joinWaitlist(email);
    await joinWaitlist(`  ${email.toUpperCase()} `);
    const rows = await db.waitlistEmail.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
  });

  it("rejects malformed emails", async () => {
    await expect(joinWaitlist("not-an-email")).rejects.toThrow("invalid email");
  });

  it("only lets admins mint invite codes", async () => {
    const [user, admin] = await Promise.all([
      makeUser("USER"),
      makeUser("ADMIN"),
    ]);
    await expect(createInviteCode(user)).rejects.toThrow("admin role required");
    const code = await createInviteCode(admin);
    expect(code.code).toHaveLength(8);
  });

  it("redeems a code exactly once and opens the gate", async () => {
    const [user, admin] = await Promise.all([
      makeUser("USER"),
      makeUser("ADMIN"),
    ]);
    const { code } = await createInviteCode(admin);

    expect(isGateOpen(user)).toBe(false);
    const redeemed = await redeemInviteCode(user, code);
    expect(isGateOpen(redeemed)).toBe(true);

    const second = await db.user.create({
      data: { clerkId: `${marker}_second` },
    });
    await expect(redeemInviteCode(second, code)).rejects.toThrow(
      "invalid or already-used"
    );
    await expect(redeemInviteCode(second, "nope")).rejects.toThrow(
      "invalid or already-used"
    );
  });
});
