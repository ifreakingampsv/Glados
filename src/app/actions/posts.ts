"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  checkProjectPostEligibility,
  draftProjectLinkedinPosts,
  type DraftProjectPostsResult,
  type ProjectPostEligibility,
} from "@/services/commit-post";

export async function checkPostEligibilityAction(
  projectId: string,
  userFlaggedWork?: boolean
): Promise<
  | { ok: true; eligibility: ProjectPostEligibility }
  | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };
  try {
    const eligibility = await checkProjectPostEligibility({
      userId: user.id,
      projectId,
      userFlaggedWork,
    });
    return { ok: true, eligibility };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Could not check post eligibility",
    };
  }
}

export async function draftProjectPostsAction(
  projectId: string,
  options?: { confirmForkWork?: boolean }
): Promise<
  { ok: true; result: DraftProjectPostsResult } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };
  try {
    const result = await draftProjectLinkedinPosts({
      userId: user.id,
      projectId,
      userFlaggedWork: options?.confirmForkWork,
    });
    revalidatePath("/projects");
    revalidatePath("/events");
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not draft posts",
    };
  }
}
