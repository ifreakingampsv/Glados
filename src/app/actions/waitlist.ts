"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { joinWaitlist, redeemInviteCode } from "@/services/waitlist";

export async function joinWaitlistAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  try {
    await joinWaitlist(email);
  } catch {
    // invalid input: land back with a hint
  }
  revalidatePath("/waitlist");
  redirect("/waitlist?joined=1");
}

export async function redeemCodeAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const code = String(formData.get("code") ?? "");
  try {
    await redeemInviteCode(user, code);
  } catch {
    redirect("/waitlist?error=bad-code");
  }
  redirect("/profile");
}
