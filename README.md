# GLaDOS

A job-prep ecosystem web app, built slice-by-slice as a learning vehicle. One shared
per-user **spine** — profile, evidenced skills, projects, target role, preferences, and
an append-only event log — that every feature slice reads and writes.

> `GLaDOS` is an internal codename (Valve owns the Portal trademark). A rename checklist
> fires before any public launch step.

**Current status: [S0 — Spine] shipped** (2026-10-07). S1 (imports, public gap map, free
resume scanner) is next. Full plan: [`ROADMAP.md`](ROADMAP.md).

---

## What S0 (the spine) contains

- **Auth & gating** — Clerk sign-in (email + Google/GitHub), local user rows synced via
  webhooks with a lazy-creation backstop, waitlist email capture, single-use invite
  codes, and an app-wide gate that only redeemed (or admin) users pass.
- **Profile** — JSON-Resume-compatible field dictionary, target roles with exactly one
  primary, key–value preferences.
- **Projects** — first-class entities with tenant-isolated CRUD; the anchor the future
  recruiter view joins against evidence.
- **Skills** — curated canonical vocabulary + aliases + a write-time resolution ladder
  (normalize → alias → fuzzy match → candidate queue). Typos like `koltin` auto-resolve;
  ambiguous input (`reactjss`) gets a confirm chip; unknowns become candidates that an
  admin approves, merges (never deletes — old references resolve through alias
  pointers), or rejects.
- **Evidence & levels** — every platform-verified action appends an immutable event
  (typed, trust-weighted by source, clamped timestamps). `user_skills` is a
  materialized cache rebuilt by a single writer: score = Σ base_points ×
  0.5^(age_days/90), banded to levels L0–L5. A nightly pg-boss job decays quiet users'
  levels — levels go down when you go quiet.
- **AI gateway** — the only path by which the platform spends AI money. BYO provider
  keys (AES-256-GCM encrypted, masked to last 4) auto-win over the platform route; a
  failed BYO key surfaces an explicit consent button ("run on platform, costs 1 energy
  bar") — never silent spend. Every call is metered (usage row + daily counters +
  energy deduction in one transaction). Routing is data: providers are rows, not code.
- **Quotas** — attractor features get fixed daily caps; heavy features draw from an
  energy pool (1 bar/day, bank cap 3, +1 bar/week earned by real evidence activity,
  BYO users exempt). Budget alert tripwire on monthly platform spend.
- **Agent access** — revocable API tokens (hashed, shown once, prefix lookup) with the
  trust `source` derived from the auth channel, never client input.
- **Admin** — candidate-skill queue, feature flags, invite codes, gateway smoke probe,
  budget alerts.

## Architecture in one paragraph

A TypeScript/Next.js monolith (App Router) where **all business rules live in service
functions** (`src/services/`) — pages, server actions, webhooks, and cron routes are
thin wrappers over them. Postgres (Neon in prod, embedded-postgres binaries locally)
holds both mutable facts and the append-only event log; pg-boss queues in the same
database; Prisma is the ORM; Clerk owns identity; Vercel hosts. Tests drive the service
layer against a real Postgres — two seams total: services (everything) and the gateway
adapter boundary (stubbed HTTP).

## Getting started

```bash
npm install                # also generates the Prisma client
cp .env.example .env       # fill in: DATABASE_URL, GATEWAY_KEK, Clerk keys
npm run dev:db             # terminal 1 — local Postgres on :5433 (no Docker needed)
npm run db:push            # once — sync the schema
npm run db:seed            # once — 52 skills, config rows, provider routes
npm run dev                # terminal 2 — app on :3000 (logs tee to .next/dev.log)
```

Sign in, then make yourself admin: `npx prisma studio` → **User** → set `role` to
`ADMIN`. `npm run test:user` creates/repairs a dev-only test account (auto-verified in
Clerk development instances).

## Scripts

| Script                                      | What it does                                                    |
| ------------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                               | dev server on :3000, logs tee to `.next/dev.log`                |
| `npm run dev:db`                            | local Postgres on :5433 (embedded binaries, data in `.pgdata/`) |
| `npm test`                                  | 64 service-layer tests against a real Postgres on :5434         |
| `npm run check`                             | typecheck + lint + tests — the pre-commit gate                  |
| `npm run build`                             | production build (Vercel-ready)                                 |
| `npm run db:push` / `db:seed` / `test:user` | schema sync / vocabulary+config seed / test account             |

Commits run **lint-staged (prettier + eslint) → typecheck → tests** via Husky.

## Documentation map

| File                                                     | What it holds                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                 | Every decision, dated, with its [D#] — the WHY                       |
| [`ROADMAP.md`](ROADMAP.md)                               | Slice table, statuses, per-slice workflow                            |
| [`CONTEXT.md`](CONTEXT.md)                               | Domain glossary — the vocabulary the whole repo shares               |
| [`specs/s0-spine.md`](specs/s0-spine.md)                 | The S0 contract (problem, stories, decisions, testing, out-of-scope) |
| [`.scratch/s0-spine/issues/`](.scratch/s0-spine/issues/) | S0's 14 tracer-bullet tickets with acceptance criteria               |
| [`CODING_STANDARDS.md`](CODING_STANDARDS.md)             | Judgement-call rules reviewers enforce                               |

## Stack

Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL · pg-boss · Clerk · Vercel ·
Vitest. Chosen boring on purpose — see [D8]/[D31]/[D32] in `docs/DECISIONS.md`.
