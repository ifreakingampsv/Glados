import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/auth";
import type { User } from "@prisma/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function joinWaitlist(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    throw new Error("invalid email");
  }
  return db.waitlistEmail.upsert({
    where: { email: normalized },
    update: {},
    create: { email: normalized },
  });
}

export async function createInviteCode(admin: User) {
  assertAdmin(admin);
  return db.inviteCode.create({
    data: {
      code: randomBytes(4).toString("hex"),
      createdBy: admin.id,
    },
  });
}

export async function redeemInviteCode(user: User, code: string) {
  if (user.invitedAt) {
    return user; // already unlocked
  }
  const claimed = await db.inviteCode.updateMany({
    where: { code: code.trim().toLowerCase(), redeemedAt: null },
    data: { redeemedBy: user.id, redeemedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new Error("invalid or already-used invite code");
  }
  return db.user.update({
    where: { id: user.id },
    data: { invitedAt: new Date() },
  });
}

export function isGateOpen(user: User): boolean {
  return user.invitedAt !== null || user.role === "ADMIN";
}

export async function listWaitlist() {
  return db.waitlistEmail.findMany({ orderBy: { createdAt: "desc" } });
}

export async function listInviteCodes() {
  return db.inviteCode.findMany({ orderBy: { createdAt: "desc" } });
}
