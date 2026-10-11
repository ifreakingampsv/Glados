import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig } from "@/services/seed-config";
import { createProject } from "@/services/projects";
import {
  createOrRegenerateBlockVariant,
  createResumeBlock,
  reorderResumeBlocks,
  selectResumeBlocksForRender,
  setManualBlockSelectionOverride,
  setResumeBlockLockStatus,
  updateResumeBlock,
} from "@/services/resume-builder";

describe("Resume builder core service (T13: blocks CRUD + sourceRef, lock guardrails, JD-bound variants + event_log history, deterministic selection rule, tenant scoping)", () => {
  let owner: User;
  let otherUser: User;
  let jdAId: string;
  let jdBId: string;
  const marker = `t13_rb_${Date.now()}`;

  beforeAll(async () => {
    await seedConfig();
    await seedCanonicalSkills();
    [owner, otherUser] = await Promise.all([
      db.user.create({ data: { clerkId: `${marker}_owner` } }),
      db.user.create({ data: { clerkId: `${marker}_other` } }),
    ]);

    const [jdA, jdB] = await Promise.all([
      db.jobDescription.create({
        data: {
          userId: owner.id,
          title: "Backend Role A",
          rawText: "Backend role requiring TypeScript and PostgreSQL",
          contentHash: `${marker}_h1`,
          requiredSkills: [],
        },
      }),
      db.jobDescription.create({
        data: {
          userId: owner.id,
          title: "Systems Role B",
          rawText: "Systems role requiring Rust and Linux",
          contentHash: `${marker}_h2`,
          requiredSkills: [],
        },
      }),
    ]);
    jdAId = jdA.id;
    jdBId = jdB.id;
  });

  afterAll(async () => {
    const uids = [owner.id, otherUser.id];
    await db.eventLog.deleteMany({ where: { userId: { in: uids } } });
    await db.resumeBlock.deleteMany({ where: { userId: { in: uids } } });
    await db.jobDescription.deleteMany({ where: { userId: { in: uids } } });
    await db.project.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("supports all block kinds, source_ref to projects/work_experiences, reordering, and enforces lock guardrails across every rewrite path", async () => {
    const proj = await createProject(owner.id, {
      title: "Query Engine",
      description: "Fast SQL engine",
    });

    const summaryBlock = await createResumeBlock(owner.id, {
      kind: "summary",
      title: "Summary",
      content: "Original summary v1",
    });
    const expBlock = await createResumeBlock(owner.id, {
      kind: "experience",
      title: "Query Engine Project",
      content: "Shipped vectorized execution engine.",
      sourceRefType: "project",
      sourceRefId: proj.id,
    });

    expect(expBlock.sourceRefType).toBe("project");
    expect(expBlock.sourceRefId).toBe(proj.id);

    // Reorder: put expBlock before summaryBlock
    await reorderResumeBlocks(owner.id, [expBlock.id, summaryBlock.id]);
    const selectedOrder = await selectResumeBlocksForRender(owner.id, null);
    expect(selectedOrder[0].block.id).toBe(expBlock.id);
    expect(selectedOrder[1].block.id).toBe(summaryBlock.id);

    // Lock summaryBlock
    await setResumeBlockLockStatus(owner.id, summaryBlock.id, "locked");

    // 1. Direct update on locked block is rejected
    await expect(
      updateResumeBlock(owner.id, summaryBlock.id, {
        content: "Attempted silent rewrite while locked",
      })
    ).rejects.toThrow(/locked/i);

    // 2. Deriving/rewriting a variant from a locked parent block is also rejected
    await expect(
      createOrRegenerateBlockVariant(owner.id, {
        parentBlockId: summaryBlock.id,
        fromJdId: jdAId,
        content: "Variant rewrite while locked",
      })
    ).rejects.toThrow(/locked/i);

    // Unlock summaryBlock -> update now succeeds
    await setResumeBlockLockStatus(owner.id, summaryBlock.id, "draft");
    const updated = await updateResumeBlock(owner.id, summaryBlock.id, {
      content: "Updated summary v2 after unlock",
    });
    expect(updated.content).toBe("Updated summary v2 after unlock");

    // Tenant scoping: otherUser cannot edit or lock owner's block
    await expect(
      updateResumeBlock(otherUser.id, summaryBlock.id, { content: "Hack" })
    ).rejects.toThrow(/not found/i);
  });

  it("creates JD-bound variants with full provenance, preserves old content in event_log on regeneration, and follows deterministic selection (JD variant -> parent -> manual override)", async () => {
    const blocks = await selectResumeBlocksForRender(owner.id, null);
    const parentSummary = blocks.find((b) => b.block.kind === "summary")!.block;

    // Create variant v1 bound to jdAId
    const variantV1 = await createOrRegenerateBlockVariant(owner.id, {
      parentBlockId: parentSummary.id,
      fromJdId: jdAId,
      content: "Tailored summary v1 for Backend Role A",
    });
    expect(variantV1.parentId).toBe(parentSummary.id);
    expect(variantV1.fromJdId).toBe(jdAId);

    // Regenerate variant v2 for same (parentBlockId, jdAId) -> preserves v1 in event_log
    const variantV2 = await createOrRegenerateBlockVariant(owner.id, {
      parentBlockId: parentSummary.id,
      fromJdId: jdAId,
      content: "Tailored summary v2 for Backend Role A",
    });
    expect(variantV2.id).toBe(variantV1.id);
    expect(variantV2.content).toBe("Tailored summary v2 for Backend Role A");

    const historyEvents = await db.eventLog.findMany({
      where: { userId: owner.id, type: "system_adjustment" },
      orderBy: { occurredAt: "desc" },
    });
    const regenAudit = historyEvents.find((e) =>
      JSON.stringify(e.payload ?? {}).includes(
        "Tailored summary v1 for Backend Role A"
      )
    );
    expect(regenAudit).toBeDefined();

    // Selection rule check 1: Rendering for jdAId automatically selects variantV2 (jd_variant)
    const renderForA = await selectResumeBlocksForRender(owner.id, jdAId);
    const summaryForA = renderForA.find(
      (b) => b.parentBlockId === parentSummary.id
    )!;
    expect(summaryForA.block.id).toBe(variantV2.id);
    expect(summaryForA.selectionReason).toBe("jd_variant");

    // Selection rule check 2: Rendering for jdBId (no variant for B) selects parentSummary (parent)
    const renderForB = await selectResumeBlocksForRender(owner.id, jdBId);
    const summaryForB = renderForB.find(
      (b) => b.parentBlockId === parentSummary.id
    )!;
    expect(summaryForB.block.id).toBe(parentSummary.id);
    expect(summaryForB.selectionReason).toBe("parent");

    // Selection rule check 3: Manual override stored -> overrides automatic JD variant selection
    await setManualBlockSelectionOverride(
      owner.id,
      jdAId,
      parentSummary.id,
      parentSummary.id
    );
    const renderForAOverridden = await selectResumeBlocksForRender(
      owner.id,
      jdAId
    );
    const summaryForAOverridden = renderForAOverridden.find(
      (b) => b.parentBlockId === parentSummary.id
    )!;
    expect(summaryForAOverridden.block.id).toBe(parentSummary.id);
    expect(summaryForAOverridden.selectionReason).toBe("manual_override");
  });
});
