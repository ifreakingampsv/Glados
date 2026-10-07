import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import {
  normalizeTag,
  resolveSkillId,
  resolveTag,
  tagSkill,
} from "@/services/skills";

let user: User;
const marker = `t06_${Date.now()}`;
const uniqueTag = `quantumweaving${Date.now()}`;

beforeAll(async () => {
  await seedCanonicalSkills();
  user = await db.user.create({ data: { clerkId: `${marker}_user` } });
});

afterAll(async () => {
  await db.userSkill.deleteMany({ where: { userId: user.id } });
  await db.skillAlias.deleteMany({ where: { alias: { startsWith: marker } } });
  await db.skill.deleteMany({
    where: {
      OR: [
        { name: { startsWith: uniqueTag } },
        { name: { startsWith: marker } },
      ],
    },
  });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("normalization (D33a)", () => {
  it("lowercases, strips punctuation, folds homoglyphs", () => {
    expect(normalizeTag("Next.js")).toBe("nextjs");
    expect(normalizeTag("  TypeScript! ")).toBe("typescript");
    expect(normalizeTag("C++")).toBe("c++");
    expect(normalizeTag("re\u0430ct")).toBe("react"); // Cyrillic а in the middle
  });
});

describe("resolution ladder (D24 as amended by D33a)", () => {
  it("resolves exact canonical and alias hits invisibly", async () => {
    const ts = await resolveTag("typescript");
    expect(ts.status).toBe("resolved");

    const js = await resolveTag("js");
    expect(js.status).toBe("resolved");
    expect((js as { name: string }).name).toBe("javascript");
  });

  it("auto-accepts distance-1 typos only at normalized length ≥4", async () => {
    const koltin = await resolveTag("koltin"); // len 6, distance 1 → auto
    expect(koltin.status).toBe("resolved");
    expect((koltin as { name: string }).name).toBe("kotlin");

    const r = await resolveTag("r"); // distance 1 from "c", but len < 4 → chip
    expect(r.status).toBe("confirm");
  });

  it("sends the 2–3 distance zone to the confirm chip", async () => {
    const reactish = await resolveTag("reactjss"); // distance 2 from react
    expect(reactish.status).toBe("confirm");
    if (reactish.status === "confirm") {
      expect(reactish.choices.some((c) => c.name === "react")).toBe(true);
    }
  });

  it("dedupes candidates by normalized string", async () => {
    const first = await resolveTag(uniqueTag);
    expect(first.status).toBe("candidate");
    expect((first as { created: boolean }).created).toBe(true);

    const again = await resolveTag(uniqueTag.toUpperCase());
    expect((again as { skillId: string }).skillId).toBe(
      (first as { skillId: string }).skillId
    );
    expect((again as { created: boolean }).created).toBe(false);
  });
});

describe("tagging", () => {
  it("refuses to tag while a confirm chip is pending", async () => {
    await expect(tagSkill(user.id, "reactjss")).rejects.toThrow(
      "confirmation required"
    );
  });

  it("tags via confirmed chip pick and stores claimed level separately", async () => {
    const skill = await db.skill.findUnique({ where: { name: "react" } });
    const tagged = await tagSkill(user.id, "reactjss", {
      confirmedSkillId: skill!.id,
      claimedLevel: 4,
    });
    expect(tagged.skillId).toBe(skill!.id);
    expect(tagged.claimedLevel).toBe(4);
    expect(tagged.score).toBe(0); // claimed never feeds the score (D24)
  });

  it("validates claimed level bounds", async () => {
    await expect(
      tagSkill(user.id, "react", { claimedLevel: 9 })
    ).rejects.toThrow("1–5");
  });
});

describe("read-side merge resolution (D33b)", () => {
  it("follows aliasOf pointers to the canonical skill", async () => {
    const kotlin = await db.skill.findUnique({ where: { name: "kotlin" } });
    const merged = await db.skill.create({
      data: {
        name: `${marker}_kot`,
        display: "kot",
        status: "RETIRED",
        aliasOfId: kotlin!.id,
      },
    });
    expect(await resolveSkillId(merged.id)).toBe(kotlin!.id);
    await db.skill.delete({ where: { id: merged.id } });
  });
});
