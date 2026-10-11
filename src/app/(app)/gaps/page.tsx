import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { listJobDescriptions, type ExtractedJdSkill } from "@/services/jd";
import { computeGapMap, resolveGapMapMode } from "@/services/gap-map";
import {
  createJdAction,
  deleteJdAction,
  setGapModeAction,
} from "@/app/actions/jds";

export const dynamic = "force-dynamic";

export default async function GapsPage({
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
  const [jds, modeInfo] = await Promise.all([
    listJobDescriptions(user.id),
    resolveGapMapMode(user.id),
  ]);

  const activeJd =
    jds.find((j) => j.id === params.jdId) ?? (jds.length > 0 ? jds[0] : null);

  const activeReqs = activeJd
    ? ((activeJd.requiredSkills as unknown as ExtractedJdSkill[]) ?? [])
    : [];

  const gapResult = activeJd
    ? await computeGapMap({
        mode: modeInfo.mode,
        userId: user.id,
        requirements: activeReqs.map((r) => ({
          skillId: r.skillId,
          expectedLevel: r.expectedLevel,
        })),
      })
    : null;

  return (
    <main>
      <h1>Job descriptions and gap map</h1>
      <p className="lede">
        Save job descriptions to compare canonical skill requirements against
        either your imported resume claims or your evidenced profile.
      </p>

      {params.error === "empty-jd" && (
        <div className="alert alert-danger" role="alert">
          Paste a job description before extracting requirements.
        </div>
      )}

      <section className="section-card">
        <h2>Add job description</h2>
        <form action={createJdAction} className="stack">
          <div className="row">
            <input name="title" placeholder="Role title (optional)" />
            <input name="company" placeholder="Company (optional)" />
          </div>
          <textarea
            name="rawText"
            rows={4}
            placeholder="Paste the full job description text..."
            required
          />
          <div>
            <button type="submit" className="btn btn-primary">
              Save and extract requirements
            </button>
          </div>
        </form>
      </section>

      <section className="section-card">
        <h2>Saved job descriptions ({jds.length})</h2>
        {jds.length === 0 ? (
          <p className="empty-state">
            No job descriptions saved yet. Paste a job description above to run
            requirement extraction and compute your fit score.
          </p>
        ) : (
          <ul className="item-list">
            {jds.map((jd) => {
              const reqs =
                (jd.requiredSkills as unknown as ExtractedJdSkill[]) ?? [];
              const isSelected = activeJd?.id === jd.id;
              return (
                <li key={jd.id} className="item-row row-between">
                  <div>
                    <Link href={`/gaps?jdId=${jd.id}`}>
                      <strong>{jd.title}</strong>
                    </Link>
                    {jd.company && (
                      <span className="muted"> at {jd.company}</span>
                    )}
                    <span className="badge" style={{ marginLeft: "0.5rem" }}>
                      {reqs.length} skills
                    </span>
                    {isSelected && (
                      <span
                        className="badge badge-accent"
                        style={{ marginLeft: "0.5rem" }}
                      >
                        Selected
                      </span>
                    )}
                  </div>
                  <form action={deleteJdAction}>
                    <input type="hidden" name="jdId" value={jd.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Delete
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activeJd && gapResult && (
        <section className="section-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>
                Gap map: {activeJd.title} ({gapResult.fitPercent}% fit)
              </h2>
              <p className="muted" style={{ marginTop: "0.25rem" }}>
                Active mode: <strong>{modeInfo.mode}</strong>.{" "}
                {modeInfo.mode === "profile"
                  ? "Evidenced levels and project-bank skills carry 1.0x weight; claims fill zero-evidence holes at 0.5x weight."
                  : "Resume mode scores unvalidated claims at 0.5x weight."}{" "}
                <Link href="/how-levels-work">How levels work</Link>
              </p>
            </div>

            {modeInfo.canToggleToProfile ? (
              <form action={setGapModeAction} className="row">
                <input
                  type="hidden"
                  name="mode"
                  value={modeInfo.mode === "profile" ? "resume" : "profile"}
                />
                <button type="submit" className="btn btn-sm">
                  Switch to{" "}
                  {modeInfo.mode === "profile" ? "Resume mode" : "Profile mode"}
                </button>
              </form>
            ) : (
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Resume mode active (add projects or evidence on your profile to
                unlock Profile mode)
              </span>
            )}
          </div>

          <ul className="item-list" style={{ marginTop: "1rem" }}>
            {gapResult.items.map((item) => (
              <li key={item.requiredSkillId} className="item-row row-between">
                <div>
                  <strong>{item.requiredSkillDisplay}</strong>
                  <span className="muted" style={{ marginLeft: "0.5rem" }}>
                    Expected L{item.expectedLevel}
                  </span>
                  {item.matchedBySkillId &&
                    item.matchedBySkillId !== item.requiredSkillId && (
                      <span className="badge" style={{ marginLeft: "0.5rem" }}>
                        Matched via {item.matchedByDisplay}
                      </span>
                    )}
                </div>
                <div className="row tabular">
                  <Link
                    href={item.explainerHref}
                    className={`badge ${
                      item.provenance === "evidenced"
                        ? "badge-accent"
                        : item.provenance === "missing"
                          ? "badge-danger"
                          : "badge-warn"
                    }`}
                  >
                    {item.provenance} (L{item.effectiveLevel})
                  </Link>
                  <span className="badge">
                    Credit: {(item.credit * 100).toFixed(0)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
