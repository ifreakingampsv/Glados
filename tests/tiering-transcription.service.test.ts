import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedConfig } from "@/services/seed-config";
import {
  getTranscriptionAdapter,
  TranscriptionParkedError,
} from "@/services/transcription";
import {
  interviewStorageReadout,
  resolveTranscript,
  tierInterviewTranscripts,
} from "@/services/interview-tiering";
import type { StorageAdapter, StoredObject } from "@/services/storage";

const marker = `iv1112_${Date.now()}`;
let userId: string;
let sessionId: string;
const storedObjects = new Map<string, string>();

function memoryAdapter(): StorageAdapter {
  return {
    async put(input) {
      const body =
        typeof input.body === "string"
          ? input.body
          : Buffer.from(input.body).toString("utf8");
      storedObjects.set(input.key, body);
      return {
        key: input.key,
        size: body.length,
        contentType: input.contentType ?? "application/octet-stream",
        sha256: "test",
      };
    },
    async get(key): Promise<StoredObject | null> {
      const body = storedObjects.get(key);
      if (body === undefined) return null;
      return {
        body: new TextEncoder().encode(body),
        contentType: "application/json",
      };
    },
    async getSignedUrl(key) {
      return `https://signed.test/${key}`;
    },
    async del(key) {
      storedObjects.delete(key);
    },
  };
}

beforeAll(async () => {
  await seedConfig();
  const user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  userId = user.id;
  const session = await db.interviewSession.create({
    data: {
      userId,
      scope: "project",
      mode: "quick",
      status: "completed",
      origin: "web",
      payload: { questionCount: 3 },
      completedAt: new Date(),
    },
  });
  sessionId = session.id;
  for (let i = 0; i < 3; i++) {
    await db.interviewTurn.create({
      data: {
        sessionId,
        idx: i,
        questionText: `Question ${i} — a reasonably sized question text for byte counting`,
        answerText: `Answer ${i} — a reasonably sized answer text for byte counting`,
        pushesUsed: 0,
      },
    });
  }
});

afterAll(async () => {
  await db.interviewReport.deleteMany({ where: { session: { userId } } });
  await db.interviewSession.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("transcription seam (T11: D87/D88h)", () => {
  it("ships parked — honest error, never a silent no-op, no whisper imports", async () => {
    const adapter = getTranscriptionAdapter();
    expect(adapter.engine).toBe("parked");
    await expect(
      adapter.transcribe({ audio: new ArrayBuffer(8) })
    ).rejects.toBeInstanceOf(TranscriptionParkedError);
    const transcriptionSource = await import("@/services/transcription");
    expect(Object.keys(transcriptionSource).join(",")).not.toContain(
      "transformers"
    );
  });
});

describe("transcript tiering (T12: D82)", () => {
  it("readout counts sessions and bytes against the threshold", async () => {
    const readout = await interviewStorageReadout();
    expect(readout.sessionsWithTurns).toBeGreaterThanOrEqual(1);
    expect(readout.transcriptBytes).toBeGreaterThan(200);
    expect(readout.thresholdBytes).toBeGreaterThan(0);
  });

  it("under threshold (not forced) tiers nothing; forced tier moves text to R2 and keeps the read path transparent", async () => {
    const idle = await tierInterviewTranscripts({ adapter: memoryAdapter() });
    expect(idle.tiered).toBe(0); // under threshold, no force

    const forced = await tierInterviewTranscripts({
      force: true,
      adapter: memoryAdapter(),
    });
    expect(forced.tiered).toBeGreaterThanOrEqual(1);

    // turn text stripped in Postgres, pointer recorded
    const session = await db.interviewSession.findUnique({
      where: { id: sessionId },
      include: { turns: true },
    });
    expect(session?.turns.every((t) => t.questionText === "")).toBe(true);
    expect((session?.payload as { tieredKey?: string })?.tieredKey).toContain(
      sessionId
    );

    // read path resolves transparently from R2
    const resolved = await resolveTranscript(sessionId, memoryAdapter());
    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.question).toContain("Question 0");
    expect(resolved[0]?.answer).toContain("Answer 0");

    // idempotent: second force run skips already-tiered sessions
    const again = await tierInterviewTranscripts({
      force: true,
      adapter: memoryAdapter(),
    });
    expect(again.tiered).toBe(0);
  });

  it("missing archive resolves to an honest empty, never a crash", async () => {
    storedObjects.clear();
    const resolved = await resolveTranscript(sessionId, memoryAdapter());
    expect(resolved).toEqual([]);
  });
});
