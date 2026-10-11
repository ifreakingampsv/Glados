import { db } from "@/lib/db";
import { resolveSkillId } from "@/lib/skill-resolution";
import { getConfig } from "@/services/levels";
import { setPreference } from "@/services/profile";
import {
  DEFAULT_FIT_WEIGHTS,
  DEFAULT_PROFILE_STRONG_THRESHOLD,
} from "@/services/seed-config";

export type GapMapMode = "resume" | "profile";

export interface FitWeightsConfig {
  evidenced: number;
  claim: number;
  expectedLevel: number;
}

export interface ProfileStrongThresholdConfig {
  minEvidencedSkills: number;
  minLevel: number;
  minProjectsWithSkills: number;
}

export interface GapRequirementInput {
  skillId: string;
  expectedLevel?: number;
}

export interface TransientClaimInput {
  skillId: string;
  claimedLevel?: number;
  origin?: "resume" | "linkedin" | "self";
}

export interface GapMapSkillItem {
  requiredSkillId: string;
  requiredSkillName: string;
  requiredSkillDisplay: string;
  matchedBySkillId: string | null;
  matchedByDisplay: string | null;
  status: "matched" | "partial" | "missing";
  provenance: "evidenced" | "self-assessed" | "claimed" | "missing";
  effectiveLevel: number;
  expectedLevel: number;
  provenanceWeight: number;
  credit: number;
  explainerHref: string;
}

export interface GapMapResult {
  mode: GapMapMode;
  fitPercent: number;
  totalCredit: number;
  requiredCount: number;
  items: GapMapSkillItem[];
  topGaps: GapMapSkillItem[];
}

interface CandidateHaveSkill {
  skillId: string;
  display: string;
  provenance: "evidenced" | "self-assessed" | "claimed";
  effectiveLevel: number;
  provenanceWeight: number;
}

export async function resolveGapMapMode(userId: string | null): Promise<{
  mode: GapMapMode;
  isExplicit: boolean;
  isProfileStrong: boolean;
  canToggleToProfile: boolean;
}> {
  if (!userId) {
    return {
      mode: "resume",
      isExplicit: false,
      isProfileStrong: false,
      canToggleToProfile: false,
    };
  }

  const threshold = await getConfig<ProfileStrongThresholdConfig>(
    "gap.profileStrongThreshold",
    DEFAULT_PROFILE_STRONG_THRESHOLD
  );

  const [pref, userSkills, projects, workExpCount] = await Promise.all([
    db.preference.findUnique({
      where: { userId_key: { userId, key: "gap_map_mode" } },
    }),
    db.userSkill.findMany({ where: { userId } }),
    db.project.findMany({ where: { userId } }),
    db.workExperience.count({ where: { userId } }),
  ]);

  const evidencedCount = userSkills.filter(
    (us) => us.level >= (threshold.minLevel ?? 1)
  ).length;
  const projectsWithSkills = projects.filter(
    (p) => (p.skills ?? []).length > 0
  ).length;

  const isProfileStrong =
    evidencedCount >= (threshold.minEvidencedSkills ?? 3) &&
    projectsWithSkills >= (threshold.minProjectsWithSkills ?? 1);

  const hasAnyProfileData =
    userSkills.length > 0 || projects.length > 0 || workExpCount > 0;

  if (pref && (pref.value === "resume" || pref.value === "profile")) {
    return {
      mode: pref.value,
      isExplicit: true,
      isProfileStrong,
      canToggleToProfile: hasAnyProfileData,
    };
  }

  if (isProfileStrong) {
    return {
      mode: "profile",
      isExplicit: false,
      isProfileStrong: true,
      canToggleToProfile: true,
    };
  }

  return {
    mode: "resume",
    isExplicit: false,
    isProfileStrong: false,
    canToggleToProfile: hasAnyProfileData,
  };
}

export async function setGapMapModePreference(
  userId: string,
  mode: GapMapMode
) {
  return setPreference(userId, "gap_map_mode", mode);
}

export async function computeGapMap(input: {
  mode: GapMapMode;
  userId: string | null;
  requirements: GapRequirementInput[];
  transientClaims?: TransientClaimInput[];
}): Promise<GapMapResult> {
  const weights = await getConfig<FitWeightsConfig>(
    "gap.fitWeights",
    DEFAULT_FIT_WEIGHTS
  );

  const allSkills = await db.skill.findMany({
    where: { status: { in: ["ACTIVE", "CANDIDATE"] } },
  });
  const skillById = new Map(allSkills.map((s) => [s.id, s]));

  // Build parent -> children map for D27 parent rollup
  const childrenByParentId = new Map<string, string[]>();
  for (const s of allSkills) {
    if (s.parentId) {
      const list = childrenByParentId.get(s.parentId) ?? [];
      list.push(s.id);
      childrenByParentId.set(s.parentId, list);
    }
  }

  // Build haveMap: skillId -> CandidateHaveSkill
  const haveMap = new Map<string, CandidateHaveSkill>();

  if (input.mode === "resume") {
    if (input.transientClaims && input.transientClaims.length > 0) {
      for (const tc of input.transientClaims) {
        const canonicalId = await resolveSkillId(tc.skillId);
        const sRow = skillById.get(canonicalId);
        if (!sRow) continue;
        const level = Math.min(
          5,
          Math.max(1, Math.round(tc.claimedLevel ?? 1))
        );
        const prov = tc.origin === "self" ? "self-assessed" : "claimed";
        const existing = haveMap.get(canonicalId);
        if (!existing || level > existing.effectiveLevel) {
          haveMap.set(canonicalId, {
            skillId: canonicalId,
            display: sRow.display,
            provenance: prov,
            effectiveLevel: level,
            provenanceWeight: weights.claim,
          });
        }
      }
    } else if (input.userId) {
      const userSkills = await db.userSkill.findMany({
        where: { userId: input.userId },
      });
      for (const us of userSkills) {
        if (!us.claimedLevel && (us.claimOrigins ?? []).length === 0) continue;
        const canonicalId = await resolveSkillId(us.skillId);
        const sRow = skillById.get(canonicalId);
        if (!sRow) continue;
        const level = Math.min(
          5,
          Math.max(1, Math.round(us.claimedLevel ?? 1))
        );
        const prov = (us.claimOrigins ?? []).includes("self")
          ? "self-assessed"
          : "claimed";
        haveMap.set(canonicalId, {
          skillId: canonicalId,
          display: sRow.display,
          provenance: prov,
          effectiveLevel: level,
          provenanceWeight: weights.claim,
        });
      }
    }
  } else if (input.userId) {
    // Profile mode: evidenced levels + projects.skills (evidence always wins), claims fill 0-evidence holes
    const [userSkills, projects] = await Promise.all([
      db.userSkill.findMany({ where: { userId: input.userId } }),
      db.project.findMany({ where: { userId: input.userId } }),
    ]);

    const projectSkillIds = new Set<string>();
    for (const p of projects) {
      for (const rawId of p.skills ?? []) {
        try {
          projectSkillIds.add(await resolveSkillId(rawId));
        } catch {
          // ignore unknown
        }
      }
    }

    for (const us of userSkills) {
      const canonicalId = await resolveSkillId(us.skillId);
      const sRow = skillById.get(canonicalId);
      if (!sRow) continue;

      const hasProjEvidence = projectSkillIds.has(canonicalId);
      if (us.level > 0 || us.score > 0 || hasProjEvidence) {
        // Evidence wins!
        const effectiveLevel = Math.max(1, us.level);
        haveMap.set(canonicalId, {
          skillId: canonicalId,
          display: sRow.display,
          provenance: "evidenced",
          effectiveLevel,
          provenanceWeight: weights.evidenced,
        });
      } else if (us.claimedLevel || (us.claimOrigins ?? []).length > 0) {
        // Fill zero-evidence hole with claim / self-assessment
        const prov = (us.claimOrigins ?? []).includes("self")
          ? "self-assessed"
          : "claimed";
        haveMap.set(canonicalId, {
          skillId: canonicalId,
          display: sRow.display,
          provenance: prov,
          effectiveLevel: Math.min(
            5,
            Math.max(1, Math.round(us.claimedLevel ?? 1))
          ),
          provenanceWeight: weights.claim,
        });
      }
    }

    // Any project skill without a UserSkill row still counts as L1 project-backed evidence
    for (const projSkillId of projectSkillIds) {
      if (!haveMap.has(projSkillId)) {
        const sRow = skillById.get(projSkillId);
        if (!sRow) continue;
        haveMap.set(projSkillId, {
          skillId: projSkillId,
          display: sRow.display,
          provenance: "evidenced",
          effectiveLevel: 1,
          provenanceWeight: weights.evidenced,
        });
      }
    }
  }

  // Evaluate required skills with parent rollup
  const items: GapMapSkillItem[] = [];
  let totalCredit = 0;

  for (const req of input.requirements) {
    const canonicalReqId = await resolveSkillId(req.skillId);
    const reqSkill = skillById.get(canonicalReqId);
    if (!reqSkill) continue;

    const expectedLevel = Math.max(
      1,
      req.expectedLevel ?? weights.expectedLevel ?? 3
    );

    const candidateIds = [
      canonicalReqId,
      ...(childrenByParentId.get(canonicalReqId) ?? []),
    ];

    let bestCandidate: CandidateHaveSkill | null = null;
    let bestCredit = 0;

    for (const cid of candidateIds) {
      const candidate = haveMap.get(cid);
      if (!candidate) continue;
      const credit =
        candidate.provenanceWeight *
        Math.min(1, candidate.effectiveLevel / expectedLevel);
      if (
        !bestCandidate ||
        credit > bestCredit ||
        (credit === bestCredit &&
          candidate.provenance === "evidenced" &&
          bestCandidate.provenance !== "evidenced")
      ) {
        bestCandidate = candidate;
        bestCredit = credit;
      }
    }

    if (!bestCandidate) {
      items.push({
        requiredSkillId: canonicalReqId,
        requiredSkillName: reqSkill.name,
        requiredSkillDisplay: reqSkill.display,
        matchedBySkillId: null,
        matchedByDisplay: null,
        status: "missing",
        provenance: "missing",
        effectiveLevel: 0,
        expectedLevel,
        provenanceWeight: 0,
        credit: 0,
        explainerHref: "/how-levels-work",
      });
    } else {
      totalCredit += bestCredit;
      items.push({
        requiredSkillId: canonicalReqId,
        requiredSkillName: reqSkill.name,
        requiredSkillDisplay: reqSkill.display,
        matchedBySkillId: bestCandidate.skillId,
        matchedByDisplay: bestCandidate.display,
        status: bestCredit >= 1 ? "matched" : "partial",
        provenance: bestCandidate.provenance,
        effectiveLevel: bestCandidate.effectiveLevel,
        expectedLevel,
        provenanceWeight: bestCandidate.provenanceWeight,
        credit: bestCredit,
        explainerHref: "/how-levels-work",
      });
    }
  }

  const requiredCount = items.length;
  const fitPercent =
    requiredCount === 0 ? 100 : Math.round((100 * totalCredit) / requiredCount);

  const topGaps = [...items]
    .filter((i) => i.credit < 1)
    .sort((a, b) => a.credit - b.credit)
    .slice(0, 3);

  return {
    mode: input.mode,
    fitPercent,
    totalCredit,
    requiredCount,
    items,
    topGaps,
  };
}
