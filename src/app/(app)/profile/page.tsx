import { getSessionUser } from "@/lib/auth";
import {
  KNOWN_PREFERENCE_KEYS,
  PROFILE_SECTIONS,
  getPreferences,
  getProfile,
  listTargetRoles,
} from "@/services/profile";
import { LINKEDIN_PDF_GUIDE_COPY } from "@/services/resume-parse";
import { listWorkExperiences } from "@/services/work-experience";
import {
  getPendingStagedImports,
  type StagedDiffItem,
} from "@/services/diff-and-stage";
import {
  acceptStagedImportAction,
  addRoleAction,
  confirmWorkExperienceAction,
  declineStagedImportAction,
  importResumeOrLinkedinAction,
  promoteWorkExperienceAction,
  removeRoleAction,
  setPreferenceAction,
  setPrimaryAction,
  updateSectionAction,
} from "@/app/actions/profile";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
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
  const [profile, roles, prefs, workExperiences, stagedImports] =
    await Promise.all([
      getProfile(user.id),
      listTargetRoles(user.id),
      getPreferences(user.id),
      listWorkExperiences(user.id),
      getPendingStagedImports(user.id),
    ]);
  const fields = profile.fields as Record<string, unknown>;

  return (
    <main>
      <h1>Profile</h1>
      <p className="lede">
        Manage your structured spine fields, import your resume or LinkedIn
        export, review staged updates, and curate work experience evidence.
      </p>

      <section className="section-card">
        <h2>Import resume or LinkedIn export</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          First import seeds your profile, skill claims, resume blocks, and work
          experience evidence in one transaction. Re-uploading from the same
          source stages a diff for your review before any changes apply.
        </p>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          <strong>LinkedIn guide:</strong> {LINKEDIN_PDF_GUIDE_COPY}
        </p>
        <form action={importResumeOrLinkedinAction} className="stack">
          <div className="row">
            <label htmlFor="import-source" className="muted">
              Source
            </label>
            <select id="import-source" name="source" defaultValue="resume">
              <option value="resume">Resume (PDF or text)</option>
              <option value="linkedin">
                LinkedIn data export (PDF or text)
              </option>
            </select>
            <input
              type="file"
              name="pdfFile"
              accept="application/pdf"
              aria-label="Upload PDF file"
            />
          </div>
          <textarea
            name="rawText"
            rows={4}
            placeholder="Or paste your resume / LinkedIn export text directly..."
          />
          <div>
            <button type="submit" className="btn btn-primary">
              Parse and import
            </button>
          </div>
        </form>
      </section>

      {stagedImports.length > 0 && (
        <section className="section-card">
          <h2>Review staged re-upload ({stagedImports.length})</h2>
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            Diff computed against same-source content only. Evidence-backed
            levels always win and are never downgraded. Claims absent from the
            latest upload are flagged stale per source, never deleted.
          </p>
          {stagedImports.map((staged) => {
            const diffItems =
              (staged.diffItems as unknown as StagedDiffItem[]) ?? [];
            return (
              <div key={staged.id} className="item-row stack">
                <div
                  className="row"
                  style={{ justifyContent: "space-between" }}
                >
                  <strong>
                    Source: {staged.source} ({diffItems.length} items)
                  </strong>
                  <form action={declineStagedImportAction}>
                    <input type="hidden" name="stagingId" value={staged.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Decline all
                    </button>
                  </form>
                </div>
                <form action={acceptStagedImportAction} className="stack">
                  <input type="hidden" name="stagingId" value={staged.id} />
                  <ul className="item-list">
                    {diffItems.map((item) => (
                      <li key={item.id} className="item-row row-between">
                        <label className="row" style={{ cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            name="acceptedItemIds"
                            value={item.id}
                            defaultChecked={item.outcome !== "same"}
                            style={{ width: "auto" }}
                          />
                          <span>{item.label}</span>
                        </label>
                        <div className="row">
                          <span className="badge">{item.outcome}</span>
                          {item.evidenceConflictResolved && (
                            <span className="badge badge-accent">
                              Evidence wins
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Accept selected changes
                    </button>
                  </div>
                </form>
              </div>
            );
          })}
        </section>
      )}

      <section className="section-card">
        <h2>Work experience ({workExperiences.length})</h2>
        {workExperiences.length === 0 ? (
          <p className="empty-state">
            No work experience entries imported yet. Upload a resume or LinkedIn
            export above to populate structured experience evidence.
          </p>
        ) : (
          <ul className="item-list">
            {workExperiences.map((exp) => (
              <li key={exp.id} className="item-row stack">
                <div
                  className="row"
                  style={{ justifyContent: "space-between" }}
                >
                  <div>
                    <strong>
                      {exp.title} at {exp.employer}
                    </strong>{" "}
                    <span className="muted">({exp.period})</span>
                  </div>
                  <div className="row">
                    <span className="badge">{exp.kind}</span>
                    <span className="badge badge-neutral">
                      Origin: {exp.origin}
                    </span>
                    {exp.staleOrigins.length > 0 && (
                      <span className="badge badge-warn">
                        Stale ({exp.staleOrigins.join(", ")})
                      </span>
                    )}
                  </div>
                </div>
                <p className="muted">{exp.description}</p>
                <div className="row">
                  <form action={confirmWorkExperienceAction}>
                    <input
                      type="hidden"
                      name="workExperienceId"
                      value={exp.id}
                    />
                    <button type="submit" className="btn btn-sm">
                      Re-confirm experience
                    </button>
                  </form>
                  {!exp.promotedProjectId ? (
                    <form action={promoteWorkExperienceAction}>
                      <input
                        type="hidden"
                        name="workExperienceId"
                        value={exp.id}
                      />
                      <button type="submit" className="btn btn-sm btn-primary">
                        Promote to project
                      </button>
                    </form>
                  ) : (
                    <span className="badge badge-accent">
                      Promoted to project bank
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section-card">
        <h2>Field dictionary (JSON-Resume compatible)</h2>
        <div className="stack" style={{ marginBottom: "1rem" }}>
          {Object.entries(fields).map(([section, value]) => (
            <div key={section} className="item-row">
              <strong>{section}</strong>
              <pre>{JSON.stringify(value, null, 2)}</pre>
            </div>
          ))}
        </div>
        <form action={updateSectionAction} className="stack">
          <div className="row">
            <label htmlFor="profile-section" className="muted">
              Section
            </label>
            <select id="profile-section" name="section">
              {PROFILE_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <textarea
            name="value"
            placeholder='{"name": "Ada Lovelace", "summary": "Systems engineer"}'
            rows={3}
          />
          <div>
            <button type="submit" className="btn btn-primary">
              Save section
            </button>
          </div>
        </form>
      </section>

      <section className="section-card">
        <h2>Target roles</h2>
        {roles.length === 0 ? (
          <p className="empty-state">
            No target roles added yet. Add a role below to anchor gap diagnosis
            and reviews.
          </p>
        ) : (
          <ul className="item-list" style={{ marginBottom: "1rem" }}>
            {roles.map((r) => (
              <li key={r.id} className="item-row row-between">
                <div className="row">
                  <strong>{r.title}</strong>
                  {r.seniority && <span className="badge">{r.seniority}</span>}
                  {r.isPrimary && (
                    <span className="badge badge-accent">Primary</span>
                  )}
                </div>
                <div className="row">
                  {!r.isPrimary && (
                    <form action={setPrimaryAction}>
                      <input type="hidden" name="roleId" value={r.id} />
                      <button type="submit" className="btn btn-sm">
                        Make primary
                      </button>
                    </form>
                  )}
                  <form action={removeRoleAction}>
                    <input type="hidden" name="roleId" value={r.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={addRoleAction} className="row">
          <input name="title" placeholder="Backend Engineer" required />
          <input name="seniority" placeholder="Junior (optional)" />
          <button type="submit" className="btn btn-primary">
            Add role
          </button>
        </form>
      </section>

      <section className="section-card">
        <h2>Preferences</h2>
        {prefs.length === 0 ? (
          <p className="empty-state">
            No preferences saved yet. Set a preference key below.
          </p>
        ) : (
          <ul className="item-list" style={{ marginBottom: "1rem" }}>
            {prefs.map((p) => (
              <li key={p.id} className="item-row row-between">
                <code>{p.key}</code>
                <span>{p.value}</span>
              </li>
            ))}
          </ul>
        )}
        <form action={setPreferenceAction} className="row">
          <select name="key" aria-label="Preference key">
            {KNOWN_PREFERENCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input name="value" placeholder="Value" required />
          <button type="submit" className="btn btn-primary">
            Save preference
          </button>
        </form>
      </section>
    </main>
  );
}
