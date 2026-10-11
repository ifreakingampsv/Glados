"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import {
  approveCandidate,
  generateMissingSkillDefinitions,
  mergeCandidate,
  rejectCandidate,
} from "@/services/skill-admin";
import { createInviteCode } from "@/services/waitlist";
import { runSmokeProbe, setFeatureFlag } from "@/services/probe";
import { runStorageProbe } from "@/services/storage";

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
  await setFeatureFlag(user, key, enabled);
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

export async function runStorageProbeAction() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const probe = await runStorageProbe(user);
  revalidatePath("/admin");
  return {
    status: probe.ok ? "ok" : "failed",
    message: probe.ok
      ? `R2 probe passed: uploaded, verified (${probe.bytesVerified} bytes), signed (${probe.signedUrlExpiresSeconds}s TTL), and deleted ${probe.key}`
      : `R2 probe failed on ${probe.key}`,
  };
}

export async function generateDefinitionsAction() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  try {
    const res = await generateMissingSkillDefinitions(user, fetch, 10);
    revalidatePath("/admin");
    return {
      status: "ok",
      message: `Generated ${res.generated} new definition(s). Coverage: ${res.withDefinition}/${res.totalActive} active skills.`,
    };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error ? err.message : "Definition generation failed",
    };
  }
}
