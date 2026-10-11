"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  createOrRegenerateBlockVariant,
  createResumeBlock,
  deleteResumeBlock,
  reorderResumeBlocks,
  setManualBlockSelectionOverride,
  setResumeBlockLockStatus,
  updateResumeBlock,
  type ResumeBlockKind,
} from "@/services/resume-builder";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

export async function createResumeBlockAction(formData: FormData) {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "custom") as ResumeBlockKind;
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const sourceRefType =
    (formData.get("sourceRefType") as "project" | "work_experience" | null) ||
    null;
  const sourceRefId = (formData.get("sourceRefId") as string | null) || null;

  if (!content) {
    redirect("/resume?error=content-required");
  }

  await createResumeBlock(user.id, {
    kind,
    title,
    content,
    sourceRefType,
    sourceRefId,
  });

  revalidatePath("/resume");
}

export async function updateResumeBlockAction(formData: FormData) {
  const user = await requireUser();
  const blockId = String(formData.get("blockId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  try {
    await updateResumeBlock(user.id, blockId, { title, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    redirect(`/resume?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/resume");
}

export async function toggleResumeBlockLockAction(formData: FormData) {
  const user = await requireUser();
  const blockId = String(formData.get("blockId") ?? "");
  const currentStatus = String(formData.get("status") ?? "draft");
  const nextStatus = currentStatus === "locked" ? "draft" : "locked";

  await setResumeBlockLockStatus(user.id, blockId, nextStatus);
  revalidatePath("/resume");
}

export async function deleteResumeBlockAction(formData: FormData) {
  const user = await requireUser();
  const blockId = String(formData.get("blockId") ?? "");

  await deleteResumeBlock(user.id, blockId);
  revalidatePath("/resume");
}

export async function createVariantAction(formData: FormData) {
  const user = await requireUser();
  const parentBlockId = String(formData.get("parentBlockId") ?? "");
  const fromJdId = String(formData.get("fromJdId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  try {
    await createOrRegenerateBlockVariant(user.id, {
      parentBlockId,
      fromJdId,
      title: title || undefined,
      content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    redirect(`/resume?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/resume");
}

export async function setManualOverrideAction(formData: FormData) {
  const user = await requireUser();
  const jdId = String(formData.get("jdId") ?? "");
  const parentBlockId = String(formData.get("parentBlockId") ?? "");
  const chosenBlockId = String(formData.get("chosenBlockId") ?? "");

  await setManualBlockSelectionOverride(
    user.id,
    jdId,
    parentBlockId,
    chosenBlockId
  );
  revalidatePath("/resume");
}

export async function moveBlockAction(formData: FormData) {
  const user = await requireUser();
  const blockId = String(formData.get("blockId") ?? "");
  const direction = String(formData.get("direction") ?? "down");
  const allIds = formData.getAll("allBlockIds").map(String);

  const idx = allIds.indexOf(blockId);
  if (idx !== -1) {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < allIds.length) {
      const temp = allIds[idx];
      allIds[idx] = allIds[targetIdx];
      allIds[targetIdx] = temp;
      await reorderResumeBlocks(user.id, allIds);
      revalidatePath("/resume");
    }
  }
}

export async function renderResumePdfAction(formData: FormData) {
  const user = await requireUser();
  const jdId = (formData.get("jdId") as string | null) || null;

  try {
    const { renderResumeToPdf } = await import("@/services/resume-render");
    const result = await renderResumeToPdf(user.id, jdId);
    redirect(result.downloadUrl);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err; // Next.js redirect throw
    }
    const msg = err instanceof Error ? err.message : "render failed";
    redirect(`/resume?error=${encodeURIComponent(msg)}`);
  }
}
