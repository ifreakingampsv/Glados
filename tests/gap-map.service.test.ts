import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { appendEvent } from "@/services/events";
import { createProject } from "@/services/projects";
import { setSelfAssessedSkillLevel } from "@/services/work-experience";
import {
  computeGapMap,
  resolveGapMapMode,
  setGapMapModePreference,
} from "@/services/gap-map";

describe("Gap map modes + fit score service (T11: deterministic fit formula, resume vs profile mode, evidence-wins merge, parent rollup, mode memory + auto-flip, anonymous-safe)", () => {
  let newUser: User;
  let strongUser: User;
  const marker = `t11_gap_${Date.now()}`;

  let tsId: string;
  let reactId: string;
  let frontendId: string;
  let pgId: string;
  let k8sId: string;

  beforeAll(async () => {
    await seedConfig();
    await seedCanonicalSkills();

    const [ts, react, frontend, pg, k8s] = await Promise.all([
      db.skill.findUniqueOrThrow({ where: { name: "typescript" } }),
      db.skill.findUniqueOrThrow({ where: { name: "react" } }),
      db.skill.findUniqueOrThrow({ where: { name: "frontend" } }),
      db.skill.findUniqueOrThrow({ where: { name: "postgresql" } }),
      db.skill.findUniqueOrThrow({ where: { name: "kubernetes" } }),
    ]);
    tsId = ts.id;
    reactId = react.id;
    frontendId = frontend.id;
    pgId = pg.id;
    k8sId = k8s.id;

    // Ensure react has parentId = frontend for parent-rollup verification
    if (react.parentId !== frontend.id) {
      await db.skill.update({
        where: { id: react.id },
        data: { parentId: frontend.id },
      });
    }

    [newUser, strongUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_new` } }),
      db.user.create({ data: { clerkId: `${marker}_strong` } }),
    ]);

    // Make strongUser meet gap.profileStrongThreshold (>=3 evidenced skills at L>=1 AND >=1 project with skills)
    for (let i = 0; i < 6; i++) {
      await appendEvent({
        userId: strongUser.id,
        source: "web",
        type: "interview_completed",
        skills: [tsId, reactId, pgId],
      });
    }
    await createProject(strongUser.id, {
      title: "Distributed SQL Engine",
      description: "TypeScript and PostgreSQL engine",
      skills: [tsId, pgId],
    });
    // Add a self-assessed claim on Kubernetes (0 evidence) for strongUser
    await setSelfAssessedSkillLevel(strongUser.id, "Kubernetes", 3);
  });

  afterAll(async () => {
    const uids = [newUser.id, strongUser.id];
    await db.preference.deleteMany({ where: { userId: { in: uids } } });
    await db.project.deleteMany({ where: { userId: { in: uids } } });
    await db.eventLog.deleteMany({ where: { userId: { in: uids } } });
    await db.userSkill.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("computes anonymous-safe resume-mode fit % and drills through to explainable per-skill credits with parent rollup", async () => {
    // Required: TypeScript (L3), Frontend (L3 - matched via child React!), Kubernetes (L3 - missing)
    const requirements = [
      { skillId: tsId, expectedLevel: 3 },
      { skillId: frontendId, expectedLevel: 3 },
      { skillId: k8sId, expectedLevel: 3 },
    ];

    // Transient claims: TypeScript (claimedLevel 3), React (claimedLevel 3 -> rolls up to parent Frontend)
    const res = await computeGapMap({
      mode: "resume",
      userId: null,
      requirements,
      transientClaims: [
        { skillId: tsId, claimedLevel: 3 },
        { skillId: reactId, claimedLevel: 3 },
      ],
    });

    // Math check:
    // credit(ts) = 0.5 (claim weight) * min(1, 3/3) = 0.5
    // credit(frontend via child react) = 0.5 * min(1, 3/3) = 0.5
    // credit(k8s) = 0
    // fit% = round(100 * (0.5 + 0.5 + 0) / 3) = round(33.333) = 33
    expect(res.fitPercent).toBe(33);
    expect(res.items).toHaveLength(3);

    const frontendItem = res.items.find(
      (i) => i.requiredSkillId === frontendId
    )!;
    expect(frontendItem.provenance).toBe("claimed");
    expect(frontendItem.matchedBySkillId).toBe(reactId);
    expect(frontendItem.credit).toBeCloseTo(0.5, 5);
    expect(frontendItem.explainerHref).toBe("/how-levels-work");

    const k8sItem = res.items.find((i) => i.requiredSkillId === k8sId)!;
    expect(k8sItem.provenance).toBe("missing");
    expect(k8sItem.credit).toBe(0);
  });

  it("applies profile-mode merge rule: evidence wins (weight 1.0), claims fill zero-evidence holes (weight 0.5), and labels every skill", async () => {
    // Also add a contradictory low claim on TypeScript (claimedLevel 1) to verify evidence wins
    await db.userSkill.update({
      where: { userId_skillId: { userId: strongUser.id, skillId: tsId } },
      data: { claimedLevel: 1, claimOrigins: ["resume"] },
    });

    const requirements = [
      { skillId: tsId, expectedLevel: 3 },
      { skillId: frontendId, expectedLevel: 3 },
      { skillId: k8sId, expectedLevel: 3 },
    ];

    const profileRes = await computeGapMap({
      mode: "profile",
      userId: strongUser.id,
      requirements,
    });

    // TypeScript has 60 pts -> L3 evidenced (weight 1.0 -> credit 1.0, ignoring claimedLevel: 1)
    // Frontend matched via child React (60 pts -> L3 evidenced, weight 1.0 -> credit 1.0)
    // Kubernetes has 0 evidence, filled by self-assessed L3 claim (weight 0.5 -> credit 0.5)
    // fit% = round(100 * (1.0 + 1.0 + 0.5) / 3) = round(83.333) = 83
    expect(profileRes.fitPercent).toBe(83);

    const tsItem = profileRes.items.find((i) => i.requiredSkillId === tsId)!;
    expect(tsItem.provenance).toBe("evidenced");
    expect(tsItem.credit).toBeCloseTo(1.0, 5);

    const k8sItem = profileRes.items.find((i) => i.requiredSkillId === k8sId)!;
    expect(k8sItem.provenance).toBe("self-assessed");
    expect(k8sItem.credit).toBeCloseTo(0.5, 5);
  });

  it("enforces mode memory priority: new user defaults to resume-only, strong profile auto-flips to profile when no explicit choice exists, and manual choice always wins", async () => {
    // 1. New user with no profile data -> resume mode, canToggleToProfile = false
    const newMode = await resolveGapMapMode(newUser.id);
    expect(newMode.mode).toBe("resume");
    expect(newMode.isExplicit).toBe(false);
    expect(newMode.canToggleToProfile).toBe(false);

    // 2. Strong user with no explicit choice -> auto-flips to profile mode
    const strongAuto = await resolveGapMapMode(strongUser.id);
    expect(strongAuto.mode).toBe("profile");
    expect(strongAuto.isExplicit).toBe(false);
    expect(strongAuto.isProfileStrong).toBe(true);
    expect(strongAuto.canToggleToProfile).toBe(true);

    // 3. Strong user manually selects resume mode -> manual choice persists and overrides auto-flip
    await setGapMapModePreference(strongUser.id, "resume");
    const strongManual = await resolveGapMapMode(strongUser.id);
    expect(strongManual.mode).toBe("resume");
    expect(strongManual.isExplicit).toBe(true);
  });
});
