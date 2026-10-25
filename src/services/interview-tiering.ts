import { db } from "@/lib/db";
import { getObject, putObject, type StorageAdapter } from "@/services/storage";
import { getConfig } from "@/services/levels";

// S2 transcript tiering (D82/D88): transcripts live in Postgres at ramp
// stages 1–2; when the storage readout says so, TEXT BLOBS move to R2 through
// the storage module — structured columns and report rows stay joinable; the
// read path resolves transparently. Tombstoned sessions were stripped at
// deletion and are never archived.

export const TIERING_QUEUE = "interview_tiering";

export interface InterviewStorageReadout {
  sessionsWithTurns: number;
  transcriptBytes: number;
  thresholdBytes: number;
  overThreshold: boolean;
}

export function transcriptBytesOf(
  turns: Array<{ questionText: string; answerText: string | null }>
): number {
  return turns.reduce(
    (sum, t) => sum + t.questionText.length + (t.answerText?.length ?? 0),
    0
  );
}

export async function interviewStorageReadout(): Promise<InterviewStorageReadout> {
  const thresholdKb = await getConfig<number>("interview.tierThresholdKb", 200);
  const thresholdBytes = thresholdKb * 1024;
  const sessions = await db.interviewSession.findMany({
    where: { status: { not: "deleted" } },
    include: { turns: { select: { questionText: true, answerText: true } } },
  });
  const withTurns = sessions.filter((s) => s.turns.length > 0);
  const transcriptBytes = withTurns.reduce(
    (sum, s) => sum + transcriptBytesOf(s.turns),
    0
  );
  return {
    sessionsWithTurns: withTurns.length,
    transcriptBytes,
    thresholdBytes,
    overThreshold: transcriptBytes > thresholdBytes,
  };
}

export interface TieringResult {
  tiered: number;
  skipped: number;
}

export async function tierInterviewTranscripts(options?: {
  force?: boolean;
  adapter?: StorageAdapter;
}): Promise<TieringResult> {
  const readout = await interviewStorageReadout();
  if (!options?.force && !readout.overThreshold) {
    return { tiered: 0, skipped: 0 };
  }
  const sessions = await db.interviewSession.findMany({
    where: { status: { not: "deleted" } },
    include: { turns: { orderBy: { idx: "asc" } } },
  });
  let tiered = 0;
  let skipped = 0;
  for (const session of sessions) {
    if (session.turns.length === 0) {
      skipped += 1;
      continue;
    }
    const payload = (session.payload ?? {}) as { tieredKey?: string };
    if (payload.tieredKey) {
      skipped += 1; // already tiered — idempotent
      continue;
    }
    const transcript = session.turns.map((t) => ({
      idx: t.idx,
      question: t.questionText,
      answer: t.answerText,
      pushesUsed: t.pushesUsed,
      durationMs: t.durationMs,
    }));
    const key = `interviews/${session.id}/transcript.json`;
    await putObject(
      {
        key,
        body: JSON.stringify(transcript),
        contentType: "application/json",
      },
      options?.adapter
    );
    await db.$transaction(async (tx) => {
      for (const t of session.turns) {
        await tx.interviewTurn.update({
          where: { id: t.id },
          data: { questionText: "", answerText: null },
        });
      }
      await tx.interviewSession.update({
        where: { id: session.id },
        data: {
          payload: {
            ...payload,
            tieredKey: key,
          } as never,
        },
      });
    });
    tiered += 1;
  }
  return { tiered, skipped };
}

// Transparent read path: returns turn text from Postgres, or from R2 when the
// transcript was tiered. Callers never know where the bytes live.
export async function resolveTranscript(
  sessionId: string,
  adapter?: StorageAdapter
): Promise<Array<{ idx: number; question: string; answer: string | null }>> {
  const session = await db.interviewSession.findUnique({
    where: { id: sessionId },
    include: { turns: { orderBy: { idx: "asc" } } },
  });
  if (!session) throw new Error("session not found");
  const payload = (session.payload ?? {}) as { tieredKey?: string };
  if (!payload.tieredKey) {
    return session.turns.map((t) => ({
      idx: t.idx,
      question: t.questionText,
      answer: t.answerText,
    }));
  }
  const stored = await getObject(payload.tieredKey, adapter);
  if (!stored) {
    return []; // archived-but-missing: honest empty, never a crash
  }
  const text = new TextDecoder().decode(stored.body);
  return JSON.parse(text) as Array<{
    idx: number;
    question: string;
    answer: string | null;
  }>;
}
