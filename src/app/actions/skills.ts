"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  createCandidateFromTag,
  resolveTag,
  tagSkill,
  type Resolution,
} from "@/services/skills";

export async function resolveTagAction(
  input: string
): Promise<Resolution | { status: "error"; message: string }> {
  const user = await getSessionUser();
  if (!user)
    return { status: "error", message: "sign-in unavailable (no Clerk keys)" };
  try {
    return await resolveTag(input);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "failed",
    };
  }
}

export async function applyTagAction(
  input: string,
  confirmedSkillId: string | undefined,
  claimedLevel: number | undefined
): Promise<{ ok: boolean; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "sign-in unavailable" };
  try {
    await tagSkill(user.id, input, { confirmedSkillId, claimedLevel });
    revalidatePath("/skills");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "failed",
    };
  }
}

export async function createCandidateAction(
  input: string,
  claimedLevel: number | undefined
): Promise<{ ok: boolean; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "sign-in unavailable" };
  try {
    await createCandidateFromTag(user.id, input);
    const resolution = await resolveTag(input);
    if (resolution.status === "confirm") {
      return { ok: false, message: "still ambiguous — pick a match" };
    }
    await tagSkill(user.id, input, {
      confirmedSkillId: resolution.skillId,
      claimedLevel,
    });
    revalidatePath("/skills");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "failed",
    };
  }
}
