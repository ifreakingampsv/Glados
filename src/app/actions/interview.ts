"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  InsufficientEnergyError,
  advanceSession,
  deleteInterviewSession,
  getInterviewSession,
  startInterviewSession,
  submitAnswer,
  type InterviewMode,
  type InterviewScope,
} from "@/services/interview";
import { gradeInterviewSession } from "@/services/interview-grader";
import {
  confirmDecisionRecord,
  createDecisionRecord,
  draftDecisionRecordsFromSession,
} from "@/services/decision-records";
import { setUnsubscribed } from "@/services/briefing";
import { db } from "@/lib/db";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

export async function answerTurnAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  const answer = String(formData.get("answer") ?? "");
  const durationRaw = Number(formData.get("durationMs") ?? 0);
  const durationMs = Number.isFinite(durationRaw) ? durationRaw : undefined;
  try {
    await submitAnswer(user.id, sessionId, answer, { durationMs });
    await advanceSession(user.id, sessionId);
  } catch {
    // The answer is saved by submitAnswer before any gateway risk; a failure
    // here means the advance call paused — the session stays resumable.
    revalidatePath(`/interview/${sessionId}`);
    redirect(`/interview/${sessionId}?paused=1`);
  }
  revalidatePath(`/interview/${sessionId}`);
  redirect(`/interview/${sessionId}`);
}

export async function gradeSessionAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  const owned = await getInterviewSession(user.id, sessionId);
  if (!owned) redirect("/interview");
  try {
    await gradeInterviewSession(sessionId);
  } catch {
    revalidatePath(`/interview/${sessionId}`);
    redirect(`/interview/${sessionId}?error=grading`);
  }
  revalidatePath(`/interview/${sessionId}`);
  redirect(`/interview/${sessionId}`);
}

export async function deleteSessionAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  try {
    await deleteInterviewSession(user.id, sessionId);
  } catch {
    redirect(`/interview/${sessionId}?error=delete`);
  }
  revalidatePath("/interview");
  redirect("/interview");
}

// D87 rung 2 demand signal: one tap on the report page, config-row counter.
export async function demandVoiceAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  const current = await db.config.findUnique({
    where: { key: "voice.demandCount" },
  });
  const count = ((current?.value as number | undefined) ?? 0) + 1;
  await db.config.upsert({
    where: { key: "voice.demandCount" },
    update: { value: count },
    create: { key: "voice.demandCount", value: count },
  });
  revalidatePath(`/interview/${sessionId}`);
  redirect(`/interview/${sessionId}?voice=1`);
}

export async function draftRecordsAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  try {
    await draftDecisionRecordsFromSession(user.id, sessionId);
  } catch {
    revalidatePath(`/interview/${sessionId}`);
    redirect(`/interview/${sessionId}?error=debrief`);
  }
  revalidatePath(`/interview/${sessionId}`);
  redirect(`/interview/${sessionId}`);
}

export async function confirmRecordAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  try {
    await confirmDecisionRecord(user.id, recordId);
  } catch {
    redirect(`/interview/${sessionId}?error=confirm`);
  }
  revalidatePath(`/interview/${sessionId}`);
  redirect(`/interview/${sessionId}`);
}

export async function createRecordAction(formData: FormData) {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "");
  const alternatives = String(formData.get("alternatives") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  try {
    await createDecisionRecord(user.id, projectId, {
      choice: String(formData.get("choice") ?? ""),
      alternatives,
      rationale: String(formData.get("rationale") ?? ""),
    });
  } catch {
    redirect("/interview?error=record");
  }
  revalidatePath("/interview");
  redirect("/interview");
}

export async function unsubscribeBriefingAction() {
  const user = await requireUser();
  await setUnsubscribed(user.id, true);
  revalidatePath("/this-week");
  redirect("/this-week?unsubscribe=1");
}

export async function startInterviewAction(formData: FormData) {
  const user = await requireUser();
  const scopeRaw = String(formData.get("scope") ?? "project");
  const scope: InterviewScope =
    scopeRaw === "portfolio" || scopeRaw === "application"
      ? scopeRaw
      : "project";
  const modeRaw = String(formData.get("mode") ?? "quick");
  const mode: InterviewMode = modeRaw === "deep" ? "deep" : "quick";
  const projectId = String(formData.get("projectId") ?? "") || undefined;
  const projectIds = formData.getAll("projectIds").map(String).filter(Boolean);
  const jdId = String(formData.get("jdId") ?? "") || undefined;
  try {
    const { sessionId } = await startInterviewSession(user.id, {
      scope,
      projectId,
      projectIds,
      jdId,
      mode,
    });
    revalidatePath("/interview");
    redirect(`/interview/${sessionId}`);
  } catch (err) {
    if (err instanceof InsufficientEnergyError) {
      redirect("/interview?error=no-energy");
    }
    redirect("/interview?error=start-failed");
  }
}
