import { getSessionUser } from "@/lib/auth";
import { listEvents } from "@/services/events";
import { resolveEventSkillDisplays } from "@/services/skills";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const user = await getSessionUser();
  if (!user) {
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
  }
  const events = await listEvents(user.id);

  return (
    <main>
      <h1>Event history</h1>
      <ul>
        {events.map(async (e) => (
          <li key={e.id}>
            {e.occurredAt.toISOString().slice(0, 10)} · {e.type} ·{" "}
            {e.points > 0 ? `+${e.points}` : e.points} pts · {e.source}
            {(e.skills as string[]).length > 0 && (
              <em>
                {" "}
                —{" "}
                {(await resolveEventSkillDisplays(e.skills as string[])).join(
                  ", "
                )}
              </em>
            )}
          </li>
        ))}
        {events.length === 0 && (
          <li>No events yet — tag a skill or add a project.</li>
        )}
      </ul>
    </main>
  );
}
