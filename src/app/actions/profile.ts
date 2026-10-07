"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  addTargetRole,
  removeTargetRole,
  setPreference,
  setPrimaryRole,
  updateProfileSection,
} from "@/services/profile";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

export async function updateSectionAction(formData: FormData) {
  const user = await requireUser();
  const section = String(formData.get("section") ?? "");
  let value: unknown;
  try {
    value = JSON.parse(String(formData.get("value") ?? "null"));
  } catch {
    redirect("/profile?error=bad-json");
  }
  try {
    await updateProfileSection(user.id, section, value);
  } catch {
    redirect("/profile?error=bad-section");
  }
  revalidatePath("/profile");
}

export async function addRoleAction(formData: FormData) {
  const user = await requireUser();
  await addTargetRole(
    user.id,
    String(formData.get("title") ?? ""),
    String(formData.get("seniority") ?? "")
  );
  revalidatePath("/profile");
}

export async function setPrimaryAction(formData: FormData) {
  const user = await requireUser();
  await setPrimaryRole(user.id, String(formData.get("roleId") ?? ""));
  revalidatePath("/profile");
}

export async function removeRoleAction(formData: FormData) {
  const user = await requireUser();
  await removeTargetRole(user.id, String(formData.get("roleId") ?? ""));
  revalidatePath("/profile");
}

export async function setPreferenceAction(formData: FormData) {
  const user = await requireUser();
  try {
    await setPreference(
      user.id,
      String(formData.get("key") ?? ""),
      String(formData.get("value") ?? "")
    );
  } catch {
    redirect("/profile?error=bad-key");
  }
  revalidatePath("/profile");
}
