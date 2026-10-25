# GLaDOS

A job-prep ecosystem web app, built slice-by-slice as a learning vehicle. One shared
per-user **spine** (profile, evidenced skills, projects, work experiences, target roles,
preferences, and an append-only event log) that every feature slice reads and writes.

> `GLaDOS` is an internal codename (Valve owns the Portal trademark). A rename checklist
> fires before any public launch step (`docs/DEPLOY.md`).

**Current status: [S0 — Spine], [S1 — Imports, Gap Map, Free Scanner & Resume Builder] & [S1.5 — Calibration Layer] shipped** (S1.5: built 2026-10-12, verified 2026-10-25). **S2 — Interview AI and S3a — OSS shelf/Discover: built, awaiting the hands-on walkthrough.** Next up: S3b (guided rebuild). Full plan: [`ROADMAP.md`](ROADMAP.md).

---

## What S3a adds on top of S2 (OSS shelf + Discover)

- **The shelf** — a shared, platform-built corpus of rebuildable OSS repos,
  collected nightly through two lanes: curated lists (build-your-own-x,
  project-based-learning) and an archetype-driven grid of hard-qualified
  GitHub searches (anti-generic gates kill wrapper clones before scoring).
- **Deterministic scoring** — config-row weights over recency, star velocity
  (within star band), tests/CI, docs, license; lane trust flags (cross-list
  vouch vs hidden-gem velocity). One AI layer only: per-repo annotations
  (why memorable, modification ideas, learning payoff), cached by repo+sha,
  never reordering anything.
- **Spine matching** — `/discover` shows your top-5 matched repos with honest
  provenance labels (evidenced / claimed / target-role fit), a stretch badge
  one level above your evidenced skills, a persisted "aim at my gaps" toggle,
  and an empty-spine fallback to the global shelf. Free + uncapped.
- **Flagship handoff** — every card copies your deep-dive prompt pre-filled
  (your AI, your tokens, platform $0); the brief pastes back as a note
  (D39's first writer).
- **Picks** — a study list (considering → building → dropped), never a
  project, never evidence; S3b's guided rebuild opens from here.
- **MCP** — `get_rebuild_shortlist`, the sixth read-only tool.
- **Night jobs** — `shelf_nightly` (grid → enrich → score → annotate) +
  `shelf_lists` (weekly), both idempotent and behind the single `discover`
  feature flag; telemetry readouts (CTR with minimums, top-unmatched topics)
  on the admin console.

---

## What S2 adds on top of S1.5 (Interview AI)

- **Project-grounded mock interviews** — a text-only startup-mode interviewer ("assumes it's vibe-coded until you prove otherwise") with **asymmetric grounding**: the interviewer sees only what a real one could hold (project surface, resume, JD — per scope), while the platform grader sees everything including optional ADR-lite **decision records** the interview itself drafts ("save the choices you defended"). Three scopes: **project** deep-dive, **portfolio** (≤3, rotating focus), **application** (resume + optional JD — the report doubles as a resume-claim audit).
- **Fixed-length sessions with bounded adaptivity** — quick 5 / deep 12, a cached ranked question bank (one generation per user+scope+content-version, D4), live delivery turns, follow-up pushes capped at 2 and required to _name_ the vagueness, pause/resume, 7-day auto-abandon, one flat energy bar per interview (+1 welcome bar at signup; BYO keys run free).
- **Rubric grading → spine evidence** — five anchored dimensions (1–4) + per-question 🟢🟡🔴 verdicts; one `interview_completed` event per probed skill, verdict-scaled (green full / amber half / red zero), the strongest shipped evidence tier, uncapable past the L3 corroboration ceiling; groundedness findings must cite real turn/record ids (hallucinated citations fail grading loudly). Tombstone deletion strips content and visibly drops levels.
- **Eval harness (definition of done)** — ten synthetic golden transcripts covering both scopes, both grading modes, and the edge behaviors; deterministic citation/validation asserts run in every `npm run check`; the paid LLM run (3× per fixture, cost-estimated before the button) auto-anchors unanimous bands, queues splits for human rank/band adjudication, and gates releases via the admin **grader-eval panel**; a weekly drift cron catches silent provider model swaps.
- **Weekly briefing** — an in-app **This Week** page (activity, both-direction level moves, dimension trends, energy state) plus a Monday email via Resend (no SDK — plain fetch): silent on empty weeks, a win-back email the week the energy bank starts decaying, one CTA from a deterministic ladder, and a single ≤200-token AI coach's note that wordsmiths the pre-computed numbers and never introduces a fact.
- **MCP server + agent skill** — five thin tools (`start_interview_session` ships the same cached bank, `submit_interview_transcript`, `get_interview_report`, `get_spine_snapshot`, `save_decision_record`) over token auth at `/api/mcp`; the user's own harness runs the conversation on their tokens; platform grading is free but daily-capped with deferral (over-cap transcripts grade next UTC day, never lost); **no tool writes evidence — ever**. Distribution: `skills/glados-interview/SKILL.md` (one-command setup, teaches what MCP is, includes the experimental harness-voice paragraph).
- **Reports, card, and voice posture** — report UI with verdicts, dimensions, coaching, and the decision-record debrief; a shareable **unbranded readiness card** (band + dimensions only, flag-gated); a one-tap voice-demand button feeding the un-bench trigger; STT input shipped as a **parked spike** (seam + exit memo at `docs/prior-art/stt-spike-memo.md` — no benched code, no Python sidecar); transcript **R2 tiering** with a storage readout and transparent read path.

## What S1.5 adds on top of S1

- **Honesty machinery in the evidence core** — the trust ladder's corroboration cap finally enforced: evidence from a single source bucket (repos, work experience, certificates, quizzes) clamps at **L3** until a second source type corroborates; plus the **narrow negative lane** — quiz retakes write signed-delta evidence (levels can fall), bounded so quiz credit alone can hit zero and can never eat repo/work-experience/certificate evidence.
- **Calibration quizzes** — per-skill MCQ banks generated lazily (all three bands at once, cached per version, grounded in each skill's definition), deterministic lint before live with an async admin spot-review queue, 6-question staircase sessions that settle a band in ≤18 questions, 7-day per-skill cooldown, free and uncapped takes; start band = the higher of claimed and evidenced level.
- **Course certificates** — allowlisted providers with public verify-URL patterns (Coursera, edX, DeepLearning.AI, Udacity, freeCodeCamp, Google/Meta career certs, and more), one cached fetch per submission with a soft name match (mismatch warns, never gates), user-confirmed course→skill mapping, optional PDF via the storage module; evidence decays from the issue date, off-list providers fall to plain claims with a quiz nudge.
- **Commit→post generator** — a stateless milestone gate: post drafting unlocks at ≥10 pushed user-authored commits since the last draft on a GitHub-linked project (computed live through the Clerk token, nothing stored); drafts are grounded in the actual commit range plus the cached LinkedIn-review advice; the user always edits, times, and posts themselves — no auto-posting anywhere.
- **Admin calibration console** — quiz telemetry (completion rate, drop-off question index, per-question success, retake frequency, time per question) rendered only above per-readout minimum samples; the evidence-vs-quiz divergence readout filled; a broken-question auto-flag (≥20 answers, <20% success) into the bank review queue; and the flag-gated what-if replay — change → replay → diff → apply, where apply is a guarded bulk rebuild outside the single-writer path.

## What S1 adds on top of S0

- **Container architecture & R2 Storage** — Two-service container setup (`web` + `worker` via `Dockerfile` and `railway.toml`) running `pg-boss` background queues and scheduled decay sweeps; Cloudflare R2 private bucket storage behind a zero-dependency AWS SigV4 service seam with short-lived signed download URLs.
- **GitHub connect & repo import** — Reads GitHub OAuth tokens via Clerk's backend API, preselects non-fork active repositories with an explicit fork explainer, extracts canonical skills deterministically from languages, topics, and dependency manifests (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`), and records `repo_imported` evidence (forks carry 0 points).
- **Resume & LinkedIn parsing, write-back, and diff-and-stage** — Extracts text from PDFs (`unpdf` / stream parser / `pdftotext` fallback) or pasted text, caches structured parses by content hash (D4), writes back skill claims, resume blocks, and structured `WorkExperience` rows scored deterministically by duration × specificity, and stages 4-way diffs (`same` / `updated` / `new` / `gone`) on re-upload with per-source staleness flags and evidence-wins protection.
- **Job descriptions, dual-mode Gap Map & explainable fit score** — Per-user `JobDescription` entities with canonical skill extraction and FIFO soft-cap pruning (20/user); Gap Map switches between **Resume Mode** (claims) and **Profile Mode** (evidenced levels + project bank matching) with parent rollup (`Next.js` satisfies `React`), mode memory, and a deterministic fit score formula (`evidenced 1.0`, `claim 0.5`).
- **Public Free Scanner (`/scanner`)** — Merged public attractor surface supporting anonymous scans (resume-mode, peppered IP daily cap, partial teaser showing fit % + top-3 gaps, 30-day TTL session claimable on signup) and signed-in free scans under fixed daily caps without energy bar deductions.
- **Resume Builder, Fit Budget & Self-Lint (`/resume`)** — Modular resume blocks (`draft` / `locked`) with lock guardrails, JD-bound variants (`parentId` + `fromJdId`), deterministic render-time block selection, a single ATS-safe template, two-rung fit budget (live overflow warning + stepped typographic shrink within config bounds), signed R2 PDF download, and dogfooded self-lint parseability scoring.
- **LinkedIn Profile Review (`/linkedin`)** — User-supplied LinkedIn PDF export or pasted text reviewed against target roles in one D4-cached gateway call (`add`, `post`, `visibility`), capped at 1/day, with URL scraping rejected by design.
- **Admin Economics & Evidence Readouts (`/admin`)** — Actual platform AI spend by feature/day, config-driven monthly projections from routing-table unit costs, break-even price floor per paid user, JD storage ramp watch, and evidence readouts (level distribution per skill, source mix, top movers, and S1.5 quiz divergence placeholder).

## What S0 (the spine) contains

- **Auth & gating** — Clerk sign-in (email + Google/GitHub), local user rows synced via
  webhooks with a lazy-creation backstop, waitlist email capture, single-use invite
  codes, and an app-wide gate that only redeemed (or admin) users pass.
- **Profile** — JSON-Resume-compatible field dictionary, target roles with exactly one
  primary, key–value preferences.
- **Projects** — first-class entities carrying canonical `skills[]` with tenant-isolated CRUD.
- **Skills** — curated canonical vocabulary + aliases + lazy-cached 1-line definitions + a write-time resolution ladder
  (normalize → alias → fuzzy match → candidate queue).
- **Evidence & levels** — every platform-verified action appends an immutable event
  (typed, trust-weighted by source, clamped timestamps). `user_skills` is a
  materialized cache rebuilt by a single writer: score = Σ base_points ×
  0.5^(age_days/90), banded to levels L0–L5.
- **AI gateway** — the only path by which the platform spends AI money. BYO provider
  keys (AES-256-GCM encrypted, masked to last 4) auto-win over the platform route; a
  failed BYO key surfaces an explicit consent button ("run on platform, costs 1 energy
  bar") — never silent spend.
- **Quotas** — attractor features get fixed daily caps; heavy features draw from an
  energy pool (1 bar/day, bank cap 3, +1 bar/week earned by real evidence activity,
  BYO users exempt). Budget alert tripwire on monthly platform spend.
- **Agent access** — revocable API tokens (hashed, shown once, prefix lookup) with the
  trust `source` derived from the auth channel, never client input.

## Architecture in one paragraph

A TypeScript/Next.js monolith (App Router) where **all business rules live in service
functions** (`src/services/`) — pages, server actions, webhooks, and worker handlers are
thin wrappers over them. Postgres (Neon in prod, embedded-postgres binaries locally)
holds both mutable facts and the append-only event log; `pg-boss` runs queues and cron
jobs in the same database; Cloudflare R2 stores private PDFs; Prisma is the ORM; Clerk
owns identity; Railway/Render hosts the `web` and `worker` containers. Tests drive the
service layer against a real Postgres across three narrow seams: services, the gateway
adapter boundary (stubbed HTTP), and the R2 storage adapter boundary (in-memory S3 fake).

## Getting started

```bash
npm install                # also generates the Prisma client
cp .env.example .env       # fill in: DATABASE_URL, GATEWAY_KEK, IP_HASH_PEPPER, R2_*, Clerk keys
npm run dev:db             # terminal 1 — local Postgres on :5433 (no Docker needed)
npm run db:push            # once — sync the schema
npm run db:seed            # once — canonical skills, config rows, provider routes
npm run dev                # terminal 2 — web app on :3000 (logs tee to .next/dev.log)
npm run worker             # terminal 3 (optional) — pg-boss worker process
```

## Scripts

| Script                                      | What it does                                                    |
| ------------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                               | dev server on :3000, logs tee to `.next/dev.log`                |
| `npm run worker`                            | starts the `pg-boss` background worker (`scripts/worker.ts`)    |
| `npm run dev:db`                            | local Postgres on :5433 (embedded binaries, data in `.pgdata/`) |
| `npm test`                                  | 52 service-layer test suites (228 tests) against Postgres :5434 |
| `npm run check`                             | typecheck + lint + tests — the pre-commit gate                  |
| `npm run build`                             | production Next.js build                                        |
| `npm run db:push` / `db:seed` / `test:user` | schema sync / vocabulary+config seed / test account             |

Commits run **lint-staged (prettier + eslint) → typecheck → tests** via Husky.

## Documentation map

| File                                                                                     | What it holds                                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                                                 | Every decision, dated, with its [D#] — the WHY                        |
| [`ROADMAP.md`](ROADMAP.md)                                                               | Slice table, statuses, per-slice workflow                             |
| [`CONTEXT.md`](CONTEXT.md)                                                               | Domain glossary — the vocabulary the whole repo shares                |
| [`specs/s0-spine.md`](specs/s0-spine.md)                                                 | The S0 contract                                                       |
| [`specs/s1-imports-gapmap-resume.md`](specs/s1-imports-gapmap-resume.md)                 | The S1 contract                                                       |
| [`.scratch/s1-imports-gapmap-resume/issues/`](.scratch/s1-imports-gapmap-resume/issues/) | S1's 16 tracer-bullet tickets with acceptance criteria                |
| [`docs/DEPLOY.md`](docs/DEPLOY.md)                                                       | Container deploy guide (`web` + `worker`) & OQ7 rename gate checklist |
| [`CODING_STANDARDS.md`](CODING_STANDARDS.md)                                             | Judgement-call rules reviewers enforce                                |

## Stack

Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL · pg-boss · Cloudflare R2 ·
Clerk · Railway/Render · Vitest.
