import { db, type ResumeBlock } from "@/lib/db";
import { appendEvent } from "@/services/events";

export const RESUME_BLOCK_KINDS = [
  "summary",
  "experience",
  "skill_group",
  "education",
  "custom",
] as const;

export type ResumeBlockKind = (typeof RESUME_BLOCK_KINDS)[number];

export interface CreateResumeBlockInput {
  kind: ResumeBlockKind;
  title?: string;
  content: string;
  sourceRefType?: "project" | "work_experience" | null;
  sourceRefId?: string | null;
  sortOrder?: number;
}

async function verifySourceRefOwnership(
  userId: string,
  sourceRefType?: string | null,
  sourceRefId?: string | null
) {
  if (!sourceRefType || !sourceRefId) return;
  if (sourceRefType === "project") {
    const proj = await db.project.findFirst({
      where: { id: sourceRefId, userId },
    });
    if (!proj) throw new Error("referenced project not found");
  } else if (sourceRefType === "work_experience") {
    const exp = await db.workExperience.findFirst({
      where: { id: sourceRefId, userId },
    });
    if (!exp) throw new Error("referenced work experience not found");
  } else {
    throw new Error(`invalid sourceRefType: ${sourceRefType}`);
  }
}

export async function createResumeBlock(
  userId: string,
  input: CreateResumeBlockInput
): Promise<ResumeBlock> {
  if (!(RESUME_BLOCK_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(`Invalid block kind: ${input.kind}`);
  }
  if (!input.content.trim()) {
    throw new Error("Block content is required");
  }
  await verifySourceRefOwnership(
    userId,
    input.sourceRefType,
    input.sourceRefId
  );

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const count = await db.resumeBlock.count({
      where: { userId, parentId: null },
    });
    sortOrder = count;
  }

  return db.resumeBlock.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title?.trim() ?? "",
      content: input.content.trim(),
      status: "draft",
      sortOrder,
      sourceRefType: input.sourceRefType ?? null,
      sourceRefId: input.sourceRefId ?? null,
      origin: "web",
    },
  });
}

export async function getResumeBlock(
  userId: string,
  blockId: string
): Promise<ResumeBlock> {
  const block = await db.resumeBlock.findFirst({
    where: { id: blockId, userId },
  });
  if (!block) throw new Error("resume block not found");
  return block;
}

export async function updateResumeBlock(
  userId: string,
  blockId: string,
  patch: {
    title?: string;
    content?: string;
    kind?: ResumeBlockKind;
  }
): Promise<ResumeBlock> {
  const existing = await getResumeBlock(userId, blockId);
  if (existing.status === "locked") {
    throw new Error(
      "Cannot rewrite a locked resume block. Unlock the block first."
    );
  }

  return db.resumeBlock.update({
    where: { id: existing.id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.content !== undefined ? { content: patch.content.trim() } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    },
  });
}

export async function setResumeBlockLockStatus(
  userId: string,
  blockId: string,
  status: "draft" | "locked"
): Promise<ResumeBlock> {
  const existing = await getResumeBlock(userId, blockId);
  return db.resumeBlock.update({
    where: { id: existing.id },
    data: { status },
  });
}

export async function deleteResumeBlock(
  userId: string,
  blockId: string
): Promise<void> {
  const existing = await getResumeBlock(userId, blockId);
  await db.resumeBlock.deleteMany({
    where: {
      userId,
      OR: [{ id: existing.id }, { parentId: existing.id }],
    },
  });
}

export async function reorderResumeBlocks(
  userId: string,
  orderedBlockIds: string[]
): Promise<void> {
  const blocks = await db.resumeBlock.findMany({
    where: { userId, id: { in: orderedBlockIds } },
    select: { id: true },
  });
  if (blocks.length !== orderedBlockIds.length) {
    throw new Error("resume block not found for reorder");
  }

  await db.$transaction(
    orderedBlockIds.map((id, idx) =>
      db.resumeBlock.update({
        where: { id },
        data: { sortOrder: idx },
      })
    )
  );
}

export async function createOrRegenerateBlockVariant(
  userId: string,
  input: {
    parentBlockId: string;
    fromJdId: string;
    title?: string;
    content: string;
  }
): Promise<ResumeBlock> {
  const parent = await getResumeBlock(userId, input.parentBlockId);
  if (parent.status === "locked") {
    throw new Error(
      "Cannot derive or rewrite a variant from a locked resume block."
    );
  }

  const jd = await db.jobDescription.findFirst({
    where: { id: input.fromJdId, userId },
  });
  if (!jd) {
    throw new Error("job description not found");
  }

  const existingVariant = await db.resumeBlock.findFirst({
    where: {
      userId,
      parentId: parent.id,
      fromJdId: jd.id,
    },
  });

  if (existingVariant) {
    if (existingVariant.status === "locked") {
      throw new Error(
        "Cannot regenerate a locked variant block. Unlock the variant first."
      );
    }

    // D25 division: preserve old variant content in event_log before updating
    await appendEvent({
      userId,
      source: "web",
      type: "system_adjustment",
      skills: [],
      payload: {
        action: "variant_regenerated",
        variantId: existingVariant.id,
        parentBlockId: parent.id,
        fromJdId: jd.id,
        previousTitle: existingVariant.title,
        previousContent: existingVariant.content,
      },
      pointsOverride: 0,
    });

    return db.resumeBlock.update({
      where: { id: existingVariant.id },
      data: {
        title:
          input.title !== undefined
            ? input.title.trim()
            : existingVariant.title,
        content: input.content.trim(),
      },
    });
  }

  return db.resumeBlock.create({
    data: {
      userId,
      kind: parent.kind,
      title: input.title?.trim() ?? parent.title,
      content: input.content.trim(),
      status: "draft",
      sortOrder: parent.sortOrder,
      sourceRefType: parent.sourceRefType,
      sourceRefId: parent.sourceRefId,
      parentId: parent.id,
      fromJdId: jd.id,
      origin: "web",
    },
  });
}

export async function setManualBlockSelectionOverride(
  userId: string,
  jdId: string,
  parentBlockId: string,
  chosenBlockId: string
): Promise<void> {
  const parent = await getResumeBlock(userId, parentBlockId);
  const chosen = await getResumeBlock(userId, chosenBlockId);
  if (chosen.id !== parent.id && chosen.parentId !== parent.id) {
    throw new Error("chosen block does not belong to parent block family");
  }

  await db.$transaction([
    db.resumeBlock.updateMany({
      where: {
        userId,
        OR: [{ id: parent.id }, { parentId: parent.id }],
        manualOverrideForJdId: jdId,
      },
      data: { manualOverrideForJdId: null },
    }),
    db.resumeBlock.update({
      where: { id: chosen.id },
      data: { manualOverrideForJdId: jdId },
    }),
  ]);
}

export interface SelectedRenderBlock {
  parentBlockId: string;
  block: ResumeBlock;
  variants: ResumeBlock[];
  selectionReason: "manual_override" | "jd_variant" | "parent";
}

export async function selectResumeBlocksForRender(
  userId: string,
  jdId: string | null
): Promise<SelectedRenderBlock[]> {
  const allBlocks = await db.resumeBlock.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const parents = allBlocks.filter((b) => b.parentId === null);
  const variantsByParent = new Map<string, ResumeBlock[]>();
  for (const b of allBlocks) {
    if (b.parentId) {
      const list = variantsByParent.get(b.parentId) ?? [];
      list.push(b);
      variantsByParent.set(b.parentId, list);
    }
  }

  return parents.map((parent) => {
    const variants = variantsByParent.get(parent.id) ?? [];
    const family = [parent, ...variants];

    if (jdId) {
      const manualOverride = family.find(
        (b) => b.manualOverrideForJdId === jdId
      );
      if (manualOverride) {
        return {
          parentBlockId: parent.id,
          block: manualOverride,
          variants,
          selectionReason: "manual_override",
        };
      }

      const jdVariant = variants.find((v) => v.fromJdId === jdId);
      if (jdVariant) {
        return {
          parentBlockId: parent.id,
          block: jdVariant,
          variants,
          selectionReason: "jd_variant",
        };
      }
    }

    return {
      parentBlockId: parent.id,
      block: parent,
      variants,
      selectionReason: "parent",
    };
  });
}

export async function getEffectiveResumeBlocks(
  userId: string,
  jdId: string | null = null
): Promise<ResumeBlock[]> {
  const selected = await selectResumeBlocksForRender(userId, jdId);
  return selected.map((s) => s.block);
}
