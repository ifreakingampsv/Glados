import { getSessionUser } from "@/lib/auth";
import { listEvents } from "@/services/events";
import { resolveEventSkillDisplays } from "@/services/skills";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
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
  const events = await listEvents(user.id);

  return (
    <main>
      <h1>Event history</h1>
      <p className="lede">
        Append-only log of all spine activity and evidence events.
      </p>

      <section className="section-card">
        {events.length === 0 ? (
          <p className="empty-state">
            No events recorded yet. Tag a skill or add a project to append your
            first event.
          </p>
        ) : (
          <ul className="item-list">
            {events.map(async (e) => {
              const skillNames =
                (e.skills as string[]).length > 0
                  ? await resolveEventSkillDisplays(e.skills as string[])
                  : [];
              return (
                <li key={e.id} className="item-row row-between">
                  <div className="row">
                    <span className="tabular muted">
                      {e.occurredAt.toISOString().slice(0, 10)}
                    </span>
                    <code>{e.type}</code>
                    {skillNames.length > 0 && (
                      <span className="muted">({skillNames.join(", ")})</span>
                    )}
                  </div>
                  <div className="row tabular">
                    <span
                      className={e.points > 0 ? "badge badge-success" : "badge"}
                    >
                      {e.points > 0 ? `+${e.points}` : e.points} pts
                    </span>
                    <span className="badge">{e.source}</span>
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
