// S3a picks + notes (D94/D96b): the study list and D39's first note writer.
// Neither ever touches the event log or user_skills — browsing, picking, and
// note-taking are product data, never evidence (D36 anti-farming by construction).

import { db } from "@/lib/db";

export const PICK_STATUSES = ["considering", "building", "dropped"] as const;
export type PickStatus = (typeof PICK_STATUSES)[number];

export async function createPick(userId: string, repoGithubId: number) {
  return db.projectPick.upsert({
    where: { userId_repoGithubId: { userId, repoGithubId } },
    update: { status: "considering" },
    create: { userId, repoGithubId, status: "considering" },
  });
}

export async function setPickStatus(
  userId: string,
  repoGithubId: number,
  status: PickStatus
) {
  if (!PICK_STATUSES.includes(status))
    throw new Error(`unknown pick status: ${status}`);
  return db.projectPick.update({
    where: { userId_repoGithubId: { userId, repoGithubId } },
    data: { status },
  });
}

export async function listPicks(userId: string) {
  return db.projectPick.findMany({
    where: { userId, status: { not: "dropped" } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function pickMapFor(userId: string): Promise<Map<number, string>> {
  const rows = await db.projectPick.findMany({
    where: { userId, status: { not: "dropped" } },
    select: { repoGithubId: true, status: true },
  });
  return new Map(rows.map((r) => [r.repoGithubId, r.status]));
}

// D96b: minimal D39 notes. Manual capture only — paste the flagship brief
// back, save it with an optional skill link; S4 adds FSRS on top.
export async function saveNote(input: {
  userId: string;
  title: string;
  content: string;
  skillId?: string | null;
  repoGithubId?: number | null;
  source?: string;
}) {
  if (!input.title.trim() || !input.content.trim())
    throw new Error("note title and content are required");
  return db.note.create({
    data: {
      userId: input.userId,
      title: input.title.trim().slice(0, 200),
      content: input.content,
      skillId: input.skillId ?? null,
      repoGithubId: input.repoGithubId ?? null,
      source: input.source ?? "flagship_brief",
    },
  });
}

export function listNotes(userId: string) {
  return db.note.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
