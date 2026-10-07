# S0 — Spine (spec)

> Source: `docs/DECISIONS.md` [D24]–[D38] (design confirmed + grilled 2026-10-07).
> Status: specced. Vocabulary: `CONTEXT.md`. Workflow: ROADMAP.md → slice workflow.
> Tickets: `.scratch/s0-spine/issues/` (via `/to-tickets`).

## Problem Statement

A job-prep ecosystem needs one shared per-user core — the **spine** — before any
feature slice can exist: identity, profile, evidenced skills, projects, target role,
preferences, and an append-only history. Today nothing exists (pre-code). Every day
without the spine, every feature (resume tailoring, interviews, OSS recommendations,
study mode) has nothing to read from or write to, and evidence that should compound
into trust-weighted skill levels is simply lost.

## Solution

Build the spine as a boring TypeScript monolith on Vercel + Neon Postgres, gated by a
waitlist, with every rule enforced in ONE service layer. Users sign up via Clerk,
redeem an invite code, and get a profile (JSON-Resume-compatible fields), projects
with evidence links, a target role, and a skills vocabulary that stays clean through
a canonical list + alias resolution. Every platform-verified action appends an
immutable **evidence event**; decayed, trust-weighted scores materialize into
**user_skills** as L0–L5 **evidenced levels**. The **gateway** — the only path by
which platform AI money is spent and trusted judgments enter the spine — ships now
with dual-credential support (BYO key auto-wins; explicit **platform fallback**
button on failure), metering, and energy-bar quotas, proven by an admin smoke probe
so S1 features land on working rails.

## User Stories

1. As a visitor, I want to sign up through Clerk, so that I have an identity without us storing passwords.
2. As a user, I want to sign in from any device, so that my spine is always reachable.
3. As a user, I want a local profile row created automatically on first sign-in, so that webhook lag never breaks the app.
4. As a user, I want account deletion in Clerk to cascade to my spine data, so that I am not retained without consent.
5. As a visitor, I want to leave my email on the landing page, so that I can join the waitlist.
6. As a waitlisted visitor, I want to redeem a single-use invite code, so that I can unlock full app access.
7. As a user without a redeemed invite, I want a clear waitlist gate instead of app features, so that I understand why I'm blocked.
8. As an admin, I want to generate invite codes and see redemption state, so that I can run the 50 → 500 → 5,000 ramp.
9. As a user, I want to edit my profile as a field dictionary (JSON-Resume-compatible), so that future features autofill from it.
10. As a user, I want to set a target role (title + seniority), so that recommendations and gap framing anchor to my goal.
11. As a user, I want exactly one primary target role at a time, so that "my dream job" is unambiguous.
12. As a user, I want simple key–value preferences, so that features can respect my choices as they ship.
13. As a user, I want typed skill tags to auto-resolve typos to the canonical skill, so that my profile stays clean without effort.
14. As a user, I want a confirm chip for ambiguous near-matches, so that "ts" never silently becomes "js".
15. As a user, I want short or unknown inputs to create (or join) a candidate skill, so that the vocabulary grows from real usage.
16. As a user, I want to claim a level for a skill, so that my self-assessment exists separately from evidence.
17. As a user, I want to create projects (description, links) as first-class entities, so that my work is groundable evidence.
18. As a user, I want events to reference projects, so that the future recruiter view can join descriptions × evidence.
19. As a user, I want every platform-verified action appended as an evidence event, so that my history is the source of truth.
20. As a user, I want to browse my event history, so that I can see what happened and when.
21. As a user, I want to see my evidenced level (L0–L5) per skill, so that I know where I stand.
22. As a user, I want evidenced levels to decay when I go quiet, so that the system stays honest — levels must go down.
23. As a user, I want levels recomputed nightly even without new events, so that my profile never lies.
24. As a user, I want backdated evidence allowed but never future-dated, so that decay math can't be gamed.
25. As an admin, I want a candidate-skill queue (approve / merge / reject), so that the canonical list grows curated.
26. As an admin, I want merge to leave an alias pointer so old event rows resolve read-time, so that no evidence is orphaned.
27. As an admin, I want reject blocked once a candidate has evidence, so that immutable history stays intact.
28. As an admin, I want a smoke probe that exercises resolver → adapter → metering, so that S1 lands on proven rails.
29. As a user, I want to paste my own provider key over HTTPS, so that heavy AI features run on my budget.
30. As a user, I want my key masked to the last 4 characters, so that it is never re-exposed in the UI.
31. As a user, when my key fails mid-call, I want an explicit button to run on the platform for 1 energy bar, so that nothing is spent without my consent.
32. As a user, I want queued jobs that hit a key failure to hard-fail with a one-click "retry on platform" notice, so that background work never silently spends.
33. As an admin, I want every gateway call to write a usage row (user, feature, model, tokens, cost), so that spend is attributable.
34. As a user, I want a daily energy grant with earned +1 bar/week for logging evidence, so that engagement is rewarded.
35. As a user, I want my energy bank capped at 3 bars, so that the allowance stays scarce and honest.
36. As a BYO user, I want to be exempt from energy draining (rate limits only), so that my own key costs me nothing extra.
37. As an admin, I want quota values, budgets, and points tables as config rows, so that each ramp stage rescales without a deploy.
38. As an admin, I want feature flags as DB rows checked in the service layer, so that AI features degrade gracefully.
39. As a user, I want to create a revocable API token (shown once), so that my coding agent can act for me.
40. As an agent, I want my writes recorded as agent_plugin/extension, so that my contributions are trust-weighted honestly.
41. As an admin, I want source derived from the auth channel (never client input), so that no token can pose as the web UI.

## Integration

- **S1** (imports + gap map + resume) reads `skills.parent`, `user_skills`, and
  `event_log`; creates `resume_blocks` + `job_descriptions` (deferred from S0 per
  [D37a]); the free scanner and JD extraction are the gateway's first production
  callers and the attractor caps' first consumers.
- **S2** (interviews) appends evidence events with grades; the MCP server ships
  alongside S2 as a thin wrapper over the same service layer + API tokens ([D29]).
- **Every** future AI call in any slice routes through the gateway; new providers are
  routing-table rows, not redesigns ([D26]).
- **Clerk organizations** are the standing candidate vehicle for campus mode ([D37b],
  [D15]); no cohort tables exist in S0.
- **D11** recruiter view later JOINs projects × event_log — the schema is ready.
- **D7 ramp** stages rescale D28 config rows only.

## Implementation Decisions

**Stack & shape** ([D8], [D31], [D32]): TypeScript/Next.js monolith (modular), Prisma
ORM, Postgres on Neon free tier via the pooled connection endpoint, pg-boss queue in
the same DB (drained by a Vercel Cron route as the S0 stopgap), Clerk auth, Vercel
Hobby hosting — ridden until ToS enforcement, learner's explicit risk acceptance
([D32]).

**Service-layer discipline** ([D21], [D29], [D35]): ALL business rules live in service
functions. UI routes, Clerk webhooks, the cron route, and (later) MCP tools are thin
wrappers. This is load-bearing, not style: it is the single enforcement path.

**Identity** ([D35]): Clerk is the identity source of truth. Webhooks
(user.created/updated/deleted) maintain a local `users` table whose id is the spine
FK; lazy row-creation on first use backstops webhook lag. `source` is DERIVED from
the auth channel — session cookie → `web`; API token → client may declare
`agent_plugin` or `extension`; server-internal → `system`; `web`/`system` are
unreachable from tokens. API tokens: per-user, SHA-256-hashed at rest, shown once at
creation, prefix-based lookup (GitHub-PAT pattern), revocable, full-user scope day
one.

**Skills vocabulary** ([D24], [D33]): curated canonical `skills` list (with a `parent`
column seeded now for [D27]) + `skill_aliases`. Write-time resolution ladder per typed
tag: normalize (lowercase, strip punctuation, ASCII-fold homoglyphs) → alias lookup →
fuzzy match against canonical names AND aliases AND existing candidates (edit distance
≤1 auto-accepts ONLY at normalized length ≥4; 2–3 → confirm chip; ≥4 → no match) →
no match creates/dedupes a candidate skill (one candidate per normalized string).
Candidates are promoted manually (admin queue: approve → canonical / merge → alias /
reject); reject is blocked once any event references the candidate; skills are never
hard-deleted; merge leaves `alias_of → target` so old event rows resolve read-time.

**Evidence & levels** ([D24], [D25], [D33]): append-only `event_log` — columns
`user_id`, `type` (fixed vocabulary), `skills[]` (skill IDs), `points` (signed),
`occurred_at`, `source`, `payload` (JSONB, display-only details). `occurred_at` is
clamped to ≤ now. Levels never live on events. Evidenced score = Σ base_points(type,
source) × 0.5^(age_days/90); base_points and the L0–L5 band thresholds are seeded
config rows. `user_skills` is the materialized cache (user, skill, score, level,
claimed_level — claimed never feeds score), rebuilt by ONE writer: on every event,
plus a nightly pg-boss decay sweep so quiet users' levels stay honest.

**Gateway** ([D2], [D26], [D34]): the only path for platform AI spend and trusted
judgments. Routing table is DATA (provider, model, endpoint, cost). Credentials:
platform key from env; BYO keys pasted once over HTTPS, encrypted server-side (KEK
from env, never in DB/code), stored as blobs, decrypted only in gateway memory, never
logged, masked to last 4 in UI. Launch adapters: Atria Dawn (platform route — verify
OpenAI-compatibility at build time), Google AI Studio, OpenRouter; OpenAI-compatible
shapes preferred. BYO auto-wins when the user has a key for the routed provider. BYO
failure mid-call: interactive calls surface the platform-fallback consent button
("costs 1 energy bar"); queued jobs hard-fail with a one-click retry-on-platform
notice. Silent fallback banned.

**Quotas & metering** ([D28], [D36], [D38]): attractor features = fixed daily caps
(config rows; values exercised from S1); heavy features = energy pool, 1 bar/day, bar
= $0.10 worst-case, +1 bar/week earned by ≥1 platform-verified evidence event in the
trailing 7 days, bank capped at 3; BYO users exempt (rate limits only). Metering: one
usage row per gateway call (user, feature, model, tokens, cost) + per-user daily
counters + energy balance, written in the SAME transaction as the call record; monthly
rollup planned. Platform budget $5/mo, alert at $4.

**Plumbing** ([D38]): `feature_flags` table + service-layer check (no SaaS provider);
waitlist = public email-capture table + single-use invite codes, Clerk signups stay
open, app middleware gates on redemption.

**S0 schema set** (nothing more): `users`, `profiles`, `target_roles`,
`preferences`, `skills`, `skill_aliases`, `candidates` (or status on skills — one
canonical-skills table with status is acceptable), `event_log`, `user_skills`,
`credentials`, `usage` (+ rollup), `daily_counters`, `energy` (or balance column),
`feature_flags`, `waitlist_emails`, `invite_codes`, `api_tokens`, pg-boss schema.
Explicitly NOT in S0: `resume_blocks`, `job_descriptions`, `cohorts`, gap-map tables
([D37]).

## Testing Decisions

- **A good test asserts external behavior through a seam, not internals**: given
  spine state + an action, assert the observable result (event rows appended,
  user_skills recomputed, quota consumed, gate enforced) — never private call graphs.
- **Seam 1 (primary — everything): the service layer.** Tests call service functions
  against a real Postgres (local pg or Neon branch) + real pg-boss (it is just
  Postgres). Clerk is faked at the boundary (session/token → user id), since Clerk
  itself is external. Webhook handlers tested via payload fixtures; token auth via
  the auth middleware boundary. This is the highest existing seam and should stay the
  only broad one.
- **Seam 2 (narrow): the gateway adapter boundary.** Contract tests with stubbed HTTP
  asserting OpenAI-compatible request/response shapes, decryption-in-memory-only,
  metering rows, BYO-precedence and fallback semantics. No real provider calls in CI.
- The nightly decay sweep is tested by invoking the same single-writer recompute the
  cron route calls — the cron wrapper itself gets no dedicated tests.
- Prior art: none (pre-code) — S0 establishes the test patterns (Vitest against the
  service layer is the default expectation; confirm framework choice in the first
  implementation chat).

## Out of Scope

- Gap map computation, JD extraction, imports (S1); resume blocks/variants ([D30]
  design deferred to S1); cohort tables ([D37b]); MCP server (S2, [D29]); weekly
  briefing (parked, [D37e]); e-portfolio/recruiter view (D11); gamification.
- Candidate auto-promotion logic (flag-gated path exists in design [D24]; the flag
  ships, the automation does not).
- Fine-grained token scopes, KEK rotation tooling, credential health tracking, and
  the per-user auto-fallback toggle (all parked).
- Any UI beyond spine basics (profile, projects, skills, event history, tokens,
  admin queues/probe).

## Further Notes

- The OQ7 rename checklist fires before any public step (domain purchase, marketing,
  store listing) — GLaDOS stays the internal codename until then.
- Known integration point: Prisma ↔ pg-boss shared-transaction enqueue ([D31]) —
  design the transaction-passing pattern in the first queue ticket.
- Atria Dawn API shape must be verified at build time ([D26]); if incompatible, the
  routing-table-rows design makes the swap cheap.
- Vercel Hobby cron granularity is daily — acceptable for the S0 nightly sweep; the
  D31 container-platform trigger stands for S1's real queue volume.
