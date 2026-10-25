import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listUserSkills } from "@/services/skills";
import { listProjects } from "@/services/projects";
import { listUserCertificates } from "@/services/certificates";
import { describeUserSkillProvenance } from "@/services/work-experience";

export const dynamic = "force-dynamic";

export default async function HowLevelsWorkPage() {
  const user = await getSessionUser();
  const [userSkills, projects, certificates, completedQuizCount] = user
    ? await Promise.all([
        listUserSkills(user.id),
        listProjects(user.id),
        listUserCertificates(user.id),
        db.quizSession.count({
          where: { userId: user.id, outcome: "completed" },
        }),
      ])
    : [[], [], [], 0];
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
        Every skill on your profile carries an explicit provenance label and
        climbs a multi-source trust ladder so recruiters and gap maps
        distinguish corroborated engineering evidence from unvalidated claims.
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
              verified certificates from allowlisted providers, projects in your
              project bank, and completed calibration quizzes. Points decay with
              a 90-day half-life so active skills stay current.
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
              attached a repository, certificate, or quiz yet. Fills
              zero-evidence holes in gap maps at half weight, serves as a
              start-band placement hint for calibration quizzes, and never
              modifies your evidenced score.
            </p>
          </li>
          <li className="item-row stack">
            <div>
              <span className="badge badge-warn">
                unvalidated claim (0.5x weight)
              </span>
            </div>
            <p className="muted">
              Parsed from a resume, LinkedIn export, or off-list certificate
              without corroborating evidence. Evidence always wins when a skill
              has both an evidenced level and a claim.
            </p>
          </li>
        </ul>
      </section>

      <section className="section-card">
        <h2>Calibration rungs: quizzes and certificates</h2>
        <ul className="item-list">
          <li className="item-row stack">
            <div>
              <strong>
                Calibration quizzes (free, uncapped, 7-day cooldown)
              </strong>
            </div>
            <p className="muted">
              Every canonical leaf skill exposes a 6-question-round staircase
              across bands L0-1, L2-3, and L4-5 (hard cap 18 questions). Your
              session starts at the higher of your claimed or evidenced band.
              Retakes write signed deltas bounded strictly to prior decayed quiz
              credit: a lower retake can reduce quiz points to zero, but can
              never reduce your repository, work-experience, or certificate
              evidence.
            </p>
          </li>
          <li className="item-row stack">
            <div>
              <strong>Externally verified certificates</strong>
            </div>
            <p className="muted">
              Certificates from allowlisted providers (Coursera, AWS, Google
              Cloud, HashiCorp, CNCF, edX, Microsoft Learn, freeCodeCamp, Linux
              Foundation, HackerRank) are verified against their public verify
              URLs and decay from their issue date. Off-list or unverified
              certificates are stored as 0.5x claims with a one-line prompt to
              verify via a 6-question check.
            </p>
          </li>
          <li className="item-row stack">
            <div>
              <strong>Mock interviews</strong>
            </div>
            <p className="muted">
              A graded interview writes the strongest evidence we ship: the
              platform watched you defend your claims live. Deleting a session
              removes its transcript AND stops its evidence from counting —
              levels from that interview fall, visibly and honestly.
            </p>
          </li>
        </ul>
      </section>

      <section className="section-card">
        <h2>The Level 3 single-source corroboration cap</h2>
        <p className="muted">
          No single cap-limited evidence source (only imported GitHub repos,
          only work experience, only certificates, or only a calibration quiz)
          can push a skill past <strong>Level 3 (Proficient)</strong> on its
          own. Even if a single source accumulates enough raw points for Level 4
          or Level 5, the level clamps at Level 3 until a{" "}
          <strong>second distinct evidence source type</strong> (for example, an
          imported repository corroborated by a calibration quiz or verified
          certificate) confirms the skill.
        </p>
      </section>

      <section className="section-card">
        <h2>Worked example from your profile</h2>
        {!user || userSkills.length === 0 ? (
          <p className="empty-state">
            You do not have any skills on your profile yet. Import a resume,
            connect GitHub, or take a skill quiz to see your own skills
            calculated here.
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
                Level 3 requirement, it receives full 1.0x provenance weight. To
                reach Level 4 or Level 5, it requires at least two distinct
                corroborating evidence source types.
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
                claim weight until you take a 6-question calibration check or
                attach a project, work artifact, or verified certificate.
              </div>
            )}
            <p className="muted">
              Your profile currently holds {projects.length} project(s),{" "}
              {certificates.length} certificate(s), and {completedQuizCount}{" "}
              completed calibration quiz session(s).
            </p>
          </div>
        )}
      </section>

      <section className="section-card">
        <h2>Verify more skills</h2>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Convert 0.5x claims into 1.0x evidenced skills and uncap Level 3
          skills by combining calibration quizzes, public GitHub repositories,
          verified certificates, and confirmed work experience entries.
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Link href="/skills" className="btn btn-primary">
            Take a 6-question skill check
          </Link>
          <Link href="/projects" className="btn">
            Import repos or tag projects
          </Link>
          <Link href="/profile" className="btn">
            Manage work experience & certificates
          </Link>
          <Link href="/gaps" className="btn">
            Return to gap map
          </Link>
        </div>
      </section>
    </main>
  );
}
