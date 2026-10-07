import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  addTargetRole,
  getPreferences,
  getProfile,
  listTargetRoles,
  removeTargetRole,
  setPreference,
  setPrimaryRole,
  updateProfileSection,
} from "@/services/profile";

let user: User;
const clerkId = `t04_${Date.now()}`;

beforeAll(async () => {
  user = await db.user.create({ data: { clerkId } });
});

afterAll(async () => {
  await db.profile.deleteMany({ where: { userId: user.id } });
  await db.targetRole.deleteMany({ where: { userId: user.id } });
  await db.preference.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
});

describe("profile dictionary (T04)", () => {
  it("creates an empty profile on first read and persists sections", async () => {
    const empty = await getProfile(user.id);
    expect(empty.fields).toEqual({});

    await updateProfileSection(user.id, "basics", {
      name: "Ash",
      email: "ash@example.com",
    });
    await updateProfileSection(user.id, "work", [
      { company: "Hive", role: "Eng" },
    ]);
    const profile = await getProfile(user.id);
    expect(profile.fields).toEqual({
      basics: { name: "Ash", email: "ash@example.com" },
      work: [{ company: "Hive", role: "Eng" }],
    });
  });

  it("rejects unknown sections (dictionary stays JSON-Resume-shaped)", async () => {
    await expect(
      updateProfileSection(user.id, "favorite_food", "pizza")
    ).rejects.toThrow("unknown profile section");
  });
});

describe("target roles (T04: one primary)", () => {
  it("first role becomes primary automatically", async () => {
    const a = await addTargetRole(user.id, "Backend Engineer", "Junior");
    expect(a.isPrimary).toBe(true);
  });

  it("setting a new primary demotes the old one atomically", async () => {
    const a = (await listTargetRoles(user.id))[0];
    const b = await addTargetRole(user.id, "Platform Engineer");
    expect(b.isPrimary).toBe(false);

    await setPrimaryRole(user.id, b.id);
    const roles = await listTargetRoles(user.id);
    expect(roles.find((r) => r.id === a.id)?.isPrimary).toBe(false);
    expect(roles.find((r) => r.id === b.id)?.isPrimary).toBe(true);
  });

  it("promotes the oldest role when the primary is removed", async () => {
    const roles = await listTargetRoles(user.id);
    const primary = roles.find((r) => r.isPrimary)!;
    await removeTargetRole(user.id, primary.id);
    const after = await listTargetRoles(user.id);
    expect(after).toHaveLength(1);
    expect(after[0].isPrimary).toBe(true);
  });
});

describe("preferences (T04: allowlisted keys)", () => {
  it("stores a known key and rejects unknown keys", async () => {
    await setPreference(user.id, "timezone", "Asia/Kolkata");
    const prefs = await getPreferences(user.id);
    expect(prefs).toContainEqual(
      expect.objectContaining({ key: "timezone", value: "Asia/Kolkata" })
    );

    await expect(setPreference(user.id, "secret_key", "x")).rejects.toThrow(
      "unknown preference key"
    );
  });
});
