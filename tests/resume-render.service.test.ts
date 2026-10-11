import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import { seedCanonicalSkills } from "@/services/seed-skills";
import { seedConfig, DEFAULT_SHRINK_BOUNDS } from "@/services/seed-config";
import { createInMemoryS3Fetch, createR2Adapter } from "@/services/storage";
import { createResumeBlock } from "@/services/resume-builder";
import {
  evaluateFitBudget,
  renderResumeToPdf,
  selfLintPdf,
  type FitBudgetOptions,
} from "@/services/resume-render";

describe("Resume render, fit budget & self-lint service (T14: ATS-safe template, typographic shrink, PDF storage, signed URL, self-lint score, deterministic output)", () => {
  let user: User;
  const marker = `t14_render_${Date.now()}`;

  beforeAll(async () => {
    process.env.R2_ENDPOINT = "https://t14-account.r2.cloudflarestorage.com";
    process.env.R2_BUCKET = "glados-t14-bucket";
    process.env.R2_ACCESS_KEY_ID = "AKIA_T14_TEST";
    process.env.R2_SECRET_ACCESS_KEY = "SECRET_T14_TEST_KEY";

    await seedConfig();
    await seedCanonicalSkills();

    user = await db.user.create({
      data: { clerkId: `${marker}_user`, email: "ada@example.com" },
    });

    // Create golden fixture resume blocks
    await createResumeBlock(user.id, {
      kind: "summary",
      title: "Ada Lovelace",
      content:
        "Pioneering Computer Scientist and Distributed Systems Engineer.",
      sortOrder: 0,
    });
    await createResumeBlock(user.id, {
      kind: "experience",
      title: "Staff Engineer at Analytical Engine Corp (2022 - Present)",
      content:
        "Architected high-throughput computational workflows and algorithmic pipelines in TypeScript and PostgreSQL.",
      sortOrder: 1,
    });
    await createResumeBlock(user.id, {
      kind: "education",
      title: "University of London",
      content: "B.S. Mathematics and Computing Sciences.",
      sortOrder: 2,
    });
  });

  afterAll(async () => {
    await db.resumeBlock.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("evaluates fit budget live: flags overflow when total chars exceed maxCharsPerPage, and computes stepped typographic shrink within config bounds", () => {
    const shortText = "Brief resume within single page budget.";
    const budgetNormal = evaluateFitBudget(shortText, DEFAULT_SHRINK_BOUNDS);
    expect(budgetNormal.overflow).toBe(false);
    expect(budgetNormal.fontPt).toBe(DEFAULT_SHRINK_BOUNDS.defaultFontPt);
    expect(budgetNormal.lineHeight).toBe(
      DEFAULT_SHRINK_BOUNDS.defaultLineHeight
    );

    // Text that exceeds maxCharsPerPage (3400) triggers overflow flag and steps down typography
    const longText = "A".repeat(4000);
    const budgetOverflow = evaluateFitBudget(longText, DEFAULT_SHRINK_BOUNDS);
    expect(budgetOverflow.overflow).toBe(true);
    expect(budgetOverflow.fontPt).toBeLessThan(
      DEFAULT_SHRINK_BOUNDS.defaultFontPt
    );
    expect(budgetOverflow.fontPt).toBeGreaterThanOrEqual(
      DEFAULT_SHRINK_BOUNDS.minFontPt
    );
    expect(budgetOverflow.lineHeight).toBeLessThan(
      DEFAULT_SHRINK_BOUNDS.defaultLineHeight
    );
    expect(budgetOverflow.lineHeight).toBeGreaterThanOrEqual(
      DEFAULT_SHRINK_BOUNDS.minLineHeight
    );
  });

  it("renders deterministic PDF, stores in storage module, returns short-lived signed URL, and achieves high self-lint parseability score", async () => {
    const s3 = createInMemoryS3Fetch();
    const storageAdapter = createR2Adapter(
      {
        endpoint: "https://t14-account.r2.cloudflarestorage.com",
        bucket: "glados-t14-bucket",
        accessKeyId: "AKIA_T14_TEST",
        secretAccessKey: "SECRET_T14_TEST_KEY",
      },
      s3.fetch
    );

    // 1. Render resume to PDF
    const render1 = await renderResumeToPdf(user.id, null, { storageAdapter });

    expect(render1.pdfBytes.byteLength).toBeGreaterThan(0);
    expect(render1.storageKey).toBe(`users/${user.id}/generated-resume.pdf`);
    expect(render1.downloadUrl).toContain("https://");
    expect(render1.downloadUrl).toContain("X-Amz-Signature");

    // 2. Deterministic rendering verified: same input produces identical byte output
    const render2 = await renderResumeToPdf(user.id, null, { storageAdapter });
    expect(render1.pdfBytes.equals(render2.pdfBytes)).toBe(true);

    // 3. Self-lint generated PDF: parse via text extractor and compute parseability score
    const lint = await selfLintPdf(render1.pdfBytes);
    expect(lint.parseabilityScore).toBeGreaterThanOrEqual(80);
    expect(lint.extractedText).toContain("Ada Lovelace");
    expect(lint.extractedText).toContain("Analytical Engine Corp");
  });
});
