import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import {
  getDiscoverCards,
  buildFlagshipPrompt,
  logCardClick,
} from "@/services/shelf-match";
import {
  createPick,
  listPicks,
  pickMapFor,
  saveNote,
  setPickStatus,
} from "@/services/picks";
import { DISCOVER_FLAG } from "@/services/shelf";

const ID_BASE = 995_000_000;
const id = (n: number) => ID_BASE + n;

let userA: string; // evidenced typescript + claimed python + target "AI Engineer"
let userB: string; // empty spine
let tsId: string;
let pyId: string;
let goId: string;

async function skillIdByName(name: string) {
  const s = await db.skill.findFirst({ where: { name, status: "ACTIVE" } });
  if (!s) throw new Error(`seeded skill missing: ${name}`);
  return s.id;
}

beforeAll(async () => {
  await seedCanonicalSkills();
  tsId = await skillIdByName("typescript");
  pyId = await skillIdByName("python");
  goId = await skillIdByName("go");
  await db.featureFlag.upsert({
    where: { key: DISCOVER_FLAG },
    update: { enabled: true },
    create: { key: DISCOVER_FLAG, enabled: true },
  });
  const a = await db.user.create({
    data: { clerkId: `t_s3a_match_a_${Date.now()}` },
  });
  const b = await db.user.create({
    data: { clerkId: `t_s3a_match_b_${Date.now()}` },
  });
  userA = a.id;
  userB = b.id;

  await db.userSkill.create({
    data: { userId: userA, skillId: tsId, level: 3, score: 40 },
  });
  await db.userSkill.create({
    data: { userId: userA, skillId: pyId, claimedLevel: 2 },
  });
  await db.targetRole.create({
    data: { userId: userA, title: "AI Engineer", isPrimary: true },
  });
  await db.project.create({
    data: {
      userId: userA,
      title: "My own work",
      description: "imported",
      links: [`https://github.com/mine/excluded-repo`],
    },
  });

  await db.repo.createMany({
    data: [
      {
        githubId: id(1),
        fullName: "gems/ts-rag-tool",
        htmlUrl: "https://github.com/gems/ts-rag-tool",
        description: "RAG tool",
        language: "TypeScript",
        topics: ["rag"],
        skills: [tsId],
        stars: 845,
        bandKey: "solid",
        sizeKb: 25_000,
        score: 5,
        shelfEligible: true,
        laneSearch: true,
        velocityPerWeek: 10,
        sha: "s1",
      },
      {
        githubId: id(2),
        fullName: "gems/py-etl-kit",
        htmlUrl: "https://github.com/gems/py-etl-kit",
        description: "ETL kit",
        language: "Python",
        topics: ["etl"],
        skills: [pyId],
        stars: 300,
        bandKey: "solid",
        sizeKb: 900,
        score: 4,
        shelfEligible: true,
        laneList: true,
        crossListCount: 2,
        sha: "s2",
      },
      {
        githubId: id(3),
        fullName: "gems/go-proxier",
        htmlUrl: "https://github.com/gems/go-proxier",
        description: "Proxy in Go",
        language: "Go",
        topics: ["cli"],
        skills: [goId],
        stars: 120,
        bandKey: "underrated",
        sizeKb: 700,
        score: 3,
        shelfEligible: true,
        laneSearch: true,
        sha: "s3",
      },
      {
        githubId: id(4),
        fullName: "mine/excluded-repo",
        htmlUrl: "https://github.com/mine/excluded-repo",
        description: "the user's own repo",
        language: "TypeScript",
        skills: [tsId],
        stars: 900,
        bandKey: "solid",
        sizeKb: 800,
        score: 6,
        shelfEligible: true,
        sha: "s4",
      },
    ],
  });
});

afterAll(async () => {
  await db.recImpression.deleteMany({
    where: { repoGithubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.projectPick.deleteMany({
    where: { repoGithubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.note.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await db.repo.deleteMany({
    where: { githubId: { gte: ID_BASE, lt: ID_BASE + 100 } },
  });
  await db.project.deleteMany({ where: { userId: userA } });
  await db.targetRole.deleteMany({ where: { userId: userA } });
  await db.userSkill.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await db.preference.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await db.featureFlag.deleteMany({ where: { key: DISCOVER_FLAG } });
});

describe("getDiscoverCards (D93)", () => {
  it("ranks evidenced + archetype matches first, labels provenance, stretches one level up", async () => {
    const eventsBefore = await db.eventLog.count({ where: { userId: userA } });
    const res = await getDiscoverCards(userA, { logImpressions: true });

    expect(res.fallback).toBe(false);
    expect(res.cards[0].fullName).toBe("gems/ts-rag-tool");
    const top = res.cards[0];
    expect(top.fitLines.join(" ")).toContain(
      "matches your evidenced TypeScript"
    );
    expect(top.fitLines.join(" ")).toContain("AI / LLM engineer");
    expect(top.stretch).toBe(true); // difficulty 4 (25k kb) vs evidenced level 3
    expect(res.cards.some((c) => c.fullName === "gems/py-etl-kit")).toBe(true); // claimed hit ranks
    expect(res.cards.some((c) => c.fullName === "mine/excluded-repo")).toBe(
      false
    ); // D93 exclusion

    // Server-side impressions logged; ZERO evidence events (D94).
    const impressions = await db.recImpression.count({
      where: {
        userId: userA,
        repoGithubId: { gte: ID_BASE, lt: ID_BASE + 100 },
      },
    });
    expect(impressions).toBe(res.cards.length);
    expect(await db.eventLog.count({ where: { userId: userA } })).toBe(
      eventsBefore
    );
  });

  it("gap mode ranks new-skill repos first and persists via preference", async () => {
    const res = await getDiscoverCards(userA, { mode: "gaps" });
    expect(res.gapsMode).toBe(true);
    expect(res.cards[0].fullName).toBe("gems/go-proxier"); // go = a skill the user lacks
    expect(res.cards[0].fitLines.join(" ")).toContain("teaches you new skills");
  });

  it("empty spine falls back to the global top shelf with an honest explainer", async () => {
    const res = await getDiscoverCards(userB, { logImpressions: false });
    expect(res.fallback).toBe(true);
    expect(res.cards.length).toBeGreaterThan(0);
    expect(res.cards[0].fitLines.join(" ")).toContain("popular on the shelf");
  });
});

describe("click telemetry (D95)", () => {
  it("marks the latest impression clicked", async () => {
    await getDiscoverCards(userA, { logImpressions: true });
    await logCardClick(userA, id(1));
    const clicked = await db.recImpression.findFirst({
      where: { userId: userA, repoGithubId: id(1), clickedAt: { not: null } },
    });
    expect(clicked).not.toBeNull();
  });
});

describe("picks + notes (D94/D96b)", () => {
  it("creates, advances, and drops picks — never evidence", async () => {
    const eventsBefore = await db.eventLog.count({ where: { userId: userA } });
    await createPick(userA, id(1));
    expect((await pickMapFor(userA)).get(id(1))).toBe("considering");
    await setPickStatus(userA, id(1), "building");
    expect((await listPicks(userA))[0].status).toBe("building");
    await setPickStatus(userA, id(1), "dropped");
    expect((await pickMapFor(userA)).get(id(1))).toBeUndefined();
    expect(await db.eventLog.count({ where: { userId: userA } })).toBe(
      eventsBefore
    );
  });

  it("saves a flagship-brief note and builds the pre-filled prompt deterministically", async () => {
    const note = await saveNote({
      userId: userA,
      title: "Brief: ts-rag-tool",
      content: "The deep dive output…",
      repoGithubId: id(1),
    });
    expect(note.source).toBe("flagship_brief");

    const prompt = await buildFlagshipPrompt(userA, id(1));
    expect(prompt).toContain("gems/ts-rag-tool");
    expect(prompt).toContain("TypeScript"); // the user's skill context interpolated
    expect(prompt).not.toContain("{{"); // all slots filled
  });
});
