import type PgBoss from "pg-boss";
import type { Prisma } from "@prisma/client";
import { ensureQueue, getBoss, prismaTxToBossDb } from "@/lib/boss";
import { db } from "@/lib/db";
import { runDecaySweep, getConfig } from "@/services/levels";
import {
  ABANDON_SWEEP_CRON,
  ABANDON_SWEEP_QUEUE,
  sweepAbandonedInterviews,
} from "@/services/interview";
import {
  GRADING_QUEUE,
  gradeInterviewSession,
} from "@/services/interview-grader";
import { runGoldenSet } from "@/services/eval-runner";
import {
  BRIEFING_CRON,
  BRIEFING_QUEUE,
  runWeeklyBriefing,
} from "@/services/briefing";
import {
  TIERING_QUEUE,
  interviewStorageReadout,
  tierInterviewTranscripts,
} from "@/services/interview-tiering";
import {
  SHELF_LISTS_CRON,
  SHELF_LISTS_QUEUE,
  SHELF_NIGHTLY_CRON,
  SHELF_NIGHTLY_QUEUE,
  runNightlyPipeline,
  runWeeklyListIngest,
} from "@/services/shelf-pipeline";

export const EVAL_DRIFT_QUEUE = "interview_eval_drift";
export const EVAL_DRIFT_CRON = "0 5 * * 1"; // Mondays 05:00 UTC — paid run, weekly (D88g)

export const DECAY_QUEUE = "decay_sweep";
export const DECAY_CRON = "0 3 * * *";

type QueueProcessor<T = Record<string, unknown>> = (
  data: T,
  jobId: string
) => Promise<unknown>;

const registry = new Map<string, QueueProcessor<never>>();

export function registerQueueProcessor<T = Record<string, unknown>>(
  queueName: string,
  processor: QueueProcessor<T>
): void {
  registry.set(queueName, processor as QueueProcessor<never>);
}

// Register built-in S1 decay sweep processor
registerQueueProcessor(DECAY_QUEUE, async () => {
  const recomputed = await runDecaySweep();
  return { recomputed };
});

// S2: daily auto-abandon sweep for stale active interview sessions (D80/D88f)
registerQueueProcessor(ABANDON_SWEEP_QUEUE, async () => {
  const abandoned = await sweepAbandonedInterviews();
  return { abandoned };
});

// S2: offline interview grading (D3/D81). MCP-origin submissions enforce the
// per-user daily grading cap AT RUN TIME (D88e): over-cap jobs re-enqueue
// themselves for the next UTC day — pending transcripts are never lost.
registerQueueProcessor(
  GRADING_QUEUE,
  async (data: { sessionId?: string; origin?: string }) => {
    if (!data?.sessionId) return { graded: false };
    if (data.origin === "mcp") {
      const session = await db.interviewSession.findUnique({
        where: { id: data.sessionId },
        select: { userId: true },
      });
      if (session) {
        const cap = await getConfig<number>("interview.mcpGradeDailyCap", 3);
        const today = new Date().toISOString().slice(0, 10);
        const bucketKey = `mcp_grade:${session.userId}`;
        const counter = await db.rateLimitCounter.findUnique({
          where: { bucketKey_date: { bucketKey, date: today } },
        });
        if ((counter?.count ?? 0) >= cap) {
          const nextUtcMidnight = new Date();
          nextUtcMidnight.setUTCHours(24, 0, 5, 0);
          await enqueueJob(GRADING_QUEUE, data, {
            startAfter: nextUtcMidnight,
          });
          return { deferred: true };
        }
        await db.rateLimitCounter.upsert({
          where: { bucketKey_date: { bucketKey, date: today } },
          update: { count: { increment: 1 } },
          create: { bucketKey, date: today, count: 1 },
        });
      }
    }
    const res = await gradeInterviewSession(data.sessionId);
    return { graded: Boolean(res?.graded) };
  }
);

// S2: weekly golden-set drift run (D88g) — catches silent provider model
// swaps CI cannot see.
registerQueueProcessor(EVAL_DRIFT_QUEUE, async () => {
  const summary = await runGoldenSet();
  const drifted = summary.results.filter((r) => r.drift).length;
  return { runId: summary.runId, drifted };
});

// S2: Monday briefing emails (D85) — skip rules live inside the service.
registerQueueProcessor(BRIEFING_QUEUE, async () => {
  const { sent, skipped } = await runWeeklyBriefing();
  return { sent, skipped };
});

// S2: transcript R2 tiering (D82) — runs when the storage readout crosses
// the configured threshold; admin can force it from the console.
registerQueueProcessor(TIERING_QUEUE, async (data: { force?: boolean }) => {
  const readout = await interviewStorageReadout();
  if (!data?.force && !readout.overThreshold) {
    return { tiered: 0 };
  }
  const result = await tierInterviewTranscripts({ force: data?.force });
  return { tiered: result.tiered };
});

// S3a: the shelf night job (grid → enrich → score → annotate) and the weekly
// curated-list re-ingest (D90/D96i). Both skip gracefully when the discover
// flag is off or GH_DISCOVERY_TOKEN is absent — a dev box never throws.
registerQueueProcessor(SHELF_NIGHTLY_QUEUE, async () => {
  const res = (await runNightlyPipeline()) as {
    skipped?: string;
    grid?: { queries: number };
    annotations?: { annotated: number };
  };
  return res.skipped
    ? { skipped: res.skipped }
    : {
        grid: res.grid?.queries ?? 0,
        annotated: res.annotations?.annotated ?? 0,
      };
});
registerQueueProcessor(SHELF_LISTS_QUEUE, async () => {
  const res = (await runWeeklyListIngest()) as {
    skipped?: string;
    upserted?: number;
  };
  return res.skipped
    ? { skipped: res.skipped }
    : { upserted: res.upserted ?? 0 };
});

export async function setupWorkerQueues(): Promise<void> {
  const boss = await getBoss();
  for (const queueName of registry.keys()) {
    await ensureQueue(queueName);
  }
  await boss.schedule(
    DECAY_QUEUE,
    DECAY_CRON,
    { scheduled: true },
    { tz: "UTC" }
  );
  await boss.schedule(
    ABANDON_SWEEP_QUEUE,
    ABANDON_SWEEP_CRON,
    { scheduled: true },
    { tz: "UTC" }
  );
  await boss.schedule(
    EVAL_DRIFT_QUEUE,
    EVAL_DRIFT_CRON,
    { scheduled: true },
    { tz: "UTC" }
  );
  await boss.schedule(
    BRIEFING_QUEUE,
    BRIEFING_CRON,
    { scheduled: true },
    { tz: "UTC" }
  );
  await boss.schedule(
    SHELF_NIGHTLY_QUEUE,
    SHELF_NIGHTLY_CRON,
    { scheduled: true },
    { tz: "UTC" }
  );
  await boss.schedule(
    SHELF_LISTS_QUEUE,
    SHELF_LISTS_CRON,
    { scheduled: true },
    { tz: "UTC" }
  );
}

export async function enqueueJob<T extends object>(
  queueName: string,
  data: T,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  await ensureQueue(queueName);
  const boss = await getBoss();
  return boss.send(queueName, data, options ?? {});
}

export async function enqueueJobInTx<T extends object>(
  tx: Prisma.TransactionClient,
  queueName: string,
  data: T,
  options?: Omit<PgBoss.SendOptions, "db">
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queueName, data, {
    ...(options ?? {}),
    db: prismaTxToBossDb(tx),
  });
}

// Drains up to batchSize pending jobs from queueName synchronously using the
// registered processor (used in service-layer tests and on-demand draining).
export async function processQueueOnce(
  queueName: string,
  batchSize = 10
): Promise<number> {
  const processor = registry.get(queueName) as
    QueueProcessor<Record<string, unknown>> | undefined;
  if (!processor) {
    throw new Error(`No processor registered for queue: ${queueName}`);
  }
  await ensureQueue(queueName);
  const boss = await getBoss();
  const jobs = await boss.fetch<Record<string, unknown>>(queueName, {
    batchSize,
  });
  if (!jobs || jobs.length === 0) return 0;

  let processed = 0;
  for (const job of jobs) {
    try {
      const output = await processor(job.data ?? {}, job.id);
      await boss.complete(
        queueName,
        job.id,
        output && typeof output === "object" ? (output as object) : {}
      );
      processed += 1;
    } catch (err) {
      await boss.fail(
        queueName,
        job.id,
        err instanceof Error ? { message: err.message } : { error: String(err) }
      );
      throw err;
    }
  }
  return processed;
}

export async function startWorker(): Promise<{ stop: () => Promise<void> }> {
  await setupWorkerQueues();
  const boss = await getBoss();
  const workerIds: string[] = [];

  for (const [queueName, processor] of registry.entries()) {
    const id = await boss.work<Record<string, unknown>>(
      queueName,
      async (jobs) => {
        const typed = processor as QueueProcessor<Record<string, unknown>>;
        for (const job of jobs) {
          await typed(job.data ?? {}, job.id);
        }
      }
    );
    workerIds.push(id);
  }

  return {
    async stop() {
      for (const id of workerIds) {
        await boss.offWork({ id });
      }
    },
  };
}
