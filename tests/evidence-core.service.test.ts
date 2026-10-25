import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { appendEvent } from "@/services/events";
import {
  CORROBORATION_CAP_LEVEL,
  getConfig,
  getDecayedQuizContribution,
  recomputeUserSkill,
  scoreForEvents,
} from "@/services/levels";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";

const DAY_MS = 86_400_000;

describe("S1.5 T01: Evidence core — negative lane, decayed quiz floor, and L3 corroboration cap", () => {
  let user: User;
  const marker = `s15_t01_${Date.now()}`;

  beforeAll(async () => {
    await seedCanonicalSkills();
    await seedConfig();
    await seedRoutes();
    user = await db.user.create({ data: { clerkId: `${marker}_user` } });
  });

  afterAll(async () => {
    await db.userSkill.deleteMany({ where: { userId: user.id } });
    await db.eventLog.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("bounds negative quiz deltas so quiz contribution hits 0 and never touches non-quiz evidence", async () => {
    const react = await db.skill.findUniqueOrThrow({
      where: { name: "react" },
    });
    const t0 = new Date("2026-03-01T00:00:00.000Z");

    // Non-quiz evidence: repo (10 pts) + work experience (8 pts) + certificate (6 pts) = 24 pts
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "repo_imported",
      skills: [react.id],
      occurredAt: t0,
      now: t0,
      pointsOverride: 10,
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "work_experience_added",
      skills: [react.id],
      occurredAt: t0,
      now: t0,
      pointsOverride: 8,
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "certificate_added",
      skills: [react.id],
      occurredAt: t0,
      now: t0,
      pointsOverride: 6,
    });

    // Initial quiz: +12 points at t0
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [react.id],
      occurredAt: t0,
      now: t0,
      pointsOverride: 12,
    });

    let us = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: react.id } },
    });
    expect(us.score).toBeCloseTo(36, 5);

    // Terrible retake attempting -50 at t0: bounded to -12 so quiz contribution is 0 and non-quiz 24 pts stays intact
    const retakeEvent = await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [react.id],
      occurredAt: t0,
      now: t0,
      pointsOverride: -50,
    });
    expect(retakeEvent.points).toBe(-12);

    const quizContrib = await getDecayedQuizContribution(user.id, react.id, t0);
    expect(quizContrib).toBe(0);

    us = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: react.id } },
    });
    expect(us.score).toBeCloseTo(24, 5);
  });

  it("pins the January +16 decay edge: July retake at -8 lands decayed quiz contribution at 0 and sign never goes negative at any future read time", async () => {
    const ts = await db.skill.findUniqueOrThrow({
      where: { name: "typescript" },
    });

    // Trace 1: 90-day half-life elapsed (Jan -> 90d later: +16 decays to +8; retake -8 lands at 0)
    const jan = new Date("2026-01-01T00:00:00.000Z");
    const afterOneHalfLife = new Date(jan.getTime() + 90 * DAY_MS);

    await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [ts.id],
      occurredAt: jan,
      now: jan,
      pointsOverride: 16,
    });

    expect(
      await getDecayedQuizContribution(user.id, ts.id, afterOneHalfLife)
    ).toBeCloseTo(8, 6);

    const retake90 = await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [ts.id],
      occurredAt: afterOneHalfLife,
      now: afterOneHalfLife,
      pointsOverride: -8,
    });
    expect(retake90.points).toBe(-8);
    expect(
      await getDecayedQuizContribution(user.id, ts.id, afterOneHalfLife)
    ).toBeCloseTo(0, 6);

    // Trace 2: 180-day (Jan 1 -> June 30 / July: 2 half-lives, +16 decays to +4; retake -8 clamps to -4 and lands at 0)
    const py = await db.skill.findUniqueOrThrow({ where: { name: "python" } });
    const july = new Date(jan.getTime() + 180 * DAY_MS);

    // Also add a non-quiz repo event so we verify it is never eaten
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "repo_imported",
      skills: [py.id],
      occurredAt: july,
      now: july,
      pointsOverride: 20,
    });

    await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [py.id],
      occurredAt: jan,
      now: jan,
      pointsOverride: 16,
    });

    // At July (180 days), +16 has decayed to +4
    expect(await getDecayedQuizContribution(user.id, py.id, july)).toBeCloseTo(
      4,
      6
    );

    // Retake attempting -8 in July is clamped to -4 so decayed quiz contribution lands at 0
    const julyRetake = await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [py.id],
      occurredAt: july,
      now: july,
      pointsOverride: -8,
    });
    expect(julyRetake.points).toBe(-4);

    const quizEvents = await db.eventLog.findMany({
      where: {
        userId: user.id,
        type: "quiz_completed",
        skills: { has: py.id },
      },
      select: { points: true, occurredAt: true },
    });

    // Uniform exponential decay preserves sign at EVERY future read time
    for (const extraDays of [0, 1, 30, 90, 180, 365, 730]) {
      const readClock = new Date(july.getTime() + extraDays * DAY_MS);
      const rawQuizSum = scoreForEvents(quizEvents, readClock);
      expect(rawQuizSum).toBeCloseTo(0, 6);
      expect(rawQuizSum).toBeGreaterThanOrEqual(-1e-9);

      const recomputed = await recomputeUserSkill(user.id, py.id, readClock);
      const expectedRepoOnly = 20 * Math.pow(0.5, extraDays / 90);
      expect(recomputed.score).toBeCloseTo(expectedRepoOnly, 5);
    }
  });

  it("clamps single-source cap-limited skills (repo-only, work-exp-only, quiz-only, cert-only) at L3 and uncaps on any second source type", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const [go, rust, docker, postgres, node] = await Promise.all([
      db.skill.findUniqueOrThrow({ where: { name: "go" } }),
      db.skill.findUniqueOrThrow({ where: { name: "rust" } }),
      db.skill.findUniqueOrThrow({ where: { name: "docker" } }),
      db.skill.findUniqueOrThrow({ where: { name: "postgresql" } }),
      db.skill.findUniqueOrThrow({ where: { name: "nodejs" } }),
    ]);

    expect(CORROBORATION_CAP_LEVEL).toBe(3);

    // 1. Repo-only with 250 points (raw L5) -> clamps at L3
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "repo_imported",
      skills: [go.id],
      occurredAt: now,
      now,
      pointsOverride: 250,
    });
    const goSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: go.id } },
    });
    expect(goSkill.score).toBeCloseTo(250, 5);
    expect(goSkill.level).toBe(3);

    // 2. Work-experience-only (added + confirmed = same source bucket) with 250 points -> clamps at L3
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "work_experience_added",
      skills: [rust.id],
      occurredAt: now,
      now,
      pointsOverride: 200,
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "work_experience_confirmed",
      skills: [rust.id],
      occurredAt: now,
      now,
      pointsOverride: 50,
    });
    const rustSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: rust.id } },
    });
    expect(rustSkill.score).toBeCloseTo(250, 5);
    expect(rustSkill.level).toBe(3);

    // 3. Quiz-only with 250 points -> clamps at L3
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [docker.id],
      occurredAt: now,
      now,
      pointsOverride: 250,
    });
    const dockerSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: docker.id } },
    });
    expect(dockerSkill.score).toBeCloseTo(250, 5);
    expect(dockerSkill.level).toBe(3);

    // 4. Certificate-only with 250 points -> clamps at L3
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "certificate_added",
      skills: [postgres.id],
      occurredAt: now,
      now,
      pointsOverride: 250,
    });
    const pgSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: postgres.id } },
    });
    expect(pgSkill.score).toBeCloseTo(250, 5);
    expect(pgSkill.level).toBe(3);

    // 5. Adding a second source type (quiz on Go, which already has repo) uncaps Go to L5!
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
      skills: [go.id],
      occurredAt: now,
      now,
      pointsOverride: 10,
    });
    const goUncapped = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: go.id } },
    });
    expect(goUncapped.score).toBeCloseTo(260, 5);
    expect(goUncapped.level).toBe(5);

    // 6. S2 interview_completed uncaps as well
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "interview_completed",
      skills: [node.id],
      occurredAt: now,
      now,
      pointsOverride: 120,
    });
    const nodeSkill = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: node.id } },
    });
    expect(nodeSkill.level).toBe(4);
  });

  it("seeds S1.5 config rows and gateway routes idempotently without overwriting tuned values", async () => {
    await seedConfig();
    await seedRoutes();

    const roundSize = await getConfig<number>("quiz.roundSize", 0);
    const cap = await getConfig<number>("quiz.cap", 0);
    const cooldownDays = await getConfig<number>("quiz.cooldownDays", 0);
    const minCommits = await getConfig<number>(
      "posts.minCommitsPerMilestone",
      0
    );
    const maxPosts = await getConfig<number>("posts.maxPerWeek", 0);
    const providers = await getConfig<Array<{ slug: string }>>(
      "certs.providers",
      []
    );
    const pointTypes = await getConfig<Record<string, number>>(
      "points.types",
      {}
    );

    expect(roundSize).toBe(6);
    expect(cap).toBe(18);
    expect(cooldownDays).toBe(7);
    expect(minCommits).toBe(10);
    expect(maxPosts).toBe(2);
    expect(providers.length).toBeGreaterThanOrEqual(10);
    expect(pointTypes.certificate_added).toBe(5);
    expect(pointTypes.post_drafted).toBe(0);

    // Ensure structural clamp has no config row (structural by design)
    const clampConfig = await db.config.findUnique({
      where: { key: "levels.corroborationCap" },
    });
    expect(clampConfig).toBeNull();
  });
});
