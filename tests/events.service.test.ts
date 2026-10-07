import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { appendEvent, basePoints, listEvents } from "@/services/events";
import { resolveEventSkillDisplays } from "@/services/skills";
import { seedCanonicalSkills } from "@/services/seed-skills";

let user: User;
const marker = `t08_${Date.now()}`;

beforeAll(async () => {
  await seedCanonicalSkills();
  user = await db.user.create({ data: { clerkId: `${marker}_user` } });
});

afterAll(async () => {
  await db.eventLog.deleteMany({ where: { userId: user.id } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("event log (T08: append-only, clamped, trust-weighted)", () => {
  it("snapshots base_points(type, source) at write time", async () => {
    expect(await basePoints("manual_evidence", "web")).toBe(3);
    expect(await basePoints("manual_evidence", "agent_plugin")).toBe(2); // claim grade (D29)
    expect(await basePoints("skill_tagged", "web")).toBe(0);
  });

  it("clamps future-dated occurredAt to now (decay can't be gamed)", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const event = await appendEvent({
      userId: user.id,
      source: "web",
      type: "manual_evidence",
      occurredAt: future,
    });
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(event.occurredAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("rejects unknown types and sources", async () => {
    await expect(
      appendEvent({
        userId: user.id,
        source: "web",
        type: "made_up" as "manual_evidence",
      })
    ).rejects.toThrow("unknown event type");
    await expect(
      appendEvent({
        userId: user.id,
        source: "spoofed" as "web",
        type: "manual_evidence",
      })
    ).rejects.toThrow("unknown source");
  });

  it("lists newest first", async () => {
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "quiz_completed",
    });
    const events = await listEvents(user.id);
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].occurredAt.getTime()).toBeGreaterThanOrEqual(
        events[i].occurredAt.getTime()
      );
    }
  });

  it("resolves merged skill references through aliasOf at read time", async () => {
    const kotlin = await db.skill.findUnique({ where: { name: "kotlin" } });
    const merged = await db.skill.create({
      data: {
        name: `${marker}_kotlang`,
        display: "KotLang",
        status: "RETIRED",
        aliasOfId: kotlin!.id,
      },
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "manual_evidence",
      skills: [merged.id],
    });
    const events = await listEvents(user.id);
    const displays = await resolveEventSkillDisplays(events[0].skills);
    expect(displays).toEqual(["Kotlin"]);
    await db.skill.delete({ where: { id: merged.id } });
  });
});
