import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { appendEvent } from "@/services/events";
import {
  DEFAULT_BANDS,
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
  recomputeUserSkill,
} from "@/services/levels";
import {
  applyReplayMaintenanceJob,
  getReplayFeatureFlags,
  REPLAY_APPLY_FLAG,
  REPLAY_WHAT_IF_FLAG,
  runWhatIfReplay,
  setReplayFeatureFlags,
} from "@/services/replay";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";

const TEST_PREFIX = "test-replay-";
const createdUserIds: string[] = [];

async function makeUser(suffix: string, role: "USER" | "ADMIN" = "USER") {
  const id = `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createdUserIds.push(id);
  return db.user.create({
    data: {
      id,
      clerkId: `clerk_${id}`,
      email: `${id}@example.test`,
      role,
    },
  });
}

let admin: User;

beforeAll(async () => {
  await seedCanonicalSkills();
  await seedConfig();
  await seedRoutes();
  admin = await makeUser("admin-main", "ADMIN");
});

afterEach(async () => {
  await db.featureFlag.deleteMany({
    where: { key: { in: [REPLAY_WHAT_IF_FLAG, REPLAY_APPLY_FLAG] } },
  });
  // Restore default scoring configs after each test
  await db.config.upsert({
    where: { key: "points.types" },
    update: { value: DEFAULT_POINTS as Prisma.InputJsonValue },
    create: {
      key: "points.types",
      value: DEFAULT_POINTS as Prisma.InputJsonValue,
    },
  });
  await db.config.upsert({
    where: { key: "points.sourceWeights" },
    update: { value: DEFAULT_SOURCE_WEIGHTS as Prisma.InputJsonValue },
    create: {
      key: "points.sourceWeights",
      value: DEFAULT_SOURCE_WEIGHTS as Prisma.InputJsonValue,
    },
  });
  await db.config.upsert({
    where: { key: "levels.bands" },
    update: { value: DEFAULT_BANDS as Prisma.InputJsonValue },
    create: {
      key: "levels.bands",
      value: DEFAULT_BANDS as Prisma.InputJsonValue,
    },
  });

  const nonAdminIds = createdUserIds.filter((id) => id !== admin.id);
  if (nonAdminIds.length > 0) {
    await db.user.deleteMany({
      where: { id: { in: nonAdminIds } },
    });
    createdUserIds.length = 0;
    createdUserIds.push(admin.id);
  }
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: admin.id } });
});

describe("what-if replay + guarded apply service (Ticket 07)", () => {
  it("defaults both replay.whatIf and replay.apply flags to false (dark at ship) and rejects calls when flags are off", async () => {
    const flags = await getReplayFeatureFlags();
    expect(flags.whatIfEnabled).toBe(false);
    expect(flags.applyEnabled).toBe(false);

    await expect(
      runWhatIfReplay(admin, { pointsTypes: { repo_imported: 15 } })
    ).rejects.toThrow(/replay\.whatIf is off/i);

    await expect(
      applyReplayMaintenanceJob(admin, { pointsTypes: { repo_imported: 15 } })
    ).rejects.toThrow(/replay\.apply is off/i);
  });

  it("computes on-the-fly clamp-aware diffs without mutating DB and matches a from-scratch recompute under the same hypothetical config", async () => {
    const uSingleSource = await makeUser("single-source");
    const uCorroborated = await makeUser("corroborated");
    const tsSkill = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });

    const fixedNow = new Date("2026-05-01T00:00:00.000Z");

    // User 1 (single-source repo_imported only): 4 repos * 5 pts = 20 pts (L2 currently)
    for (let i = 0; i < 4; i++) {
      await appendEvent({
        userId: uSingleSource.id,
        source: "web",
        type: "repo_imported",
        skills: [tsSkill.id],
        occurredAt: fixedNow,
        now: fixedNow,
      });
    }

    // User 2 (corroborated: 4 repos + 1 quiz_completed of +20 pts = 40 pts, L2 currently)
    for (let i = 0; i < 4; i++) {
      await appendEvent({
        userId: uCorroborated.id,
        source: "web",
        type: "repo_imported",
        skills: [tsSkill.id],
        occurredAt: fixedNow,
        now: fixedNow,
      });
    }
    await appendEvent({
      userId: uCorroborated.id,
      source: "web",
      type: "quiz_completed",
      skills: [tsSkill.id],
      occurredAt: fixedNow,
      now: fixedNow,
      pointsOverride: 20,
    });

    // Enable replay.whatIf only
    await setReplayFeatureFlags(admin, {
      whatIfEnabled: true,
      applyEnabled: false,
    });

    // Hypothetical config: raise repo_imported from 5 -> 30 points!
    // Under hypothetical config:
    // - uSingleSource gets 4 * 30 = 120 pts -> unclamped rawLevel = L4 (>= 100),
    //   but single-source corroboration cap clamps level at L3!
    // - uCorroborated gets 4 * 30 + 20 = 140 pts -> rawLevel = L4, and since they have
    //   both repo + quiz sources, they uncap to L4!
    const candidateConfig = {
      pointsTypes: {
        ...DEFAULT_POINTS,
        repo_imported: 30,
      },
    };

    const replay = await runWhatIfReplay(admin, candidateConfig, {
      userIds: [uSingleSource.id, uCorroborated.id],
      skillIds: [tsSkill.id],
      now: fixedNow,
    });

    expect(replay.totalCellsEvaluated).toBe(2);
    expect(replay.perSkillDiffs).toHaveLength(1);
    expect(replay.perSkillDiffs[0].skillId).toBe(tsSkill.id);
    expect(replay.perSkillDiffs[0].avgCurrentScore).toBe(30); // (20 + 40) / 2
    expect(replay.perSkillDiffs[0].avgHypotheticalScore).toBe(130); // (120 + 140) / 2
    expect(replay.perSkillDiffs[0].clampedUsersHypothetical).toBe(1);

    // Clamp-effect row explicitly surfaces uSingleSource being clamped from L4 to L3
    expect(replay.clampEffectRows).toHaveLength(1);
    expect(replay.clampEffectRows[0].userId).toBe(uSingleSource.id);
    expect(replay.clampEffectRows[0].unclampedLevel).toBe(4);
    expect(replay.clampEffectRows[0].clampedLevel).toBe(3);

    // Verify on-the-fly replay did NOT mutate user_skills in DB
    const u1BeforeApply = await db.userSkill.findUniqueOrThrow({
      where: {
        userId_skillId: { userId: uSingleSource.id, skillId: tsSkill.id },
      },
    });
    expect(u1BeforeApply.score).toBe(20);
    expect(u1BeforeApply.level).toBe(2);

    // Replay correctness check: enable apply, run guarded apply maintenance job,
    // and verify that from-scratch recomputeUserSkill matches every cellDiff in replay!
    const eventCountBeforeApply = await db.eventLog.count({
      where: { userId: { in: [uSingleSource.id, uCorroborated.id] } },
    });

    await setReplayFeatureFlags(admin, {
      whatIfEnabled: true,
      applyEnabled: true,
    });

    const applied = await applyReplayMaintenanceJob(admin, candidateConfig, {
      userIds: [uSingleSource.id, uCorroborated.id],
      skillIds: [tsSkill.id],
      now: fixedNow,
    });
    expect(applied.rebuiltUserSkillCount).toBe(2);
    expect(applied.persistedConfigKeys).toContain("points.types");

    // Guarded apply never writes event_log rows
    const eventCountAfterApply = await db.eventLog.count({
      where: { userId: { in: [uSingleSource.id, uCorroborated.id] } },
    });
    expect(eventCountAfterApply).toBe(eventCountBeforeApply);

    for (const cell of replay.cellDiffs) {
      const fromScratch = await recomputeUserSkill(
        cell.userId,
        cell.skillId,
        fixedNow
      );
      expect(fromScratch.score).toBeCloseTo(cell.hypotheticalScore, 4);
      expect(fromScratch.level).toBe(cell.hypotheticalLevel);
    }
  });
});
