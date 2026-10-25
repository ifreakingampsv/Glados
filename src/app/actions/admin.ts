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
import {
  adminGenerateQuizBanksNow,
  approveQuizBankReview,
  retireAndReplaceQuizBank,
  setQuizStrictReviewGating,
} from "@/services/quiz-banks";
import {
  applyReplayMaintenanceJob,
  runWhatIfReplay,
  setReplayFeatureFlags,
  type ApplyReplayMaintenanceResult,
  type WhatIfReplayResult,
} from "@/services/replay";
import type { ScoringConfigOverride } from "@/services/levels";
import { createInviteCode } from "@/services/waitlist";
import { runSmokeProbe, setFeatureFlag } from "@/services/probe";
import { runStorageProbe } from "@/services/storage";
import {
  runGoldenSet,
  setEvalAnchor,
  summarizeRun,
} from "@/services/eval-runner";
import { tierInterviewTranscripts } from "@/services/interview-tiering";

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

export async function runGoldenSetAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return { ok: false, message: "admin only" };
  }
  try {
    const summary = await runGoldenSet();
    const gate = summarizeRun(summary);
    revalidatePath("/admin");
    return {
      ok: gate.releaseGate,
      message: `run ${summary.runId}: ${gate.total} fixtures, ${gate.drifted.length} drifted, ${gate.failed.length} failed, ${summary.pendingAdjudication.length} pending adjudication — release gate ${gate.releaseGate ? "GREEN" : "RED"}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "eval run failed",
    };
  }
}

export async function setEvalAnchorAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  const fixtureId = String(formData.get("fixtureId") ?? "");
  const band = String(formData.get("band") ?? "");
  if (!fixtureId || !band) return;
  await setEvalAnchor(fixtureId, band);
  revalidatePath("/admin");
}

export async function tierTranscriptsAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  await tierInterviewTranscripts({
    force: String(formData.get("force") ?? "") === "true",
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
        ? `via ${result.via} - ${usage?.inputTokens}/${usage?.outputTokens} tokens, $${usage?.costUsd.toFixed(5)}`
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

export async function generateQuizBanksNowAction(skillId: string): Promise<{
  status: "ok" | "error";
  message: string;
}> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return { status: "error", message: "Admin access required" };
  }
  try {
    const banks = await adminGenerateQuizBanksNow(user, skillId);
    revalidatePath("/admin");
    return {
      status: "ok",
      message: `Generated ${banks.length} bank(s) across bands (${banks.map((b) => `${b.band}: ${b.status}`).join(", ")}).`,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Bank generation failed",
    };
  }
}

export async function approveQuizBankReviewAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  const bankId = String(formData.get("bankId") ?? "");
  await approveQuizBankReview(user, bankId);
  revalidatePath("/admin");
}

export async function retireAndReplaceQuizBankAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  const bankId = String(formData.get("bankId") ?? "");
  await retireAndReplaceQuizBank(user, { bankId });
  revalidatePath("/admin");
}

export async function toggleStrictReviewGatingAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await setQuizStrictReviewGating(user, enabled);
  revalidatePath("/admin");
}

export async function toggleReplayFlagsAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return;
  const flagType = String(formData.get("flagType") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (flagType === "whatIf") {
    await setReplayFeatureFlags(user, { whatIfEnabled: enabled });
  } else if (flagType === "apply") {
    await setReplayFeatureFlags(user, { applyEnabled: enabled });
  }
  revalidatePath("/admin");
}

export async function runWhatIfReplayAction(
  candidateOverride: ScoringConfigOverride
): Promise<
  { ok: true; data: WhatIfReplayResult } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return { ok: false, message: "Admin access required" };
  }
  try {
    const data = await runWhatIfReplay(user, candidateOverride);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Replay failed",
    };
  }
}

export async function applyReplayMaintenanceAction(
  candidateOverride: ScoringConfigOverride
): Promise<
  | { ok: true; data: ApplyReplayMaintenanceResult }
  | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return { ok: false, message: "Admin access required" };
  }
  try {
    const data = await applyReplayMaintenanceJob(user, candidateOverride);
    revalidatePath("/admin");
    revalidatePath("/skills");
    revalidatePath("/how-levels-work");
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Replay apply failed",
    };
  }
}
