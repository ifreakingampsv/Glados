"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  addProjectSkill,
  createProject,
  deleteProject,
  removeProjectSkill,
  updateProject,
} from "@/services/projects";
import {
  GITHUB_IMPORT_QUEUE,
  enqueueGithubImportBatch,
  syncGithubReposNow,
  type GithubRepoFixture,
} from "@/services/github-import";
import { processQueueOnce } from "@/services/worker";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

export async function createProjectAction(formData: FormData) {
  const user = await requireUser();
  try {
    await createProject(user.id, {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
    });
  } catch {
    redirect("/projects?error=invalid");
  }
  revalidatePath("/projects");
}

export async function updateProjectAction(formData: FormData) {
  const user = await requireUser();
  try {
    await updateProject(user.id, String(formData.get("projectId") ?? ""), {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
    });
  } catch {
    redirect("/projects?error=invalid");
  }
  revalidatePath("/projects");
}

export async function deleteProjectAction(formData: FormData) {
  const user = await requireUser();
  await deleteProject(user.id, String(formData.get("projectId") ?? ""));
  revalidatePath("/projects");
}

export async function addProjectSkillAction(
  projectId: string,
  input: string,
  options?: { confirmedSkillId?: string; createCandidate?: boolean }
): Promise<{ ok: boolean; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "not signed in" };
  try {
    await addProjectSkill(user.id, projectId, input, options);
    revalidatePath("/projects");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "failed to add skill",
    };
  }
}

export async function removeProjectSkillAction(formData: FormData) {
  const user = await requireUser();
  await removeProjectSkill(
    user.id,
    String(formData.get("projectId") ?? ""),
    String(formData.get("skillId") ?? "")
  );
  revalidatePath("/projects");
}

export async function importGithubBatchAction(
  selectedRepos: GithubRepoFixture[]
): Promise<{ ok: boolean; importedCount?: number; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "not signed in" };
  try {
    const res = await enqueueGithubImportBatch(user.id, selectedRepos);
    await processQueueOnce(
      GITHUB_IMPORT_QUEUE,
      Math.max(10, res.acceptedCount)
    );
    revalidatePath("/projects");
    revalidatePath("/skills");
    revalidatePath("/events");
    return { ok: true, importedCount: res.acceptedCount };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "GitHub import failed",
    };
  }
}

export async function syncGithubReposAction(
  selectedRepos: GithubRepoFixture[]
): Promise<{ ok: boolean; syncedCount?: number; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "not signed in" };
  try {
    const res = await syncGithubReposNow(user.id, selectedRepos);
    revalidatePath("/projects");
    revalidatePath("/skills");
    revalidatePath("/events");
    return { ok: true, syncedCount: res.syncedCount };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "GitHub sync failed",
    };
  }
}
