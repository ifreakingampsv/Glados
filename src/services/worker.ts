import type PgBoss from "pg-boss";
import type { Prisma } from "@prisma/client";
import { ensureQueue, getBoss, prismaTxToBossDb } from "@/lib/boss";
import { runDecaySweep } from "@/services/levels";

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
