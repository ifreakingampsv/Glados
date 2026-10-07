import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { resolveSkillId } from "@/services/skills";
import {
  approveCandidate,
  mergeCandidate,
  rejectCandidate,
} from "@/services/skill-admin";
import { seedCanonicalSkills } from "@/services/seed-skills";

let admin: User;
let user: User;
const marker = `t07_${Date.now()}`;

beforeAll(async () => {
  await seedCanonicalSkills();
  [admin, user] = await Promise.all([
    db.user.create({ data: { clerkId: `${marker}_admin`, role: "ADMIN" } }),
    db.user.create({ data: { clerkId: `${marker}_user` } }),
  ]);
});

afterAll(async () => {
  await db.eventLog.deleteMany({ where: { userId: user.id } });
  await db.userSkill.deleteMany({ where: { userId: user.id } });
  await db.skillAlias.deleteMany({ where: { alias: { startsWith: marker } } });
  await db.skill.deleteMany({ where: { name: { startsWith: marker } } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("candidate queue (T07: approve / merge / reject)", () => {
  it("blocks non-admins", async () => {
    const candidate = await db.skill.create({
      data: { name: `${marker}_cand`, display: "Cand", status: "CANDIDATE" },
    });
    await expect(approveCandidate(user, candidate.id)).rejects.toThrow(
      "admin role required"
    );
    await db.skill.delete({ where: { id: candidate.id } });
  });

  it("approves a candidate into the canonical list", async () => {
    const candidate = await db.skill.create({
      data: {
        name: `${marker}_approve`,
        display: "Approvable",
        status: "CANDIDATE",
      },
    });
    const approved = await approveCandidate(admin, candidate.id);
    expect(approved.status).toBe("ACTIVE");
  });

  it("merge retires with an alias pointer and old references resolve", async () => {
    const candidate = await db.skill.create({
      data: { name: `${marker}_kot`, display: "Kot", status: "CANDIDATE" },
    });
    const kotlin = (await db.skill.findUnique({ where: { name: "kotlin" } }))!;

    await mergeCandidate(admin, candidate.id, kotlin.id);
    const merged = await db.skill.findUnique({ where: { id: candidate.id } });
    expect(merged?.status).toBe("RETIRED");
    expect(merged?.aliasOfId).toBe(kotlin.id);
    expect(await resolveSkillId(candidate.id)).toBe(kotlin.id);
  });

  it("reject is refused once events reference the candidate — merge only (D33b)", async () => {
    const candidate = await db.skill.create({
      data: {
        name: `${marker}_evidenced`,
        display: "Evidenced",
        status: "CANDIDATE",
      },
    });
    await appendEvent({
      userId: user.id,
      source: "web",
      type: "manual_evidence",
      skills: [candidate.id],
    });

    await expect(rejectCandidate(admin, candidate.id)).rejects.toThrow(
      "merge instead"
    );
  });

  it("rejects unreferenced candidates (retired, never deleted)", async () => {
    const candidate = await db.skill.create({
      data: { name: `${marker}_junk`, display: "Junk", status: "CANDIDATE" },
    });
    const rejected = await rejectCandidate(admin, candidate.id);
    expect(rejected.status).toBe("RETIRED");
    const stillThere = await db.skill.findUnique({
      where: { id: candidate.id },
    });
    expect(stillThere).not.toBeNull();
  });
});
