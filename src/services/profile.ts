import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// JSON-Resume top-level sections (D24-era S0 scope: field-dictionary shape).
export const PROFILE_SECTIONS = [
  "basics",
  "summary",
  "work",
  "education",
  "volunteer",
  "awards",
  "publications",
  "languages",
  "interests",
  "references",
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export function isProfileSection(key: string): key is ProfileSection {
  return (PROFILE_SECTIONS as readonly string[]).includes(key);
}

export async function getProfile(userId: string) {
  return db.profile.upsert({
    where: { userId },
    update: {},
    create: { userId, fields: {} },
  });
}

export async function updateProfileSection(
  userId: string,
  section: string,
  value: unknown
) {
  if (!isProfileSection(section)) {
    throw new Error(`unknown profile section: ${section}`);
  }
  const profile = await getProfile(userId);
  const fields = {
    ...(profile.fields as Record<string, unknown>),
    [section]: value,
  };
  return db.profile.update({
    where: { userId },
    data: { fields: fields as Prisma.InputJsonValue },
  });
}

export async function addTargetRole(
  userId: string,
  title: string,
  seniority?: string
) {
  if (!title.trim()) throw new Error("title required");
  const count = await db.targetRole.count({ where: { userId } });
  return db.targetRole.create({
    data: {
      userId,
      title: title.trim(),
      seniority: seniority?.trim() || null,
      isPrimary: count === 0,
    },
  });
}

// Exactly one primary (D37c): swap atomically in one transaction.
export async function setPrimaryRole(userId: string, roleId: string) {
  return db.$transaction(async (tx) => {
    const role = await tx.targetRole.findFirst({
      where: { id: roleId, userId },
    });
    if (!role) throw new Error("target role not found");
    await tx.targetRole.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false },
    });
    return tx.targetRole.update({
      where: { id: roleId },
      data: { isPrimary: true },
    });
  });
}

export function listTargetRoles(userId: string) {
  return db.targetRole.findMany({
    where: { userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

export async function removeTargetRole(userId: string, roleId: string) {
  const role = await db.targetRole.findFirst({ where: { id: roleId, userId } });
  if (!role) throw new Error("target role not found");
  await db.targetRole.delete({ where: { id: roleId } });
  if (role.isPrimary) {
    const next = await db.targetRole.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await db.targetRole.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
  }
}

export const KNOWN_PREFERENCE_KEYS = [
  "notification_email",
  "timezone",
  "briefing_enabled",
  "gap_map_mode",
] as const;

export async function setPreference(
  userId: string,
  key: string,
  value: string
) {
  if (!(KNOWN_PREFERENCE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`unknown preference key: ${key}`);
  }
  return db.preference.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  });
}

export function getPreferences(userId: string) {
  return db.preference.findMany({ where: { userId } });
}
