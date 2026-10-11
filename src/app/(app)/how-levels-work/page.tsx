import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listUserSkills } from "@/services/skills";
import { listProjects } from "@/services/projects";
import { describeUserSkillProvenance } from "@/services/work-experience";

export const dynamic = "force-dynamic";

export default async function HowLevelsWorkPage() {
  const user = await getSessionUser();
  const userSkills = user ? await listUserSkills(user.id) : [];
  const projects = user ? await listProjects(user.id) : [];
  const skillIds = userSkills.map((u) => u.skillId);
  const skillRows = skillIds.length
    ? await db.skill.findMany({ where: { id: { in: skillIds } } })
    : [];
  const displayById = new Map(skillRows.map((s) => [s.id, s.display]));

  const sampleEvidenced = userSkills.find((u) => u.level > 0 || u.score > 0);
  const sampleClaimed = userSkills.find(
    (u) => u.level === 0 && u.score === 0 && (u.claimedLevel ?? 0) > 0
  );

  return (
    <main>
      <h1>How levels and provenance work</h1>
      <p className="lede">
        Every skill on your profile carries an explicit provenance label so
        recruiters and gap maps distinguish verified engineering artifacts from
        unvalidated claims.
      </p>

      <section className="section-card">
        <h2>The three provenance tiers</h2>
        <ul className="item-list">
          <li className="item-row stack">
            <div>
              <span className="badge badge-accent">
                evidenced (1.0x weight)
              </span>
            </div>
            <p className="muted">
              Backed by verifiable events in your append-only log: imported
              non-fork GitHub repositories, structured work experience entries,
              projects in your project bank, and completed assessments. Points
              decay with a 90-day half-life so active skills stay current.
            </p>
          </li>
          <li className="item-row stack">
            <div>
              <span className="badge badge-warn">
                self-assessed (0.5x weight in zero-evidence holes)
              </span>
            </div>
            <p className="muted">
              Explicitly rated by you (L1 to L5) for skills where you have not
              attached a repository or work artifact yet. Fills zero-evidence
              holes in gap maps at half weight and never modifies your evidenced
              score.
            </p>
          </li>
          <li className="item-row stack">
            <div>
              <span className="badge badge-warn">
                unvalidated claim (0.5x weight)
              </span>
            </div>
            <p className="muted">
              Parsed from a resume or LinkedIn export without corroborating
              project or work-experience evidence. Evidence always wins when a
              skill has both an evidenced level and a claim.
            </p>
          </li>
        </ul>
      </section>

      <section className="section-card">
        <h2>Worked example from your profile</h2>
        {!user || userSkills.length === 0 ? (
          <p className="empty-state">
            You do not have any skills on your profile yet. Import a resume or
            connect GitHub to see your own skills calculated here.
          </p>
        ) : (
          <div className="stack">
            {sampleEvidenced && (
              <div className="item-row">
                <strong>
                  {displayById.get(sampleEvidenced.skillId) ??
                    sampleEvidenced.skillId}
                </strong>{" "}
                is{" "}
                <span className="badge badge-accent">
                  {describeUserSkillProvenance(sampleEvidenced).label}
                </span>{" "}
                at <strong>Level {sampleEvidenced.level}</strong> (
                {sampleEvidenced.score.toFixed(1)} decayed points). Against a
                Level 3 requirement, it receives full 1.0x provenance weight.
              </div>
            )}
            {sampleClaimed && (
              <div className="item-row">
                <strong>
                  {displayById.get(sampleClaimed.skillId) ??
                    sampleClaimed.skillId}
                </strong>{" "}
                is currently an{" "}
                <span className="badge badge-warn">
                  {describeUserSkillProvenance(sampleClaimed).label}
                </span>{" "}
                (Claimed L{sampleClaimed.claimedLevel ?? 1}, 0.0 evidenced
                points). Against a requirement, its credit is capped by the 0.5x
                claim weight until you attach a project or work artifact.
              </div>
            )}
            <p className="muted">
              You currently have {projects.length} project(s) in your curated
              project bank.
            </p>
          </div>
        )}
      </section>

      <section className="section-card">
        <h2>Verify more skills</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Convert 0.5x claims into 1.0x evidenced skills by importing public
          GitHub repositories, tagging skills on your shipped projects, or
          confirming work experience entries.
        </p>
        <div className="row">
          <Link href="/projects" className="btn btn-primary">
            Import repos or tag projects
          </Link>
          <Link href="/profile" className="btn">
            Manage work experience
          </Link>
          <Link href="/gaps" className="btn">
            Return to gap map
          </Link>
        </div>
      </section>
    </main>
  );
}
