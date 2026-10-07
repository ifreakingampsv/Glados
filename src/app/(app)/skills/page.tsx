import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listUserSkills } from "@/services/skills";
import { SkillTagger } from "@/components/skill-tagger";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const user = await getSessionUser();
  if (!user) {
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
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
      <SkillTagger />
      <ul>
        {tagged.map((t) => (
          <li key={t.id}>
            <strong>{display.get(t.skillId) ?? t.skillId}</strong>
            {" — evidenced score "}
            {t.score.toFixed(2)} (L{t.level})
            {t.claimedLevel ? `, claimed L${t.claimedLevel}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
