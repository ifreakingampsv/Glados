# Prior art — OSS project recommender (input for the S3a design chat)

Researched 2026-10-25 (live GitHub Search API call made from this repo). Feeds the
S3a design chat; nothing here is a decision yet. Scope per user: (1) does anything
already do "find me a rebuildable flagship OSS project matched to my profile";
(2) how the awesome-list lane materializes; (3) how the GitHub Search lane cuts
noise; (4) two quality routes — curated/peer-reviewed vs niche recruiter-catching.

## 1. Landscape — nobody does our thing

### Issue-finders (contribution lane, not study/rebuild lane)

- Up For Grabs (up-for-grabs.net), goodfirstissue.dev, CodeTriage (daily issue
  emails), First Timers Only — all match open ISSUES to contributors. None rank by
  learning value or portfolio wow; none know your skills. Adopt: nothing core.
- OpenSauced (opensauced.pizza) — contribution analytics, highlights, list-based
  discovery. Adjacent; not portfolio-rebuild, not skills-matched.

### Curated idea lists (these are seed CORPUS, not competitors)

- codecrafters-io/build-your-own-x, practical-tutorials/project-based-learning,
  florinpop17/app-ideas, sindresorhus/awesome ecosystem + domain lists.
  README-table format is trivially parseable; churn is high; no spine, no levels.

### Guided-rebuild products (S3b lane, noted for context)

- CodeCrafters (build Redis/Git/SQLite from scratch, historically ~$39/mo):
  **paused new challenge development May 2026**
  (https://forum.codecrafters.io/t/were-pausing-new-challenges/16129); pricing page
  shows no prices as of Oct 2026 (https://prachub.com/resources/codecrafters-review-2026);
  a free clone appeared Jun 2026 ("Ship That Code",
  https://dev.to/shaongit/i-built-a-free-alternative-to-codecrafters-because-its-2026-and-im-done-paying-to-learn-5dn2).
  Signal: commercial guided-rebuild is wobbling; the niche is open. Not S3a scope.

### GitHub's own discovery

- `/trending` and `/explore` have **no official API** — confirmed by GitHub staff
  (https://github.com/orgs/community/discussions/161519). Unofficial scrapers exist
  (Apify, ScrapeCreators) — scraper ToS/fragility is the same logic that killed
  Telegram scraping in D14 → skip scraping v1. Star-band search (below) replaces
  trending's function for our purpose.
- **GitHub official MCP server** (https://github.com/github/github-mcp-server):
  toolsets include `search_repositories`, `search_code`, `get_file_contents`,
  issues/PRs. Matters for the dual-surface idea in §3 (D29/D56 precedent).

### Research prototypes

- "Personalized Project Recommendation on GitHub" (Springer 2018,
  https://link.springer.com/article/10.1007/s11432-017-9419-x), self-attention
  models on developer activity (https://dl.acm.org/doi/10.1145/3468920.3468936),
  link prediction on GitHub graphs (Semantic Scholar). All match on ACTIVITY
  HISTORY for contribution; none use skills/levels/evidence; none productized for
  job-seekers. Confirms white space; adopt nothing.

**Verdict: build, don't clone.** Closest adoptable pieces: curated lists (seed
corpus), GitHub Search + the new star-history API (discovery), the official MCP
server (harness surface). Matches the existing competitor note in DECISIONS.md.

## 2. Mechanics — how each route materializes

### Route A — curated lane (peer-review proxy)

- Awesome governance is real but weak: inclusion = a PR reviewed by list
  maintainers; lists must be manually curated and PR-open ~30 days
  (sindresorhus/awesome contributing.md); awesome-lint enforces format in CI
  (https://github.com/sindresorhus/awesome-lint); some lists set min-star floors.
  So "on a maintained list" = human-vouched, staleness varying by list.
- Materialization: seed = list-of-lists (awesome-* + build-your-own-x +
  project-based-learning + domain lists). Nightly/weekly job: fetch raw README →
  parse `- [name](url) — desc` rows → resolve owner/repo → hydrate via
  `GET /repos/{owner}/{repo}` (core API) → store one repo row with PROVENANCE:
  which lists contain it, cross-list count, each list's last push.
- Cross-list corroboration (on 2+ maintained lists) is the lane's trust signal —
  same shape as D78's source-type corroboration.

### Route B — hidden-gem lane (search-derived)

- **Live funnel, proven 2026-10-25:** `q=topic:rag` → 58,681 total, dominated by
  ★0–21 generic wrappers ("Dubai lead automation", "chat with PDF" clones).
  Adding `language:typescript stars:100..1500 pushed:>2026-04-01 archived:false`
  → **93 repos**, and the top of that pool is exactly the target class:
  IncarnaMind ★845 (NotebookLM-alternative, quote-grounded), MiniSearch ★602
  (self-hosted AI search, GPU-in-browser), stashbase ★1153 (local-first writing
  workspace), trace-mcp ★195 (framework-aware code intelligence MCP).
  Hard qualifiers cut 99.8% of noise BEFORE any scoring runs.
- Query grid: per target-role archetype (topic sets derived from spine skills +
  S1 JD-extracted tech), language = user's evidenced stack, star bands as
  separate pools: e.g. 50..300 (underrated), 300..1500 (solid), 1500..8000
  (established). Search API allows 30 auth'd req/min → a ~200-query nightly grid
  runs in ~7 minutes. (Unauthenticated = 10/min search, 60/hr core — NOT viable;
  the grid needs a platform read-only GitHub token.)
- Enrichment per candidate (core API, 5,000/hr): **official star-history
  endpoint (NEW, changelog 2026-09-04 — stars grouped by calendar weeks,
  newest-first, privacy-safe; the old stargazers-with-timestamps route was
  RESTRICTED July 2026, breaking star-history.com)** → velocity = stars/week
  percentile within band. Caveat: counts reflect stars still active today
  (unstars not retroactively tracked). Plus: tests/CI presence via file checks,
  README length, dependency manifests, license spdx (MIT/Apache per D16),
  open-issue ratio, contributors, archived/fork flags.
- Anti-generic gates (from the user's flagship-hunt prompt, see §3): negative
  keyword/topic filters — "chat-with-pdf", "template", "boilerplate", wrapper
  patterns, outsourced-backend detection (only deps = Supabase/Firebase/Clerk) —
  all deterministic, all config rows.
- Scoring: hard filters → deterministic weighted score (alive, velocity
  percentile, docs, tests, size ceiling for solo-modifiability, license) —
  **D30 discipline: the LLM never reorders.** The D17 "live LLM rerank of top-N"
  tension resolves as: LLM constructs ANNOTATIONS only (why-this-project blurb,
  memorability rating, modification-idea seeds) for the top-N after ranking;
  rank order stays deterministic. Cost: ~50 blurb calls/night ≈ cents (D4 cache
  by repo + default-branch sha).

## 3. The user's flagship-hunt prompt IS a third surface

The pasted "find me flagship rebuild repos" prompt is an agent deep-research
prompt: browse GitHub + web, apply anti-generic filters, score ~7 dimensions,
emit a structured brief (project / why memorable / technical depth / what you'd
learn / 3–5 modifications / portfolio ratings / limitations). Two readings, both
design-chat input:

1. **UX target**: the recommender's output artifact converges to exactly that
   brief shape — deterministic shortlist + AI-written brief per top pick.
2. **Harness surface (D29/D56 pattern)**: GLaDOS MCP returns the deterministic,
   spine-matched shortlist (precomputed, free); the user's OWN harness (their
   tokens) runs the deep-dive prompt against GitHub's official MCP server; the
   resulting brief flows back as a D39 note. Generation user-side, curation
   platform-side — identical split to D56's quiz packs. Cheapest way to give
   "find me THE flagship project" real depth without platform cost.

## 4. What S3a should take from all this (design-chat input, not decisions)

1. No competitor does spine-matched rebuildable-project recommendation — build.
   CodeCrafters' pause validates demand next door (S3b lane); don't chase it in S3a.
2. Both routes hydrate ONE repo table; lane = provenance + trust flags
   (cross-list corroboration vs band+velocity), not two UIs by default.
3. Ranking = deterministic config-row scoring; LLM constructs annotations for
   top-N only, never reorders (resolves D17 rerank vs D30).
4. Star velocity via the new official star-history endpoint (1 call/repo);
   old timestamp route is dead. No trending scraping (no official API, D14 logic).
5. Nightly grid needs a platform read-only GitHub token; rate math above.
6. Anti-generic gates as config rows, seeded from the user's avoid-list.
7. Flagship-hunt brief = natural output artifact; MCP shortlist feed = strong
   dual-surface candidate (D29/D86/D56 precedent) — decide surface scope at design.

## 5. Pre-design agreements (2026-10-25, research chat — carried into the design chat)

- **ECONOMICS SETTLED (user-agreed):** platform side = shared corpus only.
  Seed ≈ $2–5 one-time + under $1/mo upkeep; briefs written ONCE per repo, cached
  by repo+sha (D4); per-user marginal cost $0 (SQL match + render). Domain
  coverage = archetype CONFIG ROWS grown on demand (never a pre-built taxonomy).
  NEVER live per-user personalization of briefs — "why it fits you" is
  deterministic template text with the user's skill names interpolated. A
  platform-side deep dive (if ever built) = energy-bar gated (D84 pattern), not
  v1. Static recycled-list approach REJECTED: it saves ~$1/mo that was never the
  problem and destroys freshness/hidden-gem differentiation.
- **DB LOAD CHECKED (user concern, resolved with numbers):** shelf ≈ 8 MB at
  2k repos, ~40 MB at 10k — against the ~2 GB pressure line that interview
  transcripts drive (R2 tiering per D82 unchanged). Nightly writes = a few
  hundred upserts once per night (smaller than the existing decay sweep); day
  job = indexed SQL reads.
- **FLAGSHIP PROMPT SURFACE LOCKED (user-agreed):** every card gets a
  "deep-dive this in your AI" button that copies the user's flagship-hunt prompt
  PRE-FILLED (repo names + their skill context in the template slots) — paste
  into their own agent, their tokens, platform $0. Direct MCP feed = optional
  later.
- **MODULE SHAPE (whiteboard-level):** night job = seed ingester + discovery
  grid → dedupe (new/changed-sha only) → enricher (metadata, 1-call star
  history, tests/CI, README, license, size) → deterministic scorer (config-row
  weights, lane tags) → annotator (the ONLY AI layer; top-N new survivors);
  day job = spine → SQL match over the corpus → top-5 cards + template fit
  lines. Tables: `repos` corpus + `repo_list_memberships` + archetype config
  rows + annotations cache. Telemetry (shown/clicked) = analytics, NOT spine
  evidence — shape decided at the design chat.
- **TAGS DECIDED IN DIRECTION (user-agreed):** shelf repos get canonical
  `skills[]` at ENRICH time — GitHub topics + README keywords through the D24
  alias ladder (the same normalizer used for resume/JD text; D66
  projects.skills[] precedent). Required, not optional: the day-job match IS
  skill matching. Descriptive only in S3a — no points, no evidence, no spine
  writes from browsing/picking.
- **CONTRIBUTION LANE PARKED (user idea):** issue-finding + merged-PR evidence
  write-back (public verifiable artifact via the stored token) = candidate
  feature for the S3b design chat; rides S3a's corpus (issues API per repo +
  spine matching = cheap). Prior art: Up For Grabs / goodfirstissue.dev /
  CodeTriage = free volunteer tools, no revenue; OpenSauced = $3.5M seed May
  2024 (Boldstart + GitHub, platform now 100% free, no proven issue-matching
  monetization) → weak as a standalone, strong as a GLaDOS feature.
- **OPEN MINOR QUESTIONS for the design chat:** archetype seed set; scoring
  weights as config rows; cards per page / refresh cadence; does picking a
  project stub it into the user's projects list ("studying"); MCP door in v1 or
  later; telemetry shape.
