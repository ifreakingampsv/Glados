import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDiscoverCards, browseShelf } from "@/services/shelf-match";
import { pickMapFor, listNotes } from "@/services/picks";
import {
  pickAction,
  saveNoteAction,
  setDiscoverArchetypesAction,
  setPickStatusAction,
  toggleDiscoverGapsAction,
} from "@/app/actions/discover";
import { FlagshipButton } from "./flagship-button";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams?: Promise<{
    mode?: string;
    lane?: string;
    band?: string;
    page?: string;
  }>;
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
  const mode =
    params.mode === "gaps"
      ? "gaps"
      : params.mode === "strengths"
        ? "strengths"
        : undefined;
  const discover = await getDiscoverCards(user.id, { mode });
  const picks = await pickMapFor(user.id);
  const notes = await listNotes(user.id);
  const browse = await browseShelf({
    lane:
      params.lane === "list" || params.lane === "search"
        ? params.lane
        : undefined,
    band: params.band,
    page: Number(params.page ?? 1) || 1,
  });

  const bands = ["underrated", "solid", "established"];

  return (
    <main className="section-card">
      <h1>Discover</h1>
      <p>
        Rebuildable open-source projects, matched against your evidenced skills
        and target role. Fresh candidates land on the shelf every night.
      </p>

      {discover.fallback ? (
        <p className="alert alert-warning" role="status">
          Showing the global top shelf —{" "}
          <Link href="/profile">add skills or a target role</Link> (or import a
          resume) to personalize these picks.
        </p>
      ) : null}

      <section className="stack">
        <div>
          <form
            action={async () => {
              "use server";
              await toggleDiscoverGapsAction(!discover.gapsMode);
            }}
          >
            <button type="submit" className="btn btn-secondary">
              {discover.gapsMode
                ? "Back to strengths (default)"
                : "Aim at my gaps"}
            </button>
          </form>
          <p>
            {discover.gapsMode
              ? "Gap mode: repos that teach you skills you don't have yet."
              : "Strengths mode: repos you're ready to rebuild today."}{" "}
            Your choice persists.
          </p>
        </div>

        <h2>Matched for you</h2>
        {discover.cards.length === 0 ? (
          <p className="empty-state">
            The shelf is still filling — the nightly job hasn&apos;t run yet.
          </p>
        ) : (
          <ul className="stack">
            {discover.cards.map((card) => {
              const pick = picks.get(card.githubId);
              return (
                <li key={card.githubId} className="card">
                  <h3>
                    <a href={card.htmlUrl} target="_blank" rel="noreferrer">
                      {card.fullName}
                    </a>{" "}
                    <small>
                      ★ {card.stars}
                      {card.bandKey ? ` · ${card.bandKey}` : ""}
                      {card.language ? ` · ${card.language}` : ""}
                      {card.laneList && card.crossListCount > 1
                        ? ` · vouched by ${card.crossListCount} lists`
                        : card.laneList
                          ? " · curated list"
                          : " · hidden gem"}
                    </small>
                  </h3>
                  {card.description ? <p>{card.description}</p> : null}
                  <ul aria-label="why this card">
                    {card.fitLines.map((line) => (
                      <li key={line}>
                        <small>{line}</small>
                      </li>
                    ))}
                  </ul>
                  {card.annotation ? (
                    <details>
                      <summary>Why it&apos;s worth rebuilding</summary>
                      <p>{card.annotation.memorableWhy}</p>
                      <p>
                        <strong>Modification ideas:</strong>
                      </p>
                      <ul>
                        {card.annotation.modificationIdeas.map((idea) => (
                          <li key={idea}>{idea}</li>
                        ))}
                      </ul>
                      <p>
                        <strong>You&apos;d learn:</strong>{" "}
                        {card.annotation.learningPayoff}
                      </p>
                    </details>
                  ) : null}
                  <div className="row">
                    <FlagshipButton repoGithubId={card.githubId} />
                    {!pick ? (
                      <form
                        action={async () => {
                          "use server";
                          await pickAction(card.githubId);
                        }}
                      >
                        <button type="submit">Consider rebuilding</button>
                      </form>
                    ) : pick === "considering" ? (
                      <>
                        <span>Considering</span>
                        <form
                          action={async () => {
                            "use server";
                            await setPickStatusAction(
                              card.githubId,
                              "building"
                            );
                          }}
                        >
                          <button type="submit">Started building</button>
                        </form>
                        <form
                          action={async () => {
                            "use server";
                            await setPickStatusAction(card.githubId, "dropped");
                          }}
                        >
                          <button type="submit">Drop</button>
                        </form>
                      </>
                    ) : (
                      <span>
                        Building — guided rebuild ships in the next slice
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <h2>Focus archetypes</h2>
        <p>
          Explicit picks beat title matching (edit your target roles under{" "}
          <Link href="/profile">Profile</Link>).
        </p>
        <div className="row">
          {discover.archetypes.map((a) => (
            <form
              key={a.key}
              action={async () => {
                "use server";
                const active = discover.archetypes
                  .filter((x) => x.active)
                  .map((x) => x.key);
                const next = a.active
                  ? active.filter((k) => k !== a.key)
                  : [...active, a.key];
                await setDiscoverArchetypesAction(next);
              }}
            >
              <button
                type="submit"
                className={a.active ? "btn btn-primary" : "btn btn-secondary"}
              >
                {a.name}
              </button>
            </form>
          ))}
        </div>

        <h2>Save a flagship brief</h2>
        <p>
          Ran the deep-dive prompt in your own AI? Paste the brief here — it
          saves as a note you can review later (study mode lands next slices).
        </p>
        <form
          action={async (formData: FormData) => {
            "use server";
            const title = String(formData.get("title") ?? "").trim();
            const content = String(formData.get("content") ?? "").trim();
            const repoGithubId =
              Number(formData.get("repoGithubId") ?? 0) || null;
            if (title && content)
              await saveNoteAction({ title, content, repoGithubId });
          }}
        >
          <input
            name="title"
            placeholder="Brief title (e.g. IncarnaMind deep-dive)"
          />
          <select name="repoGithubId" defaultValue="">
            <option value="">No repo link</option>
            {discover.cards.map((c) => (
              <option key={c.githubId} value={c.githubId}>
                {c.fullName}
              </option>
            ))}
          </select>
          <textarea
            name="content"
            rows={6}
            placeholder="Paste the brief your AI produced…"
          />
          <button type="submit" className="btn btn-primary">
            Save note
          </button>
        </form>
        {notes.length > 0 ? (
          <details>
            <summary>Your notes ({notes.length})</summary>
            <ul>
              {notes.slice(0, 10).map((n) => (
                <li key={n.id}>
                  <strong>{n.title}</strong> <small>{n.source}</small>
                  <p>{n.content.slice(0, 300)}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="stack">
        <h2>Browse the shelf</h2>
        <p className="row">
          <Link href="/discover">All</Link> ·{" "}
          <Link href="/discover?lane=list">Curated lists</Link> ·{" "}
          <Link href="/discover?lane=search">Hidden gems</Link>
          {" · "}
          {bands.map((b) => (
            <span key={b}>
              <Link href={`/discover?band=${b}`}>{b}</Link>
              {" · "}
            </span>
          ))}
        </p>
        {browse.repos.length === 0 ? (
          <p className="empty-state">Nothing on the shelf yet.</p>
        ) : (
          <ul>
            {browse.repos.map((r) => (
              <li key={r.githubId}>
                <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                  {r.fullName}
                </a>{" "}
                <small>
                  ★ {r.stars} · score {r.score.toFixed(2)}
                  {r.language ? ` · ${r.language}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
        {browse.total > browse.pageSize ? (
          <p>
            <Link href={`/discover?page=${browse.page + 1}`}>Next page</Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
