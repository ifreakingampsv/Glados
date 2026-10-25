"use server";

// S3a /discover server actions (D93/D94/D95/D96). Thin wrappers over the
// service layer — one enforcement path (D21). None of them write evidence.

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { setPreference } from "@/services/profile";
import { buildFlagshipPrompt, logCardClick } from "@/services/shelf-match";
import {
  createPick,
  saveNote,
  setPickStatus,
  type PickStatus,
} from "@/services/picks";

export async function toggleDiscoverGapsAction(on: boolean) {
  const user = await getSessionUser();
  if (!user) return;
  await setPreference(user.id, "discover_gaps_mode", on ? "on" : "off");
  revalidatePath("/discover");
}

export async function setDiscoverArchetypesAction(keys: string[]) {
  const user = await getSessionUser();
  if (!user) return;
  const clean = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].slice(
    0,
    6
  );
  await setPreference(user.id, "discover_archetypes", clean.join(","));
  revalidatePath("/discover");
}

export async function flagShipPromptAction(
  repoGithubId: number
): Promise<string> {
  const user = await getSessionUser();
  if (!user) return "";
  await logCardClick(user.id, repoGithubId);
  return buildFlagshipPrompt(user.id, repoGithubId);
}

export async function pickAction(repoGithubId: number) {
  const user = await getSessionUser();
  if (!user) return;
  await createPick(user.id, repoGithubId);
  revalidatePath("/discover");
}

export async function setPickStatusAction(
  repoGithubId: number,
  status: PickStatus
) {
  const user = await getSessionUser();
  if (!user) return;
  await setPickStatus(user.id, repoGithubId, status);
  revalidatePath("/discover");
}

export async function saveNoteAction(input: {
  title: string;
  content: string;
  skillId?: string | null;
  repoGithubId?: number | null;
}): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user) return { ok: false };
  await saveNote({ userId: user.id, ...input });
  revalidatePath("/discover");
  return { ok: true };
}
