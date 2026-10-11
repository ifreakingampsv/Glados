import { Prisma } from "@prisma/client";
import { db, type UserSkill } from "@/lib/db";
import { resolveSkillId } from "@/lib/skill-resolution";
import { appendEvent } from "@/services/events";
import { getConfig } from "@/services/levels";
import { createProject } from "@/services/projects";
import type { ParsedResumeDocument } from "@/services/resume-parse";
import { DEFAULT_WORK_EXP_SCORER } from "@/services/seed-config";
import {
  AUTO_ACCEPT_MIN_LENGTH,
  editDistance,
  normalizeTag,
} from "@/services/skills";

export interface WorkExpScorerConfig {
  jobBasePoints: number;
  internshipBasePoints: number;
  maxYearsMultiplier: number;
  minSpecMultiplier: number;
  maxSpecMultiplier: number;
  depthCharsForFull: number;
  stackMentionsForFull: number;
}

export interface WorkExpScoreInput {
  kind: "job" | "internship" | string;
  durationMonths: number;
  description: string;
  resolvedSkillCount: number;
}

export function computeWorkExperiencePoints(
  input: WorkExpScoreInput,
  config: WorkExpScorerConfig = DEFAULT_WORK_EXP_SCORER
): number {
  if (input.resolvedSkillCount <= 0) return 0;
  const basePoints =
    input.kind === "internship"
      ? config.internshipBasePoints
      : config.jobBasePoints;

  const years = Math.max(0.25, (input.durationMonths || 12) / 12);
  const durationMultiplier = Math.min(config.maxYearsMultiplier, years);

  const depthRatio = Math.min(
    1,
    input.description.trim().length / Math.max(1, config.depthCharsForFull)
  );
  const stackRatio = Math.min(
    1,
    input.resolvedSkillCount / Math.max(1, config.stackMentionsForFull)
  );
  const rawSpecificity = (depthRatio + stackRatio) / 2;
  const specMultiplier =
    config.minSpecMultiplier +
    rawSpecificity * (config.maxSpecMultiplier - config.minSpecMultiplier);

  return Math.max(
    1,
    Math.round(basePoints * durationMultiplier * specMultiplier)
  );
}

export async function resolveCanonicalSkillByNameOrAlias(
  rawName: string
): Promise<string | null> {
  const tag = normalizeTag(rawName);
  if (!tag) return null;

  const exact = await db.skill.findFirst({
    where: { name: tag, status: "ACTIVE" },
  });
  if (exact) return resolveSkillId(exact.id);

  const alias = await db.skillAlias.findUnique({ where: { alias: tag } });
  if (alias) {
    const target = await db.skill.findUnique({ where: { id: alias.skillId } });
    if (target && target.status === "ACTIVE") {
      return resolveSkillId(target.id);
    }
  }

  if (tag.length >= AUTO_ACCEPT_MIN_LENGTH) {
    const activeSkills = await db.skill.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
    });
    for (const s of activeSkills) {
      if (editDistance(tag, s.name) <= 1) {
        return resolveSkillId(s.id);
      }
    }
  }

  return null;
}

export function describeUserSkillProvenance(
  userSkill: Pick<
    UserSkill,
    "score" | "level" | "claimedLevel" | "claimOrigins" | "staleOrigins"
  >,
  hasProjectEvidence = false
): {
  tier: "evidenced" | "self-assessed" | "claimed";
  label: string;
  explainerHref: string;
  isUnvalidated: boolean;
  isStale: boolean;
} {
  const isStale = (userSkill.staleOrigins ?? []).length > 0;
  if (userSkill.level > 0 || userSkill.score > 0 || hasProjectEvidence) {
    return {
      tier: "evidenced",
      label: "evidenced",
      explainerHref: "/how-levels-work",
      isUnvalidated: false,
      isStale: false,
    };
  }
  const origins = userSkill.claimOrigins ?? [];
  if (origins.includes("self")) {
    return {
      tier: "self-assessed",
      label: "self-assessed (unvalidated)",
      explainerHref: "/how-levels-work",
      isUnvalidated: true,
      isStale,
    };
  }
  return {
    tier: "claimed",
    label: isStale ? "unvalidated claim (stale)" : "unvalidated claim",
    explainerHref: "/how-levels-work",
    isUnvalidated: true,
    isStale,
  };
}

export async function writeBackParsedResumeToProfile(
  userId: string,
  parsed: ParsedResumeDocument,
  source: "resume" | "linkedin" = "resume"
) {
  const scorerConfig = await getConfig<WorkExpScorerConfig>(
    "workExperience.scorer",
    DEFAULT_WORK_EXP_SCORER
  );

  // Resolve skill names upfront
  const resolvedClaims: Array<{ skillId: string; claimedLevel: number }> = [];
  for (const s of parsed.skills ?? []) {
    const skillId = await resolveCanonicalSkillByNameOrAlias(s.name);
    if (skillId) {
      const level = Math.min(5, Math.max(1, Math.round(s.claimedLevel ?? 2)));
      resolvedClaims.push({ skillId, claimedLevel: level });
    }
  }

  const resolvedExperiences: Array<{
    employer: string;
    title: string;
    period: string;
    durationMonths: number;
    kind: string;
    description: string;
    skills: string[];
    points: number;
  }> = [];

  for (const exp of parsed.workExperiences ?? []) {
    const expSkillIds = new Set<string>();
    for (const rawSkill of exp.skills ?? []) {
      const id = await resolveCanonicalSkillByNameOrAlias(rawSkill);
      if (id) expSkillIds.add(id);
    }
    const skills = Array.from(expSkillIds);
    const kind = exp.kind === "internship" ? "internship" : "job";
    const durationMonths = Math.max(1, Math.round(exp.durationMonths ?? 12));
    const points = computeWorkExperiencePoints(
      {
        kind,
        durationMonths,
        description: exp.description ?? "",
        resolvedSkillCount: skills.length,
      },
      scorerConfig
    );
    resolvedExperiences.push({
      employer: exp.employer.trim() || "Unknown Employer",
      title: exp.title.trim() || "Role",
      period: exp.period.trim() || "Present",
      durationMonths,
      kind,
      description: exp.description.trim(),
      skills,
      points,
    });
  }

  // Write profile + claims + work_experiences + resume_blocks in ONE transaction
  const txResult = await db.$transaction(async (tx) => {
    const existingProfile = await tx.profile.findUnique({ where: { userId } });
    const currentFields =
      existingProfile?.fields && typeof existingProfile.fields === "object"
        ? (existingProfile.fields as Record<string, unknown>)
        : {};
    const profile = await tx.profile.upsert({
      where: { userId },
      update: {
        fields: {
          ...currentFields,
          summary: parsed.summary || currentFields.summary || "",
          education: parsed.education ?? currentFields.education ?? [],
        } as unknown as Prisma.InputJsonValue,
      },
      create: {
        userId,
        fields: {
          summary: parsed.summary || "",
          education: parsed.education ?? [],
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const userSkills = [];
    for (const claim of resolvedClaims) {
      const existingUs = await tx.userSkill.findUnique({
        where: { userId_skillId: { userId, skillId: claim.skillId } },
      });
      const nextOrigins = Array.from(
        new Set([...(existingUs?.claimOrigins ?? []), source])
      );
      const nextStale = (existingUs?.staleOrigins ?? []).filter(
        (o) => o !== source
      );
      const us = await tx.userSkill.upsert({
        where: { userId_skillId: { userId, skillId: claim.skillId } },
        update: {
          // Evidence always wins; claimedLevel updates for claim tracking
          claimedLevel: claim.claimedLevel,
          claimOrigins: nextOrigins,
          staleOrigins: nextStale,
        },
        create: {
          userId,
          skillId: claim.skillId,
          claimedLevel: claim.claimedLevel,
          claimOrigins: [source],
          staleOrigins: [],
        },
      });
      userSkills.push(us);
    }

    const workExperiences = [];
    const createdBlocks = [];
    let sortOrder = 0;

    // Non-experience blocks from parsed document
    for (const b of parsed.blocks ?? []) {
      if (b.kind === "experience") continue;
      const block = await tx.resumeBlock.create({
        data: {
          userId,
          kind: b.kind,
          title: b.title.trim(),
          content: b.content.trim(),
          status: "draft",
          sortOrder: sortOrder++,
          origin: source,
        },
      });
      createdBlocks.push(block);
    }

    // WorkExperiences + linked experience ResumeBlocks
    for (const exp of resolvedExperiences) {
      const createdExp = await tx.workExperience.create({
        data: {
          userId,
          employer: exp.employer,
          title: exp.title,
          period: exp.period,
          durationMonths: exp.durationMonths,
          kind: exp.kind,
          description: exp.description,
          skills: exp.skills,
          origin: source,
        },
      });
      workExperiences.push({ row: createdExp, points: exp.points });

      const expBlock = await tx.resumeBlock.create({
        data: {
          userId,
          kind: "experience",
          title: `${exp.title} at ${exp.employer} (${exp.period})`,
          content: exp.description,
          status: "draft",
          sortOrder: sortOrder++,
          sourceRefType: "work_experience",
          sourceRefId: createdExp.id,
          origin: source,
        },
      });
      createdBlocks.push(expBlock);
    }

    return {
      profile,
      userSkills,
      workExperiences,
      blocks: createdBlocks,
    };
  });

  // Append resume_imported audit event (0 points)
  await appendEvent({
    userId,
    source: "web",
    type: "resume_imported",
    skills: resolvedClaims.map((c) => c.skillId),
    payload: {
      origin: source,
      claimCount: resolvedClaims.length,
      workExperienceCount: txResult.workExperiences.length,
      blockCount: txResult.blocks.length,
    },
    pointsOverride: 0,
  });

  // Append attestation-dated work_experience_added evidence events
  const now = new Date();
  for (const item of txResult.workExperiences) {
    await appendEvent({
      userId,
      source: "web",
      type: "work_experience_added",
      occurredAt: now,
      skills: item.row.skills,
      payload: {
        work_experience_id: item.row.id,
        employer: item.row.employer,
        title: item.row.title,
        kind: item.row.kind,
        duration_months: item.row.durationMonths,
      },
      pointsOverride: item.points,
    });
  }

  return {
    profile: txResult.profile,
    userSkills: txResult.userSkills,
    workExperiences: txResult.workExperiences.map((w) => w.row),
    blocks: txResult.blocks,
  };
}

export function listWorkExperiences(userId: string) {
  return db.workExperience.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function confirmWorkExperience(
  userId: string,
  workExperienceId: string
) {
  const exp = await db.workExperience.findFirst({
    where: { id: workExperienceId, userId },
  });
  if (!exp) {
    throw new Error("work experience not found");
  }

  const updated = await db.workExperience.update({
    where: { id: exp.id },
    data: { lastConfirmedAt: new Date() },
  });

  await appendEvent({
    userId,
    source: "web",
    type: "work_experience_confirmed",
    skills: exp.skills,
    payload: {
      work_experience_id: exp.id,
      employer: exp.employer,
      title: exp.title,
    },
  });

  return updated;
}

export async function setSelfAssessedSkillLevel(
  userId: string,
  skillInput: string,
  claimedLevel: number
): Promise<UserSkill> {
  if (!Number.isInteger(claimedLevel) || claimedLevel < 1 || claimedLevel > 5) {
    throw new Error("self-assessed level must be an integer 1–5");
  }
  const skillId = await resolveCanonicalSkillByNameOrAlias(skillInput);
  if (!skillId) {
    throw new Error(`Unknown skill: ${skillInput}`);
  }

  const existing = await db.userSkill.findUnique({
    where: { userId_skillId: { userId, skillId } },
  });
  const nextOrigins = Array.from(
    new Set([...(existing?.claimOrigins ?? []), "self"])
  );

  // Self-assessed level fills zero-evidence holes and NEVER modifies score or evidenced level.
  return db.userSkill.upsert({
    where: { userId_skillId: { userId, skillId } },
    update: {
      claimedLevel,
      claimOrigins: nextOrigins,
    },
    create: {
      userId,
      skillId,
      claimedLevel,
      claimOrigins: ["self"],
      score: 0,
      level: 0,
    },
  });
}

export async function promoteWorkExperienceToProject(
  userId: string,
  workExperienceId: string
) {
  const exp = await db.workExperience.findFirst({
    where: { id: workExperienceId, userId },
  });
  if (!exp) {
    throw new Error("work experience not found");
  }

  const project = await createProject(userId, {
    title: `${exp.title} at ${exp.employer}`,
    description:
      exp.description || `${exp.title} (${exp.period}) at ${exp.employer}`,
    skills: exp.skills,
  });

  await db.workExperience.update({
    where: { id: exp.id },
    data: { promotedProjectId: project.id },
  });

  return project;
}
