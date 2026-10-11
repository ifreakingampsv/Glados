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
import { parseResumeOrLinkedinTransient } from "@/services/resume-parse";
import {
  confirmWorkExperience,
  listWorkExperiences,
  promoteWorkExperienceToProject,
  setSelfAssessedSkillLevel,
  writeBackParsedResumeToProfile,
} from "@/services/work-experience";
import {
  applyStagedImport,
  declineStagedImport,
  stageReuploadDiff,
} from "@/services/diff-and-stage";

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

export async function importResumeOrLinkedinAction(formData: FormData) {
  const user = await requireUser();
  const source =
    String(formData.get("source") ?? "resume") === "linkedin"
      ? "linkedin"
      : "resume";
  const rawText = String(formData.get("rawText") ?? "").trim();
  const file = formData.get("pdfFile") as File | null;
  const pdfBytes =
    file && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : undefined;

  const parseRes = await parseResumeOrLinkedinTransient({
    userId: user.id,
    source,
    rawText,
    pdfBytes,
    keepUploadedPdf: true,
  });

  const existingExperiences = await listWorkExperiences(user.id);
  const hadSameSource = existingExperiences.some((e) => e.origin === source);

  if (hadSameSource) {
    await stageReuploadDiff(user.id, parseRes.parsed, source, {
      storageKey: parseRes.storageKey,
    });
  } else {
    await writeBackParsedResumeToProfile(user.id, parseRes.parsed, source);
  }

  revalidatePath("/profile");
  revalidatePath("/skills");
  revalidatePath("/resume");
  revalidatePath("/events");
}

export async function acceptStagedImportAction(formData: FormData) {
  const user = await requireUser();
  const stagingId = String(formData.get("stagingId") ?? "");
  const selectedIds = formData.getAll("acceptedItemIds").map(String);
  await applyStagedImport(user.id, stagingId, {
    acceptedItemIds: selectedIds.length > 0 ? selectedIds : undefined,
  });
  revalidatePath("/profile");
  revalidatePath("/skills");
  revalidatePath("/resume");
  revalidatePath("/events");
}

export async function declineStagedImportAction(formData: FormData) {
  const user = await requireUser();
  const stagingId = String(formData.get("stagingId") ?? "");
  await declineStagedImport(user.id, stagingId);
  revalidatePath("/profile");
}

export async function confirmWorkExperienceAction(formData: FormData) {
  const user = await requireUser();
  const workExperienceId = String(formData.get("workExperienceId") ?? "");
  await confirmWorkExperience(user.id, workExperienceId);
  revalidatePath("/profile");
  revalidatePath("/skills");
  revalidatePath("/events");
}

export async function promoteWorkExperienceAction(formData: FormData) {
  const user = await requireUser();
  const workExperienceId = String(formData.get("workExperienceId") ?? "");
  await promoteWorkExperienceToProject(user.id, workExperienceId);
  revalidatePath("/profile");
  revalidatePath("/projects");
  revalidatePath("/events");
}

export async function setSelfAssessedSkillAction(formData: FormData) {
  const user = await requireUser();
  const skillInput = String(formData.get("skillInput") ?? "");
  const level = Number(formData.get("claimedLevel") ?? 2);
  await setSelfAssessedSkillLevel(user.id, skillInput, level);
  revalidatePath("/skills");
  revalidatePath("/profile");
}
