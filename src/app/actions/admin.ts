"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import {
  approveCandidate,
  mergeCandidate,
  rejectCandidate,
} from "@/services/skill-admin";
import { createInviteCode } from "@/services/waitlist";
import { runSmokeProbe } from "@/services/probe";
import { db } from "@/lib/db";

export async function approveCandidateAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) return;
  await approveCandidate(user, String(formData.get("skillId") ?? ""));
  revalidatePath("/admin");
}

export async function mergeCandidateAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) return;
  await mergeCandidate(
    user,
    String(formData.get("skillId") ?? ""),
    String(formData.get("targetId") ?? "")
  );
  revalidatePath("/admin");
}

export async function rejectCandidateAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) return;
  await rejectCandidate(user, String(formData.get("skillId") ?? ""));
  revalidatePath("/admin");
}

export async function createInviteCodeAction() {
  const user = await getSessionUser();
  if (!user) return;
  await createInviteCode(user);
  revalidatePath("/admin");
}

export async function setFlagAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  const key = String(formData.get("key") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await db.featureFlag.upsert({
    where: { key },
    update: { enabled },
    create: { key, enabled },
  });
  revalidatePath("/admin");
}

export async function runSmokeProbeAction() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { result, usage } = await runSmokeProbe(user);
  revalidatePath("/admin");
  return {
    status: result.status,
    message:
      result.status === "ok"
        ? `via ${result.via} — ${usage?.inputTokens}/${usage?.outputTokens} tokens, $${usage?.costUsd.toFixed(5)}`
        : result.message,
  };
}
