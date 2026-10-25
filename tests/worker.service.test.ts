import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { appendEvent } from "@/services/events";
import {
  DECAY_CRON,
  DECAY_QUEUE,
  enqueueJobInTx,
  processQueueOnce,
  setupWorkerQueues,
} from "@/services/worker";

describe("worker service & pg-boss queue infrastructure (seam: service + real pg-boss)", () => {
  let userId: string;
  let tsSkillId: string;
  const testQueue = "test_tx_queue";

  beforeEach(async () => {
    await seedConfig();
    await seedCanonicalSkills();
    const user = await db.user.create({
      data: {
        clerkId: `clk_worker_${Date.now()}_${Math.random()}`,
        email: "worker@test.local",
      },
    });
    userId = user.id;
    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });
    tsSkillId = ts.id;
  });

  afterEach(async () => {
    await db.eventLog.deleteMany({ where: { userId } });
    await db.userSkill.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
    const boss = await getBoss();
    try {
      await boss.purgeQueue(DECAY_QUEUE);
    } catch {
      // ignore if not created
    }
    try {
      await boss.purgeQueue(testQueue);
    } catch {
      // ignore if not created
    }
  });

  it("registers the decay_sweep schedule in pg-boss and executes decay when a job runs", async () => {
    await setupWorkerQueues();
    const boss = await getBoss();
    const schedules = await boss.getSchedules();
    const decaySchedule = schedules.find((s) => s.name === DECAY_QUEUE);
    expect(decaySchedule).toBeDefined();
    expect(decaySchedule?.cron).toBe(DECAY_CRON);

    // Append an event 90 days in the past (1 half-life)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    await appendEvent({
      userId,
      type: "interview_completed",
      source: "web",
      skills: [tsSkillId],
      occurredAt: ninetyDaysAgo,
    });

    // Artificially set the stored score to stale pre-decay value (10) to observe the scheduled job recomputing it
    await db.userSkill.update({
      where: { userId_skillId: { userId, skillId: tsSkillId } },
      data: { score: 10 },
    });

    // Enqueue a decay_sweep job and drain it once via the worker handler
    const jobId = await boss.send(DECAY_QUEUE, { triggeredBy: "test" });
    expect(jobId).toBeTruthy();

    const processed = await processQueueOnce(DECAY_QUEUE);
    expect(processed).toBe(1);

    const updated = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId, skillId: tsSkillId } },
    });
    expect(updated.score).toBeCloseTo(5, 1);
  });

  it("enqueues atomically inside a Prisma transaction and rolls back when the transaction fails", async () => {
    const boss = await getBoss();
    await boss.createQueue(testQueue);

    // 1. Failing transaction: neither DB write nor pg-boss job should survive
    await expect(
      db.$transaction(async (tx) => {
        await enqueueJobInTx(tx, testQueue, { step: "should-rollback" });
        throw new Error("simulated transaction failure");
      })
    ).rejects.toThrow("simulated transaction failure");

    const afterRollback = await boss.fetch(testQueue);
    expect(afterRollback).toHaveLength(0);

    // 2. Succeeding transaction: job is persisted in pg-boss
    const committedJobId = await db.$transaction(async (tx) => {
      return enqueueJobInTx(tx, testQueue, { step: "committed" });
    });
    expect(committedJobId).toBeTruthy();

    const fetched = await boss.fetch<{ step: string }>(testQueue);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].data.step).toBe("committed");
  });
});
