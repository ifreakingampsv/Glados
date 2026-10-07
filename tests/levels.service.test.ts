import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { runDecaySweep, scoreForEvents } from "@/services/levels";
import { tagSkill } from "@/services/skills";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";

let user: User;
const marker = `t09_${Date.now()}`;
const DAY = 86_400_000;

beforeAll(async () => {
  await seedCanonicalSkills();
  await seedConfig();
  user = await db.user.create({ data: { clerkId: `${marker}_user` } });
});

afterAll(async () => {
  await db.userSkill.deleteMany({ where: { userId: user.id } });
  await db.eventLog.deleteMany({ where: { userId: user.id } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("decay math (D24: half-life 90 days)", () => {
  it("halves a 90-day-old event's weight", () => {
    const score = scoreForEvents([
      { points: 10, occurredAt: new Date(Date.now() - 90 * DAY) },
    ]);
    expect(score).toBeCloseTo(5, 5);
  });

  it("sums decayed contributions", () => {
    const score = scoreForEvents([
      { points: 10, occurredAt: new Date(Date.now() - 90 * DAY) },
      { points: 3, occurredAt: new Date() },
    ]);
    expect(score).toBeCloseTo(8, 5);
  });
});

describe("recompute (T09: single-writer cache)", () => {
  it("builds score + level purely from the log", async () => {
    const kotlin = (await db.skill.findUnique({ where: { name: "kotlin" } }))!;
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "manual_evidence",
      skills: [kotlin.id],
    });

    let cached = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: user.id, skillId: kotlin.id } },
    });
    expect(cached!.score).toBeCloseTo(3, 5);
    expect(cached!.level).toBe(0);

    await appendEvent({
      userId: user.id,
      source: "web",
      type: "interview_passed",
      skills: [kotlin.id],
    });
    cached = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: user.id, skillId: kotlin.id } },
    });
    expect(cached!.score).toBeCloseTo(13, 5); // 3 + 10, both fresh
    expect(cached!.level).toBe(1); // band ≥5
  });

  it("is replay-safe: same log → same state", async () => {
    const js = (await db.skill.findUnique({ where: { name: "javascript" } }))!;
    const { recomputeUserSkill } = await import("@/services/levels");
    const a = await recomputeUserSkill(user.id, js.id);
    const b = await recomputeUserSkill(user.id, js.id);
    expect(b.score).toBe(a.score);
    expect(b.level).toBe(a.level);
  });

  it("a claimed level never moves the evidenced score", async () => {
    const rust = (await db.skill.findUnique({ where: { name: "rust" } }))!;
    await tagSkill(user.id, "rust", { claimedLevel: 5 });
    const cached = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: user.id, skillId: rust.id } },
    });
    expect(cached!.claimedLevel).toBe(5);
    expect(cached!.score).toBe(0); // skill_tagged carries 0 points (D36)
    expect(cached!.level).toBe(0);
  });

  it("lands on the canonical skill when events reference a merged id", async () => {
    const python = (await db.skill.findUnique({ where: { name: "python" } }))!;
    const merged = await db.skill.create({
      data: {
        name: `${marker}_py`,
        display: "Py",
        status: "RETIRED",
        aliasOfId: python.id,
      },
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "interview_passed",
      skills: [merged.id],
    });
    const cached = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: user.id, skillId: python.id } },
    });
    expect(cached).not.toBeNull();
    expect(cached!.score).toBeCloseTo(10, 5);
    await db.skill.delete({ where: { id: merged.id } });
  });
});

describe("nightly decay sweep (T10)", () => {
  it("restores stale-high levels through the same writer", async () => {
    const go = (await db.skill.findUnique({ where: { name: "go" } }))!;
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "interview_passed",
      skills: [go.id],
    });

    // Simulate a stale cache after months of silence.
    await db.userSkill.update({
      where: { userId_skillId: { userId: user.id, skillId: go.id } },
      data: { score: 999 },
    });

    const recomputed = await runDecaySweep();
    expect(recomputed).toBeGreaterThanOrEqual(1);
    const cached = await db.userSkill.findUnique({
      where: { userId_skillId: { userId: user.id, skillId: go.id } },
    });
    expect(cached!.score).toBeCloseTo(10, 5); // restored from the log
    expect(cached!.level).toBe(1);
  });
});
