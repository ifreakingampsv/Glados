"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  abandonQuizSession,
  getQuizCooldownStatus,
  resolveStartBandForUserSkill,
  startQuizSession,
  submitQuizRound,
  type RoundAnswerInput,
  type StartQuizSessionResult,
  type SubmitQuizRoundResult,
} from "@/services/quiz";

export async function previewQuizEligibilityAction(skillId: string): Promise<
  | {
      ok: true;
      startBand: string;
      startReason: string;
      onCooldown: boolean;
      nextRetakeAt: string | null;
    }
  | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };
  try {
    const [placement, cooldown] = await Promise.all([
      resolveStartBandForUserSkill(user.id, skillId),
      getQuizCooldownStatus(user.id, skillId),
    ]);
    return {
      ok: true,
      startBand: placement.band,
      startReason: placement.reason,
      onCooldown: cooldown.onCooldown,
      nextRetakeAt: cooldown.nextRetakeAt
        ? cooldown.nextRetakeAt.toISOString()
        : null,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to load quiz state",
    };
  }
}

export async function startQuizSessionAction(
  skillId: string
): Promise<
  { ok: true; data: StartQuizSessionResult } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };
  try {
    const data = await startQuizSession({ userId: user.id, skillId });
    revalidatePath("/skills");
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not start quiz",
    };
  }
}

export async function submitQuizRoundAction(
  sessionId: string,
  answers: RoundAnswerInput[]
): Promise<
  { ok: true; data: SubmitQuizRoundResult } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };
  try {
    const data = await submitQuizRound({
      userId: user.id,
      sessionId,
      answers,
    });
    revalidatePath("/skills");
    revalidatePath("/how-levels-work");
    revalidatePath("/gaps");
    revalidatePath("/events");
    revalidatePath("/admin");
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not submit round",
    };
  }
}

export async function abandonQuizSessionAction(
  sessionId: string
): Promise<{ ok: boolean; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };
  try {
    await abandonQuizSession({ userId: user.id, sessionId });
    revalidatePath("/skills");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not abandon quiz",
    };
  }
}
