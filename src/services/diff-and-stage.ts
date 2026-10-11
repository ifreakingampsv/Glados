import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendEvent } from "@/services/events";
import { getConfig } from "@/services/levels";
import type { ParsedResumeDocument } from "@/services/resume-parse";
import { DEFAULT_WORK_EXP_SCORER } from "@/services/seed-config";
import {
  deleteObject,
  getObject,
  putObject,
  type StorageAdapter,
} from "@/services/storage";
import {
  computeWorkExperiencePoints,
  resolveCanonicalSkillByNameOrAlias,
  type WorkExpScorerConfig,
} from "@/services/work-experience";

export type DiffOutcome = "same" | "updated" | "new" | "gone";

export interface StagedDiffItem {
  id: string;
  entityType: "claim" | "block" | "work_experience";
  outcome: DiffOutcome;
  key: string;
  label: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  evidenceConflictResolved?: boolean;
}

export async function computeSameSourceDiff(
  userId: string,
  parsed: ParsedResumeDocument,
  source: "resume" | "linkedin"
): Promise<StagedDiffItem[]> {
  const [userSkills, blocks, workExperiences, allSkills] = await Promise.all([
    db.userSkill.findMany({ where: { userId } }),
    db.resumeBlock.findMany({
      where: { userId, origin: source, parentId: null },
      orderBy: { sortOrder: "asc" },
    }),
    db.workExperience.findMany({
      where: { userId, origin: source },
      orderBy: { createdAt: "asc" },
    }),
    db.skill.findMany({ select: { id: true, display: true, name: true } }),
  ]);

  const skillById = new Map(allSkills.map((s) => [s.id, s]));
  const sameSourceClaims = userSkills.filter((us) =>
    (us.claimOrigins ?? []).includes(source)
  );
  const userSkillBySkillId = new Map(userSkills.map((us) => [us.skillId, us]));

  const items: StagedDiffItem[] = [];

  // 1. Diff skill claims against same-source claims
  const incomingClaimMap = new Map<string, number>();
  for (const rawSkill of parsed.skills ?? []) {
    const skillId = await resolveCanonicalSkillByNameOrAlias(rawSkill.name);
    if (skillId) {
      const level = Math.min(
        5,
        Math.max(1, Math.round(rawSkill.claimedLevel ?? 2))
      );
      incomingClaimMap.set(skillId, level);
    }
  }

  for (const [skillId, incomingLevel] of incomingClaimMap.entries()) {
    const existing = userSkillBySkillId.get(skillId);
    const skillDisplay = skillById.get(skillId)?.display ?? skillId;
    const hadSameSource =
      existing && (existing.claimOrigins ?? []).includes(source);
    const evidenceWins = Boolean(existing && existing.level > incomingLevel);

    if (!hadSameSource) {
      items.push({
        id: `claim:${skillId}`,
        entityType: "claim",
        outcome: "new",
        key: skillId,
        label: `Skill claim: ${skillDisplay}`,
        before: null,
        after: { skillId, claimedLevel: incomingLevel },
        evidenceConflictResolved: evidenceWins,
      });
    } else if (existing.claimedLevel === incomingLevel) {
      items.push({
        id: `claim:${skillId}`,
        entityType: "claim",
        outcome: "same",
        key: skillId,
        label: `Skill claim: ${skillDisplay}`,
        before: { skillId, claimedLevel: existing.claimedLevel },
        after: { skillId, claimedLevel: incomingLevel },
        evidenceConflictResolved: evidenceWins,
      });
    } else {
      items.push({
        id: `claim:${skillId}`,
        entityType: "claim",
        outcome: "updated",
        key: skillId,
        label: `Skill claim: ${skillDisplay}`,
        before: {
          skillId,
          claimedLevel: existing.claimedLevel,
          evidencedLevel: existing.level,
        },
        after: { skillId, claimedLevel: incomingLevel },
        evidenceConflictResolved: evidenceWins,
      });
    }
  }

  for (const existing of sameSourceClaims) {
    if (!incomingClaimMap.has(existing.skillId)) {
      const skillDisplay =
        skillById.get(existing.skillId)?.display ?? existing.skillId;
      items.push({
        id: `claim:${existing.skillId}`,
        entityType: "claim",
        outcome: "gone",
        key: existing.skillId,
        label: `Skill claim: ${skillDisplay}`,
        before: {
          skillId: existing.skillId,
          claimedLevel: existing.claimedLevel,
        },
        after: null,
      });
    }
  }

  // 2. Diff non-experience blocks against same-source blocks
  const existingNonExpBlocks = blocks.filter((b) => b.kind !== "experience");
  const matchedBlockIds = new Set<string>();

  for (const incomingBlock of parsed.blocks ?? []) {
    if (incomingBlock.kind === "experience") continue;
    const normTitle = incomingBlock.title.trim().toLowerCase();
    const existing = existingNonExpBlocks.find(
      (b) =>
        b.kind === incomingBlock.kind &&
        b.title.trim().toLowerCase() === normTitle
    );

    if (!existing) {
      const key = `${incomingBlock.kind}:${normTitle || "untitled"}`;
      items.push({
        id: `block:${key}`,
        entityType: "block",
        outcome: "new",
        key,
        label: `Block (${incomingBlock.kind}): ${incomingBlock.title}`,
        before: null,
        after: {
          kind: incomingBlock.kind,
          title: incomingBlock.title.trim(),
          content: incomingBlock.content.trim(),
        },
      });
    } else {
      matchedBlockIds.add(existing.id);
      const isSame = existing.content.trim() === incomingBlock.content.trim();
      items.push({
        id: `block:${existing.id}`,
        entityType: "block",
        outcome: isSame ? "same" : "updated",
        key: existing.id,
        label: `Block (${existing.kind}): ${existing.title}`,
        before: {
          blockId: existing.id,
          kind: existing.kind,
          title: existing.title,
          content: existing.content,
        },
        after: {
          blockId: existing.id,
          kind: incomingBlock.kind,
          title: incomingBlock.title.trim(),
          content: incomingBlock.content.trim(),
        },
      });
    }
  }

  for (const existing of existingNonExpBlocks) {
    if (!matchedBlockIds.has(existing.id)) {
      items.push({
        id: `block:${existing.id}`,
        entityType: "block",
        outcome: "gone",
        key: existing.id,
        label: `Block (${existing.kind}): ${existing.title}`,
        before: {
          blockId: existing.id,
          kind: existing.kind,
          title: existing.title,
          content: existing.content,
        },
        after: null,
      });
    }
  }

  // 3. Diff work experiences against same-source work experiences
  const matchedExpIds = new Set<string>();
  for (const incomingExp of parsed.workExperiences ?? []) {
    const expSkillIds: string[] = [];
    for (const rawSkill of incomingExp.skills ?? []) {
      const id = await resolveCanonicalSkillByNameOrAlias(rawSkill);
      if (id && !expSkillIds.includes(id)) expSkillIds.push(id);
    }

    const existing = workExperiences.find(
      (w) =>
        w.employer.trim().toLowerCase() ===
          incomingExp.employer.trim().toLowerCase() &&
        w.title.trim().toLowerCase() === incomingExp.title.trim().toLowerCase()
    );

    if (!existing) {
      const key = `${incomingExp.employer.trim()}:${incomingExp.title.trim()}`;
      items.push({
        id: `exp:${key}`,
        entityType: "work_experience",
        outcome: "new",
        key,
        label: `Work experience: ${incomingExp.title} at ${incomingExp.employer}`,
        before: null,
        after: {
          employer: incomingExp.employer.trim(),
          title: incomingExp.title.trim(),
          period: incomingExp.period.trim(),
          durationMonths: incomingExp.durationMonths ?? 12,
          kind: incomingExp.kind ?? "job",
          description: incomingExp.description.trim(),
          skills: expSkillIds,
        },
      });
    } else {
      matchedExpIds.add(existing.id);
      const isSame =
        existing.description.trim() === incomingExp.description.trim() &&
        existing.period.trim() === incomingExp.period.trim();
      items.push({
        id: `exp:${existing.id}`,
        entityType: "work_experience",
        outcome: isSame ? "same" : "updated",
        key: existing.id,
        label: `Work experience: ${existing.title} at ${existing.employer}`,
        before: {
          workExperienceId: existing.id,
          employer: existing.employer,
          title: existing.title,
          period: existing.period,
          durationMonths: existing.durationMonths,
          description: existing.description,
          skills: existing.skills,
        },
        after: {
          workExperienceId: existing.id,
          employer: incomingExp.employer.trim(),
          title: incomingExp.title.trim(),
          period: incomingExp.period.trim(),
          durationMonths: incomingExp.durationMonths ?? existing.durationMonths,
          kind: incomingExp.kind ?? existing.kind,
          description: incomingExp.description.trim(),
          skills: expSkillIds,
        },
      });
    }
  }

  for (const existing of workExperiences) {
    if (!matchedExpIds.has(existing.id)) {
      items.push({
        id: `exp:${existing.id}`,
        entityType: "work_experience",
        outcome: "gone",
        key: existing.id,
        label: `Work experience: ${existing.title} at ${existing.employer}`,
        before: {
          workExperienceId: existing.id,
          employer: existing.employer,
          title: existing.title,
          period: existing.period,
          description: existing.description,
        },
        after: null,
      });
    }
  }

  return items;
}

export async function stageReuploadDiff(
  userId: string,
  parsed: ParsedResumeDocument,
  source: "resume" | "linkedin",
  options: { storageKey?: string | null } = {}
) {
  const diffItems = await computeSameSourceDiff(userId, parsed, source);
  return db.resumeImportStaging.create({
    data: {
      userId,
      source,
      storageKey: options.storageKey ?? null,
      parsedPayload: parsed as unknown as Prisma.InputJsonValue,
      diffItems: diffItems as unknown as Prisma.InputJsonValue,
      status: "pending",
    },
  });
}

export function getPendingStagedImports(userId: string) {
  return db.resumeImportStaging.findMany({
    where: { userId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}

export async function declineStagedImport(
  userId: string,
  stagingId: string,
  options: { storageAdapter?: StorageAdapter } = {}
) {
  const staged = await db.resumeImportStaging.findFirst({
    where: { id: stagingId, userId },
  });
  if (!staged) {
    throw new Error("staged import not found");
  }

  if (staged.storageKey) {
    await deleteObject(staged.storageKey, options.storageAdapter);
  }

  return db.resumeImportStaging.update({
    where: { id: staged.id },
    data: { status: "declined", storageKey: null },
  });
}

export async function applyStagedImport(
  userId: string,
  stagingId: string,
  options: {
    acceptedItemIds?: string[];
    storageAdapter?: StorageAdapter;
  } = {}
) {
  const staged = await db.resumeImportStaging.findFirst({
    where: { id: stagingId, userId },
  });
  if (!staged || staged.status !== "pending") {
    throw new Error("staged import not found");
  }

  const source = staged.source as "resume" | "linkedin";
  const allItems = (staged.diffItems as unknown as StagedDiffItem[]) ?? [];
  const acceptedSet = options.acceptedItemIds
    ? new Set(options.acceptedItemIds)
    : new Set(allItems.filter((i) => i.outcome !== "same").map((i) => i.id));

  const scorerConfig = await getConfig<WorkExpScorerConfig>(
    "workExperience.scorer",
    DEFAULT_WORK_EXP_SCORER
  );

  const overwrittenHistory: Array<Record<string, unknown>> = [];
  const newExpEvents: Array<{
    id: string;
    employer: string;
    title: string;
    kind: string;
    durationMonths: number;
    skills: string[];
    points: number;
  }> = [];

  const updatedStaging = await db.$transaction(async (tx) => {
    for (const item of allItems) {
      if (!acceptedSet.has(item.id) || item.outcome === "same") continue;

      if (item.entityType === "claim") {
        const skillId = item.key;
        const existing = await tx.userSkill.findUnique({
          where: { userId_skillId: { userId, skillId } },
        });

        if (item.outcome === "new" || item.outcome === "updated") {
          const nextClaimed = Number(item.after?.claimedLevel ?? 2);
          const nextOrigins = Array.from(
            new Set([...(existing?.claimOrigins ?? []), source])
          );
          const nextStale = (existing?.staleOrigins ?? []).filter(
            (o) => o !== source
          );
          // Evidence-wins: never downgrade evidenced score or level!
          await tx.userSkill.upsert({
            where: { userId_skillId: { userId, skillId } },
            update: {
              claimedLevel: nextClaimed,
              claimOrigins: nextOrigins,
              staleOrigins: nextStale,
            },
            create: {
              userId,
              skillId,
              claimedLevel: nextClaimed,
              claimOrigins: [source],
              staleOrigins: [],
            },
          });
        } else if (item.outcome === "gone" && existing) {
          // Per-source staleness: mark this source stale, never delete the claim row
          const nextStale = Array.from(
            new Set([...(existing.staleOrigins ?? []), source])
          );
          await tx.userSkill.update({
            where: { id: existing.id },
            data: { staleOrigins: nextStale },
          });
        }
      } else if (item.entityType === "block") {
        if (item.outcome === "new" && item.after) {
          await tx.resumeBlock.create({
            data: {
              userId,
              kind: String(item.after.kind ?? "custom"),
              title: String(item.after.title ?? ""),
              content: String(item.after.content ?? ""),
              status: "draft",
              origin: source,
            },
          });
        } else if (item.outcome === "updated" && item.after) {
          const blockId = String(item.after.blockId ?? item.key);
          const existingBlock = await tx.resumeBlock.findFirst({
            where: { id: blockId, userId },
          });
          // Guardrail: never overwrite a locked block
          if (existingBlock && existingBlock.status !== "locked") {
            overwrittenHistory.push({
              entityType: "block",
              id: existingBlock.id,
              previousTitle: existingBlock.title,
              previousContent: existingBlock.content,
            });
            await tx.resumeBlock.update({
              where: { id: existingBlock.id },
              data: {
                title: String(item.after.title ?? existingBlock.title),
                content: String(item.after.content ?? existingBlock.content),
                staleOrigins: (existingBlock.staleOrigins ?? []).filter(
                  (o) => o !== source
                ),
              },
            });
          }
        } else if (item.outcome === "gone" && item.before) {
          const blockId = String(item.before.blockId ?? item.key);
          const existingBlock = await tx.resumeBlock.findFirst({
            where: { id: blockId, userId },
          });
          if (existingBlock) {
            const nextStale = Array.from(
              new Set([...(existingBlock.staleOrigins ?? []), source])
            );
            await tx.resumeBlock.update({
              where: { id: existingBlock.id },
              data: { staleOrigins: nextStale },
            });
          }
        }
      } else if (item.entityType === "work_experience") {
        if (item.outcome === "new" && item.after) {
          const skills = Array.isArray(item.after.skills)
            ? (item.after.skills as string[])
            : [];
          const durationMonths = Number(item.after.durationMonths ?? 12);
          const kind = String(item.after.kind ?? "job");
          const description = String(item.after.description ?? "");
          const created = await tx.workExperience.create({
            data: {
              userId,
              employer: String(item.after.employer ?? ""),
              title: String(item.after.title ?? ""),
              period: String(item.after.period ?? ""),
              durationMonths,
              kind,
              description,
              skills,
              origin: source,
            },
          });
          const points = computeWorkExperiencePoints(
            {
              kind,
              durationMonths,
              description,
              resolvedSkillCount: skills.length,
            },
            scorerConfig
          );
          newExpEvents.push({
            id: created.id,
            employer: created.employer,
            title: created.title,
            kind,
            durationMonths,
            skills,
            points,
          });
        } else if (item.outcome === "updated" && item.after) {
          const expId = String(item.after.workExperienceId ?? item.key);
          const existingExp = await tx.workExperience.findFirst({
            where: { id: expId, userId },
          });
          if (existingExp) {
            overwrittenHistory.push({
              entityType: "work_experience",
              id: existingExp.id,
              previousPeriod: existingExp.period,
              previousDescription: existingExp.description,
            });
            const skills = Array.isArray(item.after.skills)
              ? (item.after.skills as string[])
              : existingExp.skills;
            await tx.workExperience.update({
              where: { id: existingExp.id },
              data: {
                period: String(item.after.period ?? existingExp.period),
                durationMonths: Number(
                  item.after.durationMonths ?? existingExp.durationMonths
                ),
                description: String(
                  item.after.description ?? existingExp.description
                ),
                skills,
                staleOrigins: (existingExp.staleOrigins ?? []).filter(
                  (o) => o !== source
                ),
              },
            });
          }
        } else if (item.outcome === "gone" && item.before) {
          const expId = String(item.before.workExperienceId ?? item.key);
          const existingExp = await tx.workExperience.findFirst({
            where: { id: expId, userId },
          });
          if (existingExp) {
            const nextStale = Array.from(
              new Set([...(existingExp.staleOrigins ?? []), source])
            );
            await tx.workExperience.update({
              where: { id: existingExp.id },
              data: { staleOrigins: nextStale },
            });
          }
        }
      }
    }

    return tx.resumeImportStaging.update({
      where: { id: staged.id },
      data: { status: "applied" },
    });
  });

  // Update the stored active PDF on accept if a staged PDF exists
  if (staged.storageKey) {
    const uploadedObj = await getObject(
      staged.storageKey,
      options.storageAdapter
    );
    if (uploadedObj) {
      await putObject(
        {
          key: `users/${userId}/active-${source}.pdf`,
          body: uploadedObj.body,
          contentType: uploadedObj.contentType || "application/pdf",
        },
        options.storageAdapter
      );
      await deleteObject(staged.storageKey, options.storageAdapter);
    }
  }

  // Append resume_imported audit event with overwrittenHistory so old content is recoverable
  await appendEvent({
    userId,
    source: "web",
    type: "resume_imported",
    skills: [],
    payload: {
      stagingId: staged.id,
      origin: source,
      acceptedCount: acceptedSet.size,
      overwrittenHistory,
    },
    pointsOverride: 0,
  });

  for (const expEv of newExpEvents) {
    await appendEvent({
      userId,
      source: "web",
      type: "work_experience_added",
      skills: expEv.skills,
      payload: {
        work_experience_id: expEv.id,
        employer: expEv.employer,
        title: expEv.title,
        kind: expEv.kind,
        duration_months: expEv.durationMonths,
      },
      pointsOverride: expEv.points,
    });
  }

  return updatedStaging;
}
