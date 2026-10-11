import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listUserSkills } from "@/services/skills";
import { describeUserSkillProvenance } from "@/services/work-experience";
import { setSelfAssessedSkillAction } from "@/app/actions/profile";
import { SkillTagger } from "@/components/skill-tagger";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
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
  const tagged = await listUserSkills(user.id);
  const skillRows = tagged.length
    ? await db.skill.findMany({
        where: { id: { in: tagged.map((t) => t.skillId) } },
      })
    : [];
  const display = new Map(skillRows.map((s) => [s.id, s.display]));

  return (
    <main>
      <h1>Skills</h1>
      <p className="lede">
        Evidenced levels are computed from your event log with 90-day recency
        decay. Self-ratings and imported resume claims are stored separately and
        never alter evidenced scores.{" "}
        <Link href="/how-levels-work">How levels work</Link>
      </p>

      <section className="section-card">
        <h2>Tag a skill</h2>
        <SkillTagger />
      </section>

      <section className="section-card">
        <h2>Set self-assessed level (zero-evidence fallback)</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Self-assessed levels fill zero-evidence holes in gap maps and display
          as unvalidated claims. They never increase your evidenced score.
        </p>
        <form action={setSelfAssessedSkillAction} className="row">
          <input
            name="skillInput"
            placeholder="Canonical skill (e.g. Go, PostgreSQL)"
            required
          />
          <select
            name="claimedLevel"
            defaultValue="2"
            aria-label="Self-assessed level"
          >
            <option value="1">Level 1 (Familiar)</option>
            <option value="2">Level 2 (Working)</option>
            <option value="3">Level 3 (Proficient)</option>
            <option value="4">Level 4 (Advanced)</option>
            <option value="5">Level 5 (Expert)</option>
          </select>
          <button type="submit" className="btn btn-primary">
            Save self-assessment
          </button>
        </form>
      </section>

      <section className="section-card">
        <h2>Your skills ({tagged.length})</h2>
        {tagged.length === 0 ? (
          <p className="empty-state">
            No skills tagged yet. Use the tagger above to add a canonical or
            candidate skill.
          </p>
        ) : (
          <ul className="item-list">
            {tagged.map((t) => {
              const prov = describeUserSkillProvenance(t);
              return (
                <li key={t.id} className="item-row row-between">
                  <div className="row">
                    <strong>{display.get(t.skillId) ?? t.skillId}</strong>
                    <Link
                      href={prov.explainerHref}
                      className={`badge ${prov.isUnvalidated ? "badge-warn" : "badge-accent"}`}
                    >
                      {prov.label}
                    </Link>
                    {prov.isStale && (
                      <span className="badge badge-warn">
                        Stale ({t.staleOrigins.join(", ")})
                      </span>
                    )}
                  </div>
                  <div className="row tabular">
                    <span className="badge badge-accent">
                      Evidenced L{t.level} ({t.score.toFixed(2)} pts)
                    </span>
                    {t.claimedLevel ? (
                      <span className="badge badge-warning">
                        Claimed L{t.claimedLevel}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
