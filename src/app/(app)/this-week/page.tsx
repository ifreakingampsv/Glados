import { getSessionUser } from "@/lib/auth";
import { buildBriefing, setUnsubscribed } from "@/services/briefing";
import { unsubscribeBriefingAction } from "@/app/actions/interview";

export const dynamic = "force-dynamic";

export default async function ThisWeekPage({
  searchParams,
}: {
  searchParams?: Promise<{ unsubscribe?: string }>;
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
  if (params.unsubscribe === "1") {
    await setUnsubscribed(user.id, true);
  }
  const briefing = await buildBriefing(user.id);
  const b = briefing?.blocks;

  return (
    <main className="section-card">
      <h1>This week</h1>
      {params.unsubscribe === "1" ? (
        <p role="status">You&apos;re unsubscribed — no more Monday emails.</p>
      ) : null}
      {!b ? (
        <p className="empty-state">Nothing to show yet.</p>
      ) : (
        <div className="stack">
          <section>
            <h2>Activity</h2>
            {b.eventsThisWeek.length === 0 ? (
              <p className="muted">
                No evidence events this week — quiet week.
              </p>
            ) : (
              <ul>
                {b.eventsThisWeek.map((e, i) => (
                  <li key={i}>
                    {e.label} — <small>{e.detail}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2>
              Evidence points: {b.pointsDelta >= 0 ? "+" : ""}
              {b.pointsDelta}
            </h2>
            {b.levelMoves.length > 0 ? (
              <ul>
                {b.levelMoves.map((m, i) => (
                  <li key={i}>
                    {m.skill}: {m.delta >= 0 ? "+" : ""}
                    {m.delta} {m.delta < 0 ? "(levels can fall — honesty)" : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          {b.dimensionTrend.length > 0 ? (
            <section>
              <h2>Interview dimensions</h2>
              <ul>
                {b.dimensionTrend.map((d) => (
                  <li key={d.dimension}>
                    {d.dimension}: {d.scores.join(" → ")}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h2>Energy</h2>
            <p className="muted">
              {b.energy.balance} bar(s) banked.
              {b.energy.earnedThisWeek ? " You earned this week's bar." : ""}
              {b.energy.bankDecaying
                ? " ⚠ Your bank is decaying — spend it."
                : ""}
            </p>
          </section>
          {briefing?.coachNote ? (
            <section>
              <h2>Coach&apos;s note</h2>
              <p>{briefing.coachNote}</p>
            </section>
          ) : null}
          {briefing?.cta ? (
            <section>
              <h2>One thing this week</h2>
              <p>
                <strong>{briefing.cta.label}.</strong>
              </p>
            </section>
          ) : null}
        </div>
      )}
      <form action={unsubscribeBriefingAction}>
        <button type="submit" className="secondary">
          Unsubscribe from Monday emails
        </button>
      </form>
    </main>
  );
}
