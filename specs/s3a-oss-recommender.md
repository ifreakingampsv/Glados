# S3a — OSS recommender: the shelf + spine matching

Spec finalized 2026-10-26. Sources: [D90]–[D96] in docs/DECISIONS.md (S3a design
chat + grill), docs/prior-art/oss-recommender.md §4–§5 (pre-agreed directions and
economics), CONTEXT.md "OSS recommender (S3a)" vocabulary. Vocabulary rule: the
corpus is the SHELF (not "library"); the AI card text is the ANNOTATION (the
"brief" is the user-side flagship-prompt output).

## Problem Statement

A job-seeker who wants a portfolio-worthy project has no good way to find one.
GitHub search buries them in thousands of wrapper clones and abandoned
experiments; curated lists go stale; "trending" has no API and mostly shows
what's already famous. Nothing knows what they already know, what level they're
at, or what job they're aiming at — so even a good find is a lucky accident,
and judging whether a repo is alive, testable, license-clean, and small enough
to rebuild solo is an hour of manual digging per candidate.

## Solution

A `/discover` page backed by a shared, platform-built **shelf**: a corpus of
rebuildable repos collected every night through two lanes (curated lists humans
already vouch for + a fixed grid of hard-qualified GitHub searches per
**archetype**), scored by deterministic rules, and decorated by a single cheap
AI **annotation** per repo. The user's spine (evidenced + claimed skills, target
role) matches against shelf repos' canonical skill tags, producing a top-5 of
cards with honest provenance labels, a stretch badge for one-level-up repos, and
a strengths-default / gaps-toggle emphasis. Every card hands off the deep work
to the user's own AI via the pre-filled flagship prompt; the brief they get back
lands as a note. Picking a repo creates a study-list entry — never a project,
never evidence. A read-only MCP tool exposes the same shortlist to the user's
harness. Per-user cost is one SQL query.

## User Stories

1. As the platform, I want a nightly job that runs a fixed grid of GitHub
   searches per archetype, so the shelf fills with fresh candidates without
   human effort.
2. As the platform, I want the curated lists re-read weekly, so human-vouched
   repos enter the shelf and dropped ones lose their vouch.
3. As the platform, I want hard anti-generic gates (negative keywords/topics,
   wrapper + outsourced-backend detection) as config rows, so chat-with-pdf
   clones never reach the shelf.
4. As the platform, I want dedupe by repo + default-branch sha, so unchanged
   repos cost nothing on re-runs.
5. As the platform, I want `fork:false` in every grid query and a fork re-check
   at enrich, so forks never enter scoring.
6. As the platform, I want enrichment per new/changed repo (official star
   history, tests/CI file checks, README length, license, size), so every shelf
   repo carries scorable facts.
7. As the platform, I want enrich-time tagging through a read-only resolver, so
   repos get canonical skill tags without flooding the admin promotion queue.
8. As an admin, I want a top-unmatched-topics readout, so I can deliberately
   grow the alias list where real repos need it.
9. As the platform, I want a deterministic weighted score with config-row
   weights, so ranking is explainable and tunable without deploys.
10. As the platform, I want star velocity compared within star bands, so hidden
    gems aren't drowned by giants.
11. As the platform, I want lane trust flags (cross-list vouch vs
    band+velocity), so trust is visible on one shelf, not two UIs.
12. As the platform, I want an AI annotation per top-N new nightly survivor —
    why memorable, 3–5 modification ideas, learning payoff — so cards explain
    themselves.
13. As the platform, I want annotations cached by repo + branch sha, so
    unchanged repos never regenerate.
14. As the platform, I want dead repos (archived, 18-months-silent) flagged off
    the shelf, so users never see abandoned projects.
15. As an admin, I want a global nightly query cap with rotating coverage, so
    archetype growth can never silently blow the rate budget.
16. As an admin, I want archetypes as editable config rows (~6–10 seeded), so
    adding "mobile engineer" is data entry, not code.
17. As an admin, I want the whole slice behind one feature flag, so a
    misbehaving GitHub API or bad annotation run can be killed instantly.
18. As a logged-in user, I want my /discover page to show the 5 best-matched
    repos, so I see projects worth rebuilding without browsing GitHub.
19. As a user, I want each card labeled by signal (evidenced / claimed /
    target-role fit), so I know why I'm seeing it.
20. As a user, I want a stretch badge on repos one level above my evidenced
    skills, so I can reach without drowning.
21. As a user, I want an "aim at my gaps" toggle, so I can switch to
    learn-by-rebuilding emphasis — and my choice persists.
22. As a user, I want repos I've already imported excluded, so I'm never
    recommended my own work.
23. As a new user with an empty spine, I want a global top-shelf fallback with
    a personalize CTA, so the page is never dead.
24. As a user, I want to browse the whole shelf with filters (lane, star band,
    archetype), so I can explore beyond my match.
25. As a user, I want explicit archetype picks that beat inferred matching, so
    the shelf reflects the direction I choose.
26. As a user, I want match results computed live from my spine, so finishing a
    quiz or interview changes my cards immediately.
27. As a user, I want fit lines on cards built by deterministic template
    interpolation, so "why it fits you" is never AI-improvised.
28. As a user, I want a "deep-dive this in your AI" button that copies my
    flagship prompt pre-filled with the repo and my skill context, so I get a
    deep brief on my own tokens.
29. As a user, I want to paste the brief back and save it as a note with an
    optional skill link, so my learning lives on the spine.
30. As a user, I want to pick a repo into a study list (considering → building
    → dropped), so my rebuild intentions persist.
31. As a user, I want picking and browsing to write no evidence, so window
    shopping never inflates my levels or farms my energy bar.
32. As a harness user, I want `get_rebuild_shortlist` over MCP, so my own agent
    can pull my shelf and run the flagship deep-dive itself.
33. As a harness user, I want the tool read-only, so pulling cards never writes
    anything to my spine.
34. As an admin, I want shown/clicked telemetry per card, so scoring misses
    are visible.
35. As an admin, I want CTR readouts with minimum-count rules, so noise never
    masquerades as signal.
36. As an admin, I want aggregate-only readouts, so no named user's browsing is
    ever exposed.
37. As the platform, I want impressions logged server-side at match time, so
    telemetry needs no client instrumentation and can't be spoofed.
38. As a logged-in user, I want /discover free and uncapped, so browsing costs
    me nothing and there is no BYO wiring anywhere.
39. As the platform, I want annotations on a platform-only gateway route, so a
    shared asset is never funded by a personal key.
40. As the platform, I want the night job idempotent and resumable, so a failed
    night is simply re-run.

## Implementation Decisions

- **Modules (all service-layer, house discipline):** a `github-discovery`
  client (app-owned read-only token, raw fetch, token-bucket pacing,
  exponential backoff on 429/5xx) behind a single new **GitHubReader** seam;
  a shelf-sync pipeline service (grid → dedupe → enrich + tag → score →
  annotate); a shelf match service (day job); picks + notes actions; MCP tool
  registration grows by one; worker schedules grow from four to six.
- **Schema — six new models, zero spine changes:** `Repo` (corpus row: GitHub
  identifiers, stars, language, topics raw, skills canonical, size, license,
  fork/archived flags, lane trust flags, score, shelf-eligible flag,
  default-branch sha, velocity fields, timestamps), `RepoListMembership`
  (repo ↔ curated list, lastSeenAt — the vouch counter), `RepoAnnotation`
  (repoId unique, sha, memorableWhy, modificationIdeas Json, learningPayoff,
  generatedAt), `ProjectPick` (user, repo, status considering|building|dropped,
  timestamps), `RecImpression` (user, repo, shownAt, clickedAt nullable),
  `Note` (user, source kind, title, content, optional skill link, timestamps —
  D39's first writer). **No new event types; event log, user_skills, and the
  recompute writer are untouched.**
- **Config rows:** `discover.archetypes` = one JSON array of
  `{key, name, titlePatterns[], topics[], languages[], enabled}` (the
  certs.providers list-row precedent); siblings for query cap, annotation
  top-N, scoring weights, anti-generic avoid-list, star band bounds, ingest
  window, prompt template.
- **Routing:** one new provider route row `repo_annotate`, PLATFORM-ONLY
  (shared-asset rule, bank-generation precedent), called with a 120-second
  timeout (bank/grade class); cheap-tier model named by the routing table.
- **Flag:** one `discover` feature flag gates page + both schedules + MCP tool;
  scheduled jobs check the flag at run time and no-op when off.
- **Tagging:** `resolveTagStrict` — a read-only variant of the shipped alias
  ladder that returns `unresolved` instead of creating candidate skills. Enrich
  accepts only resolved outcomes (canonical | alias | ≤1-typo auto-accept on
  ≥4-char tokens); existing-candidate and confirm-zone count as unresolved and
  increment the top-unmatched counter. The night job never writes to skills
  tables.
- **Scoring:** hard filters (alive, not fork, license present, solo-modifiability
  size ceiling) gate; config-row weights combine push recency, velocity
  percentile within band, tests/CI presence, README/docs, license soft dim
  (GPL not disqualified). Deterministic: same inputs, same order, always. The
  annotator decorates; it can never affect order.
- **Matching:** three signals (evidenced user_skills, claimed, target-role
  archetype tech via titlePatterns substring match), each card
  provenance-labeled; explicit user archetype picks (persisted) always beat
  inference; stretch badge = difficulty proxy (size + popularity + dependency
  count) one level above evidenced level, soft boost not a filter, hidden when
  no evidenced level exists; strengths default, "aim at my gaps" toggle
  persisted per user; already-imported repos excluded; empty spine falls back
  to global top-scored shelf + explainer CTA; live indexed query per visit —
  no precompute, no per-user caching.
- **Surfaces:** `/discover` in the authenticated route group — matched-5 up
  top, browsable shelf with lane/band/archetype filters; no anonymous access
  (the scanner family owns the attractor lane); free + uncapped.
- **MCP:** `get_rebuild_shortlist(archetype?)` — thin wrapper over the same
  match service the page calls, read-only, listed in the shipped MCP server's
  tools; SKILL.md gains a short shelf section.
- **Schedules:** weekly curated-list re-ingest + nightly full chain, both on
  pg-boss, both flag-checked at run time, both idempotent (re-runs are cheap by
  sha dedupe).

## Testing Decisions

- Good tests assert **external behavior at the service seam** (house standard):
  fixtures in, observable state out — never internals. Service-layer vitest
  against real Postgres, sequential files (one shared database).
- **Seams:** existing — service layer + real Postgres, gateway stub
  (quiz-bank / interview-bank pattern, asserts call counts), injectable clock
  (S1.5 pattern); new — exactly one, the GitHubReader interface at the HTTP
  boundary. The whole night pipeline is tested end-to-end below it with fixture
  responses.
- Pipeline tests must cover: determinism (identical fixtures → identical
  scores and order), idempotency (second full run writes no new rows and makes
  zero annotation calls), tagging purity (skill-table row counts unchanged —
  the grill's regression test), fork exclusion at both query and enrich,
  query-cap rotation, sha-unchanged skip, dead-repo flagging.
- Match-service tests: spine fixtures (evidenced/claimed/target combinations)
  → card sets with correct labels, stretch badges, exclusions, empty-spine
  fallback, toggle persistence.
- Annotation caching: same repo+sha → exactly one gateway call across repeated
  runs (stub call count asserted).
- Route smoke: /discover renders in the authenticated group; the MCP tool
  appears in the existing transport smoke.

## Out of Scope

- Contribution lane (issue-finding, merged-PR evidence) — parked for the S3b
  design chat, riding this corpus.
- Guided rebuild and pick→project promotion — S3b (the platform-guided trust
  tier opens there).
- JD-context matching ("recommend for THIS application") — later, flag-gated.
- Anonymous /discover access and any scanner-family merge.
- Note scheduling (FSRS), note review surfaces, pseudo-notes identity — S4.
- Archetype admin UI — archetypes are config rows edited via seed/console for
  now.
- Live per-user personalization of annotations — permanent non-goal; fit lines
  are deterministic interpolation only.

## Further Notes

- **Cost bounds (agreed in research §5):** seed ingestion + nightly upkeep
  $2–5 one-time + under $1/mo; annotations ≈ cents/night (top-N × one call);
  per-user marginal $0. DB growth ≈ 8 MB at 2k repos, ~40 MB at 10k — noise
  against the ~2 GB R2-tiering line; nothing here changes interview tiering.
- **Rate math:** search 30 req/min authenticated (pace at ~25), core 5,000/hr —
  a ~200-query grid plus a few hundred enrich calls runs in minutes per night.
- **Build-time verification (D26 pattern):** confirm the exact star-history
  endpoint path from GitHub's 2026-09 changelog before wiring velocity.
- Archetype seed set finalized in the grid ticket from the user's own target
  roles; avoid-list seeded from the user's flagship-hunt prompt.
- The Atria Dawn quota constraint (big calls throttle) does not bite this slice
  — annotations are small calls; route on the cheap tier regardless.

## Integration

- **Service layer + real Postgres:** every module is a service following the
  single-writer discipline; UI routes and MCP tools stay thin wrappers (one
  enforcement path).
- **Gateway (D2):** the ONLY AI spend in the slice is `repo_annotate` — one
  platform-only routing row, metered like every call; no other feature calls
  a model. Nothing user-facing generates AI at render time.
- **Event log / user_skills: untouched.** No new event types; browsing,
  picking, and note-saving are product data, never evidence. The D36 earned-bar
  cannot be farmed through this slice.
- **Skills module:** extended by `resolveTagStrict` only — additive, no change
  to the interactive ladder or the promotion queue.
- **Worker (pg-boss):** four existing schedules + `discover-lists` (weekly) +
  `discover-nightly` (nightly chain), registered alongside decay/briefing/drift
  crons; both flag-checked at run time.
- **Config store:** new discover.* rows seeded the same way as quiz/interview
  knobs; admin tuning follows the console pattern.
- **MCP server (S2):** the tools array grows to six; SKILL.md versioned bump;
  token auth identical to the five shipped tools.
- **Notes (D39):** S3a ships the minimal Note model and becomes its first
  writer; S4 builds scheduling and surfaces on it.
- **CONTEXT.md vocabulary:** shelf, lane, archetype, star band, annotation,
  flagship prompt, pick, stretch badge — use these terms in code and UI copy.
- **Trust teaching (D62):** card signal labels link to the existing
  how-levels-work page where evidenced vs claimed matters.
