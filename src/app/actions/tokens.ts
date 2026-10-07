"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createToken, revokeToken } from "@/services/tokens";

export async function createTokenAction(name: string) {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "sign-in unavailable" };
  const { token, record } = await createToken(user.id, name);
  revalidatePath("/tokens");
  return { ok: true, token, prefix: record.prefix };
}

export async function revokeTokenAction(tokenId: string) {
  const user = await getSessionUser();
  if (!user) return { ok: false };
  await revokeToken(user.id, tokenId);
  revalidatePath("/tokens");
  return { ok: true };
}
