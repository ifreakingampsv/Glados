"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createJobDescription, deleteJobDescription } from "@/services/jd";
import { setGapMapModePreference, type GapMapMode } from "@/services/gap-map";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

export async function createJdAction(formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) {
    redirect("/gaps?error=empty-jd");
  }
  const created = await createJobDescription(user.id, {
    title: title || undefined,
    company: company || undefined,
    rawText,
  });
  revalidatePath("/gaps");
  revalidatePath("/resume");
  redirect(`/gaps?jdId=${created.id}`);
}

export async function deleteJdAction(formData: FormData) {
  const user = await requireUser();
  const jdId = String(formData.get("jdId") ?? "");
  await deleteJobDescription(user.id, jdId);
  revalidatePath("/gaps");
  revalidatePath("/resume");
}

export async function setGapModeAction(formData: FormData) {
  const user = await requireUser();
  const rawMode = String(formData.get("mode") ?? "resume");
  const mode: GapMapMode = rawMode === "profile" ? "profile" : "resume";
  await setGapMapModePreference(user.id, mode);
  revalidatePath("/gaps");
}
