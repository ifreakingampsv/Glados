"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  createProject,
  deleteProject,
  updateProject,
} from "@/services/projects";

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
