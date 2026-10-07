"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { addCredential, deleteCredential } from "@/services/credentials";

export async function addCredentialAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  try {
    await addCredential(
      user.id,
      String(formData.get("provider") ?? "")
        .trim()
        .toLowerCase(),
      String(formData.get("apiKey") ?? "")
    );
  } catch {
    redirect("/gateway?error=invalid-key");
  }
  revalidatePath("/gateway");
}

export async function deleteCredentialAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  await deleteCredential(user.id, String(formData.get("credentialId") ?? ""));
  revalidatePath("/gateway");
}
