import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { listJobDescriptions } from "@/services/jd";
import { listProjects } from "@/services/projects";
import { listWorkExperiences } from "@/services/work-experience";
import {
  selectResumeBlocksForRender,
  RESUME_BLOCK_KINDS,
} from "@/services/resume-builder";
import {
  evaluateFitBudget,
  generatePdfBuffer,
  selfLintPdf,
} from "@/services/resume-render";
import {
  createResumeBlockAction,
  createVariantAction,
  deleteResumeBlockAction,
  moveBlockAction,
  renderResumePdfAction,
  setManualOverrideAction,
  toggleResumeBlockLockAction,
  updateResumeBlockAction,
} from "@/app/actions/resume";

export const dynamic = "force-dynamic";

export default async function ResumePage({
  searchParams,
}: {
  searchParams?: Promise<{ jdId?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="section-card">
        <p className="empty-state">
          Sign-in unavailable in this environment (no Clerk keys configured).
        </p>
      </main>
    );
  }

  const params = searchParams ? await searchParams : {};
  const [jds, projects, workExperiences] = await Promise.all([
    listJobDescriptions(user.id),
    listProjects(user.id),
    listWorkExperiences(user.id),
  ]);

  const activeJdId = params.jdId || null;
  const activeJd = jds.find((j) => j.id === activeJdId) ?? null;
  const selectedBlocks = await selectResumeBlocksForRender(user.id, activeJdId);
  const allParentIds = selectedBlocks.map((s) => s.parentBlockId);

  const effectiveBlocks = selectedBlocks.map((s) => s.block);
  const fullContent = effectiveBlocks
    .map((b) => `${b.title}\n${b.content}`)
    .join("\n\n");
  const fitBudget = evaluateFitBudget(fullContent);
  const previewPdf =
    effectiveBlocks.length > 0
      ? await generatePdfBuffer(effectiveBlocks, fitBudget)
      : null;
  const lintResult = previewPdf
    ? await selfLintPdf(previewPdf)
    : { parseabilityScore: 0, extractedText: "", issues: [] };

  return (
    <main>
      <h1>Resume Builder</h1>
      <p className="lede">
        Assemble modular resume blocks, lock finalized sections against edits,
        and generate JD-bound variants. Deterministic selection applies at
        render time.
      </p>

      {params.error && (
        <div className="alert alert-danger" role="alert">
          {decodeURIComponent(params.error)}
        </div>
      )}

      {/* Target JD Selector & Render PDF Action */}
      <section className="section-card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Target Job Description Variant</h2>
            <p className="muted" style={{ marginTop: "0.25rem" }}>
              Switching target JDs selects bound variants automatically.
            </p>
          </div>
          <div className="row">
            <Link
              href="/resume"
              className={`btn btn-sm ${!activeJdId ? "btn-primary" : ""}`}
            >
              Default (Master)
            </Link>
            {jds.map((jd) => (
              <Link
                key={jd.id}
                href={`/resume?jdId=${jd.id}`}
                className={`btn btn-sm ${activeJdId === jd.id ? "btn-primary" : ""}`}
              >
                {jd.title}
              </Link>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--border-color, #e5e7eb)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="stack" style={{ gap: "0.25rem" }}>
              <div>
                <strong>Single-Page Fit Budget: </strong>
                <span>
                  {fitBudget.totalChars} / {fitBudget.maxCharsPerPage} chars{" "}
                  {fitBudget.overflow
                    ? `(Overflow warning: Typographic shrink active at ${fitBudget.fontPt}pt / ${fitBudget.lineHeight} line-height)`
                    : `(Fits within standard ${fitBudget.fontPt}pt typography)`}
                </span>
              </div>
              {effectiveBlocks.length > 0 && (
                <div className="muted">
                  <strong>ATS Self-Lint Parseability Score: </strong>
                  <span className="pill">
                    {lintResult.parseabilityScore}/100
                  </span>
                </div>
              )}
            </div>
            <form action={renderResumePdfAction}>
              {activeJdId && (
                <input type="hidden" name="jdId" value={activeJdId} />
              )}
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={effectiveBlocks.length === 0}
              >
                Download ATS-Safe PDF
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Blocks List */}
      <section className="section-card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>
            Resume Content Blocks ({selectedBlocks.length})
            {activeJd && <span className="muted"> for {activeJd.title}</span>}
          </h2>
        </div>

        {selectedBlocks.length === 0 ? (
          <p className="empty-state">
            No resume blocks yet. Import your resume on your profile or add a
            block below.
          </p>
        ) : (
          <ul className="item-list" style={{ marginTop: "1rem" }}>
            {selectedBlocks.map(
              ({ parentBlockId, block, variants, selectionReason }, idx) => {
                const isLocked = block.status === "locked";
                return (
                  <li key={block.id} className="item-row stack">
                    <div
                      className="row"
                      style={{ justifyContent: "space-between" }}
                    >
                      <div className="row">
                        <span className="badge badge-neutral">
                          {block.kind}
                        </span>
                        <strong>{block.title || "Untitled Block"}</strong>
                        {isLocked && (
                          <span className="badge badge-warn">Locked</span>
                        )}
                        <span className="badge badge-accent">
                          Selection: {selectionReason}
                        </span>
                      </div>

                      <div className="row">
                        {/* Reorder Up */}
                        {idx > 0 && (
                          <form action={moveBlockAction}>
                            <input
                              type="hidden"
                              name="blockId"
                              value={parentBlockId}
                            />
                            <input type="hidden" name="direction" value="up" />
                            {allParentIds.map((id) => (
                              <input
                                key={id}
                                type="hidden"
                                name="allBlockIds"
                                value={id}
                              />
                            ))}
                            <button
                              type="submit"
                              className="btn btn-sm"
                              aria-label="Move block up"
                            >
                              ↑
                            </button>
                          </form>
                        )}
                        {/* Reorder Down */}
                        {idx < selectedBlocks.length - 1 && (
                          <form action={moveBlockAction}>
                            <input
                              type="hidden"
                              name="blockId"
                              value={parentBlockId}
                            />
                            <input
                              type="hidden"
                              name="direction"
                              value="down"
                            />
                            {allParentIds.map((id) => (
                              <input
                                key={id}
                                type="hidden"
                                name="allBlockIds"
                                value={id}
                              />
                            ))}
                            <button
                              type="submit"
                              className="btn btn-sm"
                              aria-label="Move block down"
                            >
                              ↓
                            </button>
                          </form>
                        )}

                        {/* Lock / Unlock */}
                        <form action={toggleResumeBlockLockAction}>
                          <input
                            type="hidden"
                            name="blockId"
                            value={block.id}
                          />
                          <input
                            type="hidden"
                            name="status"
                            value={block.status}
                          />
                          <button type="submit" className="btn btn-sm">
                            {isLocked ? "Unlock" : "Lock"}
                          </button>
                        </form>

                        {/* Delete */}
                        <form action={deleteResumeBlockAction}>
                          <input
                            type="hidden"
                            name="blockId"
                            value={parentBlockId}
                          />
                          <button
                            type="submit"
                            className="btn btn-sm btn-danger"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>

                    {/* Edit Form */}
                    <form action={updateResumeBlockAction} className="stack">
                      <input type="hidden" name="blockId" value={block.id} />
                      <input
                        name="title"
                        defaultValue={block.title}
                        placeholder="Block title"
                        disabled={isLocked}
                      />
                      <textarea
                        name="content"
                        rows={3}
                        defaultValue={block.content}
                        placeholder="Block content..."
                        disabled={isLocked}
                      />
                      {!isLocked && (
                        <div>
                          <button type="submit" className="btn btn-sm">
                            Save text
                          </button>
                        </div>
                      )}
                    </form>

                    {/* Variants Section */}
                    {activeJd && (
                      <div
                        className="item-row stack"
                        style={{
                          background: "var(--color-bg-secondary, #f8f9fa)",
                        }}
                      >
                        <div
                          className="row"
                          style={{ justifyContent: "space-between" }}
                        >
                          <strong>
                            Variants for this block ({variants.length})
                          </strong>
                          {/* Manual override selection */}
                          <form
                            action={setManualOverrideAction}
                            className="row"
                          >
                            <input
                              type="hidden"
                              name="jdId"
                              value={activeJd.id}
                            />
                            <input
                              type="hidden"
                              name="parentBlockId"
                              value={parentBlockId}
                            />
                            <select
                              name="chosenBlockId"
                              defaultValue={block.id}
                            >
                              <option value={parentBlockId}>
                                Parent Default
                              </option>
                              {variants.map((v) => (
                                <option key={v.id} value={v.id}>
                                  Variant{" "}
                                  {v.title
                                    ? `(${v.title})`
                                    : `(${v.id.slice(0, 6)})`}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="btn btn-sm">
                              Set Selection Override
                            </button>
                          </form>
                        </div>

                        {/* Create/Regenerate Variant */}
                        <form action={createVariantAction} className="stack">
                          <input
                            type="hidden"
                            name="parentBlockId"
                            value={parentBlockId}
                          />
                          <input
                            type="hidden"
                            name="fromJdId"
                            value={activeJd.id}
                          />
                          <input
                            name="title"
                            defaultValue={block.title}
                            placeholder="Variant Title"
                            disabled={isLocked}
                          />
                          <textarea
                            name="content"
                            rows={2}
                            defaultValue={block.content}
                            placeholder="Tailored text for this job description..."
                            disabled={isLocked}
                          />
                          <div>
                            <button
                              type="submit"
                              className="btn btn-sm btn-primary"
                              disabled={isLocked}
                            >
                              Save / Regenerate Variant
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </li>
                );
              }
            )}
          </ul>
        )}
      </section>

      {/* Add Block Section */}
      <section className="section-card">
        <h2>Add Content Block</h2>
        <form action={createResumeBlockAction} className="stack">
          <div className="row">
            <label htmlFor="block-kind" className="muted">
              Kind
            </label>
            <select id="block-kind" name="kind" defaultValue="custom">
              {RESUME_BLOCK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              name="title"
              placeholder="Block title (e.g. Summary, Experience)"
            />
          </div>

          <div className="row">
            <select name="sourceRefType" defaultValue="">
              <option value="">No source reference</option>
              <option value="project">Project</option>
              <option value="work_experience">Work Experience</option>
            </select>
            <input
              name="sourceRefId"
              placeholder="Source entity ID (optional)"
            />
          </div>

          <textarea
            name="content"
            rows={4}
            placeholder="Write block content..."
            required
          />

          <div>
            <button type="submit" className="btn btn-primary">
              Add Block
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
