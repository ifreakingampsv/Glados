# GLaDOS — Decision Record

> Status: pre-implementation (2026-10-05). This file is the single source of context
> carried from the planning discussions. The VibeWise design chat should treat every
> [D#] below as a prior decision to CHALLENGE, not to silently follow. Open questions
> are listed at the end — those are the ones to argue about first.
> Companion file: none yet. Specs will live in `specs/`, tickets in `.scratch/`.

## What GLaDOS is

A job-prep ecosystem web app. One shared "spine" (user profile: projects, evidenced
skills + levels, dream-job target, preferences) that every feature reads/writes.
Feature slices around it: resume builder + JD tailoring, project-grounded AI mock
interviews (startup vs big-tech modes), OSS project recommender + guided rebuild with
architecture comparison, study mode (active recall / spaced repetition), jobs tracker.
Codename GLaDOS (public name TBD — Valve trademark risk, D18).

## How it is being built

- Slice-by-slice, learner-first: VibeWise design chat (checkpoints) → `/grill-me` once
  → `/to-spec` → `/to-tickets` → implementation chats (VibeWise off / worktree).
- One design chat at a time; `.vibe-wise/` notes are per-project (worktrees excluded).
- `ROADMAP.md` tracks slices; this file tracks decisions.

## Locked architecture principles (from the scale/cost discussions)

- **[D1] Stateless app + external state.** Sessions in DB, files in object storage
  (S3-compatible). Nothing user-owned on app disk. Adding capacity = add an instance.
- **[D2] One AI gateway module** through which EVERY model call passes: metering
  (user/feature/model/tokens/dollars), model routing table, per-user quotas, caching,
  validation. **Dual credential support from day one:** credential resolver resolves
  per-request to either the USER's key (BYO-AI) or the PLATFORM's key. BYO = zero
  marginal cost; platform = capped free tier.
- **[D3] Queue all heavy AI work** (repo summarization, extraction, tailoring,
  offline interview grading) with a concurrency cap. Spikes degrade to slow, not
  expensive/down. Interactive interviews run live but still via gateway limits.
- **[D4] Cache expensive computations.** Keys: repo+commit (summarization), JD text
  hash (extraction), role+level+profile-version (question banks). Cost becomes
  one-time-per-content, not per-request.
- **[D5] Hard caps + alerts — COMPULSORY.** Monthly spend cap on AI provider,
  budget alerts on cloud + AI, per-user daily quotas. Applies to platform-key route;
  BYO route = user's own provider caps + our rate limiting.
- **[D6] Feature flags on every AI-heavy feature** for graceful degradation.
- **[D7] Waitlist from day one** — build the gating now: 50 → 500 → 5,000 ramp.
  Free tools (scanner, public gap map) may be open while accounts are gated.
- **[D8] What NOT to buy day one:** load balancers, Kubernetes, multi-region,
  uncapped autoscaling. Monolith-first (modular), boring stack (TypeScript/Next.js,
  Postgres, Redis/BullMQ or pg-boss, S3-compatible storage, Resend, Stripe later).

## Roadmap slices

- **S0 — Spine:** auth, profile, skills+aliases, projects (first-class entities with
  evidence links), target roles, preferences, event log (raw, append-only), AI gateway
  (with credential resolver), queue, feature flags, waitlist gating. Profile follows a
  field-dictionary / JSON-Resume-compatible shape (future autofill extension = renderer).
  Users carry an optional **cohort entity** (group with an owner) so a future campus
  mode (D15) is packaging, not retrofit.
- **S1 — Imports + gap map + resume:** GitHub import, resume parse (extraction
  pipeline), JD extraction, gap map (query, not table) — diagnosis FREE and public,
  treatment behind account. Free resume scanner (SEO/distribution machine). Resume
  builder with locked content blocks. Paste-based LinkedIn review (lightweight).
- **S2 — Interview AI, text-only, startup mode.** Grounded in the user's own project
  decision records. Rubric scoring → reports → evidence written to spine. Eval harness
  + golden transcripts are part of the definition of done. STT voice *input* may
  follow cheaply (Whisper); full voice interviewer = later (D14).
- **S3a — OSS recommender** (curated seed + GitHub API discovery, spine-matched).
- **S3b — OSS ingestion MVP** (summarize → learning path; guided rebuild +
  architecture comparison later). Heavy caching per repo+commit.
- **S4 — Study mode** (FSRS, pseudo-notes identity, interview-weakness scheduling).
- **S5 — Jobs tracker + alerts** (ToS-safe). Auto-apply/outreach = user-run tools (D12).
- Later/parking lot: recruiter lite (D11), campus B2B (D15), gamification,
  productivity suite, MCP server for external agents.

## Feature decisions from the planning discussions

- **[D9] Resume rewriter control:** content blocks support a **locked/verbatim** state
  (user-approved text is immutable; JD-specific variants are derived copies with
  provenance, original always preserved) + rephrase-on-demand per JD. Proposed, to
  confirm in design chat.
- **[D10] Exaggeration policy ("stretch mode"):** proposed middle path — (a) vocabulary
  mirroring (rephrase real skills in the JD's language — always on, honest), (b)
  user-marked "aspirational skills" that trigger a crash-course study plan so the claim
  becomes true, (c) hard line: never fabricate employers/dates/credentials. Final
  naming + degree of freedom = open question for design chat.
- **[D11] Recruiter view, staged:** (1) public shareable "verified e-portfolio" page
  (user-initiated), (2) recruiter lite browse for opted-in candidates post-launch,
  (3) CRM/messaging = much later. Event log raw shape in S0 enables all of it.
- **[D12] Job automation = user-run tools, not platform-run:** platform provides
  pipelines/extensions/MCP the user executes in their own browser/session (outreach
  assistant that extracts hiring-manager info + drafts templates; application runner
  the user approves step-by-step). V2. Legal posture: tool provider, not actor.
  Reference model (JobRight research, 2026-10): server-side auto-apply under user
  authorization is survivable commercially — ToS breaches are civil/contract matters
  whose penalty is account restriction, consent is pushed into the vendor's terms, and
  per-user "fast human" volume avoids bot-farm fingerprints. Their key legal move is
  TARGET CHOICE: company ATS forms (Greenhouse/Lever/Workday) where anti-automation
  ToS is silent, avoiding LinkedIn which actively litigates. GLaDOS can revisit this
  dial later with revenue; D12 stays user-run for risk, cost and brand-trust reasons.
- **[D13] Voice pipeline staging:** STT input early (open-source Whisper /
  faster-whisper self-hosted or cheap API — pennies/hour), full TTS interviewer later
  (cheap TTS = robotic; premium TTS = real cost; hard part is turn-taking latency, not
  raw cost). Text-first v1 stands.
- **[D14] Opportunity board:** hackathons + free-credit/student-pack aggregators.
  Sources: GitHub-hosted curated lists (deterministic, free), MLH public events API,
  community submissions + moderation, nightly sync via the queue. Match by spine
  (stack/domain/level) with rule-based filtering first. No Telegram scraping v1 (ToS +
  fragility); user-forwarding of channel posts is the workaround.
- **[D15] College B2B (Haveloc-style):** deferred. Different buyer (institution),
  sales-cycle-heavy, feature-dilution risk. Keep spine multi-tenant-friendly
  (cohort entity possible) so a "campus mode" can be packaged later after B2C proof.
- **[D16] OSS policy — adopt / learn / build:** adopt boring infra as libraries
  (FSRS, PDF gen, queue libs, Whisper); for differentiators, STUDY open-source
  architecture → write a 1-page architecture note into `docs/prior-art/` → build
  clean from scratch (license-aware: MIT/Apache free to learn/reuse, GPL contagious
  if copied). Do NOT paste large OSS codebases into agent context (pollution);
  distill to notes instead.
- **[D17] Project discovery beyond awesome lists:** primary = GitHub Search API
  (stars velocity, topics, recency, test/docs presence) + awesome lists as curated
  seed + HN/Algolia mentions. Nightly precompute into our DB; live LLM only for
  rerank of top-N. Instant latency, ~zero cost.
- **[D18] Public product name:** TBD before launch. GLaDOS stays as repo codename.
  Valve owns the Portal trademark; cheapest rename is before launch.
- **[D19] Fine-tuning posture:** NOT now. The moat is data + pipeline + evidence
  graph, not a custom model. S0 saves all transcripts/grades/corrections raw; fine-tune
  small models for bulk tasks (extraction) only when transcript volume justifies it;
  frontier models keep handling interviews.
- **[D20] Resume rendering constraints (companion to D9 locked blocks):** ONE template
  at launch, single column, standard headings, standard fonts, no tables/text-in-images
  (ATS-safe by construction). The builder enforces a live **fit budget** (~1 page of
  content; warn on overflow; locked blocks can never be silently shrunk — "fit or
  flag", user prioritizes). Deterministic rendering: HTML/CSS → headless-Chrome print
  → PDF. Built-in **self-lint**: run our own extraction pipeline on the generated PDF
  and score parseability (dogfood S1 extraction as QA).
- **[D21] Recruiter-side assets from Hirise (~/Code/CRM/...):** reuse PATTERNS, not
  the codebase. Hirise's best ideas transfer: per-request tenant-scoped agent context
  with deny-by-default fallback; agent write tools as thin wrappers over the same
  Server Actions the UI calls (ONE enforcement path — adopt this for gateway/event-log
  writes); AI-over-structured-records without a RAG pipeline. Sanity is NOT the spine
  (GLaDOS needs Postgres: relational evidence joins + high-write event log); Sanity is
  fine for editorial content only (e.g., opportunity-board copy). Clerk IS an
  acceptable auth provider for GLaDOS (orgs + seat billing useful for recruiter/cohort
  modes later) — decide Clerk vs Supabase Auth in S0. Integration with Hirise itself =
  link-level only: recruiters using Hirise can open a candidate's GLaDOS public
  e-portfolio URL. No code merge.
- **[D22] LinkedIn commit→post generator (S1/S2, small build):** nightly queued job
  converts the week's git activity + spine events into 2–3 draft LinkedIn posts,
  human-in-the-loop edit/approve, posting via LinkedIn's official share API. Grounded
  in real evidence (specific commits/decisions) to avoid AI-slop; 1–2 posts/week max.
  HARD GUARDRAIL: only public repos or user-flagged work — never private/employer code.
  Doubles as a distribution machine (every user post is authentic word-of-mouth).
- **[D23] Gig/part-time platform directory (S4+, curated not scraped):** structured
  catalog of data-annotation/freelance/tutoring/micro-internship platforms (pay ranges,
  assessments, payout mechanics, country availability) + user submissions and ratings.
  Seeds ~30–40 platforms manually; weekly freshness review; neutral, sourced pay data.
  Engagement feature, not revenue.

## Open questions for the VibeWise design chat (argue these first)

1. Spine schema details: skills alias table design; evidence → level computation.
2. Event log payload shape (must serve gap map, weekly briefing, recruiter view,
   gamification later).
3. Credential resolver UX: how BYO keys are stored (encrypted at rest), provider
   coverage at launch (Google AI Studio free tier? OpenRouter free models? Groq?).
4. Gap map computation: rule-based first pass vs embedding-assisted matching.
5. Free-tier quota numbers per user per day (ties to unit costs).
6. Data model for locked resume blocks + derived variants + provenance.
7. Public product name candidates + rename checklist.

## Research snapshots (2026-10)

- No competitor bundles project-grounded interviews or OSS rebuild comparison.
  Closest all-in-ones: Teal (~$19.6M raised, 4M+ users, free + $29/mo), Simplify
  (YC W21, free + $39.99/mo, extension moat), JobRight (2023, ~$4.5-7.7M, free +
  $30-40/mo, 2M+ users, recruiter-side pilot), Final Round AI ($6.88M seed 2025,
  ~$148/mo high-ARPU, real-time interview copilot), Careerflow (bootstrapped ~$5.6M
  rev, free + $24/mo, human coaching upsell). LinkedIn Premium $40-70/mo owns graph
  but no skill-building. Pathrise (ISA accelerator) wound down 2025 — service-first
  cautionary tale. Preplaced (India) = human-mentorship marketplace.
- Unit costs (ballparks): text interview $0.10-0.50; repo summary $0.10-0.50 once
  per commit; JD extraction ~$0.001-0.01; STT via cheap APIs ~$0.02-0.11/hour;
  premium TTS $0.10-0.30/min. Voice interview on cheap stack: $0.15-0.50/session.
- Distribution machines to build into S1: free resume scanner, public gap map,
  paste-based LinkedIn review. Daily habit hook: weekly progress briefing over the
  event log.
