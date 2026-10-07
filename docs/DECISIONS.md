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
  Cohort entity DEFERRED (grill 2026-10-07 → [D37]): Clerk organizations are the
  candidate vehicle if campus mode (D15) ever proceeds.
- **S1 — Imports + gap map + resume:** GitHub import, resume parse (extraction
  pipeline), JD extraction, gap map (query, not table) — diagnosis FREE and public,
  treatment behind account. Free resume scanner (SEO/distribution machine). Resume
  builder with locked content blocks. Paste-based LinkedIn review (lightweight).
- **S2 — Interview AI, text-only, startup mode.** Grounded in the user's own project
  decision records. Rubric scoring → reports → evidence written to spine. Eval harness
  - golden transcripts are part of the definition of done. STT voice _input_ may
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
- **[D24] Spine skill model (resolves OQ1, design chat 2026-10-06):** Skills are a curated
  canonical list (seeded with common engineering skills; grows via user input) + an alias
  table. Write-time resolution ladder per typed tag: normalize (lowercase, strip punctuation)
  → alias lookup → fuzzy match by edit distance (≤1 auto-accept; 2–3 confirm chip; ≥4 no
  match) → no match creates a candidate skill. Candidates are promoted MANUALLY at launch
  (admin queue: approve → canonical / merge → alias / reject); auto-promotion (fuzzy-distance
  guard + distinct-user threshold, same single-writer service) sits behind a feature flag for
  scale. Evidence → level: append-only events (user, type, skills[], signed points,
  occurred_at, source, JSON payload); evidenced score = Σ base_points(type, source —
  verifiable sources weigh more) × 0.5^(age_days/90); level = L0–L5 band lookup;
  user_skills = materialized cache rebuilt from the log by ONE writer (recompute on event,
  replay-safe); the user's self-rating is a separate claimed level, never in the score.
  Skill-extraction ladder: repo metadata + dependency files (free, deterministic) → user
  declaration → LLM only piggybacking on AI calls that exist anyway (resume parse, repo
  summarization), never solo per-tag calls.
- **[D25] Event log schema (resolves OQ2, design chat 2026-10-06):** Column-vs-payload rule —
  data the DB must filter/sort/search → real column; data only read after the row is loaded →
  payload JSON. `event_log` columns: who (user id — tenant-security wall), type (fixed
  vocabulary), skills[], points (signed), occurred_at (time filters: briefing window, decay,
  ordering), source (trust weighting + audits) — plus payload for display-only details
  (correct/total, question-bank version, transcript id, project_id reference). Levels NEVER
  live on events (rows immutable): score + level live only in the `user_skills` cache (user,
  skill, score, level, last_evidenced). Spine-wide division: mutable descriptive facts
  (profile fields, projects, claimed skills) = normal tables; history = append-only log.
  Recruiter/e-portfolio view = JOIN projects (descriptions) × event_log (evidence).
  user_skills answers "where do you stand" (interview/quiz adaptation, gap map, resume);
  event_log answers "what happened" (proof, briefing).
- **[D26] Credential resolver + BYO key storage (resolves OQ3, design chat 2026-10-06):**
  BYO keys: pasted once over HTTPS, encrypted server-side with a key-encryption key (KEK from
  env vars — never in DB or code), stored as blobs in a `credentials` table; decrypted ONLY in
  gateway memory per call; never logged; never returned to the client (UI masks to last 4
  chars). Accepted limit: protects against leaks, not a fully compromised app server.
  Platform key: env var (.env), spend-capped per D5. Launch adapters: Atria Dawn (platform
  route — unknown provider, verify OpenAI-compatibility at spec time; chosen on
  latency-over-generosity: a slow free tier frustrates more than a smaller one), Google AI
  Studio, OpenRouter; OpenAI-compatible adapter shapes preferred. Routing table is DATA
  (provider, model, endpoint, cost) — provider swaps and future self-hosted models (D19
  deferral stands) are row edits, not redesigns. Free-credit discovery stays in D14 (curate,
  don't scrape; never coupled to the resolver). Open spec detail: verify Atria Dawn API shape.
- **[D27] Gap map matching (resolves OQ4, design chat 2026-10-06):** First pass = rules +
  taxonomy + extraction-side normalization. JD extraction (S1 — existing LLM call, cached per
  D4) is instructed to output canonical skill ids: categories ("front-end skills" →
  `frontend`) and expansions ("full stack" → frontend + backend) resolved at extraction time.
  `skills` gains a parent column (react → frontend, postgresql → database; hand-curated for
  seed skills, grows via the same weekly skim as candidate promotion). Gap map computation =
  set difference over canonical ids (needed vs have), rolled up through parents, levels
  attached from `user_skills`. Free, instant, every output explainable. ARCHITECTURAL SEAM:
  embeddings may only ever improve set CONSTRUCTION, never the set COMPARISON (stays
  canonical-id difference). Embeddings parked until they can be measured — post-launch golden
  set from accumulated JDs; pgvector known viable (weekend-scale build; real costs are model
  lock-in, threshold tuning, and silent-failure evaluation).
- **[D28] Free-tier quotas (resolves OQ5, design chat 2026-10-06):** Two-tier shape.
  Attractor features = fixed daily caps (JD scan 5/day, resume scan 3/day — pennies each).
  Heavy variable features = daily "energy" pool, 1 bar/day at launch; a bar is denominated in
  WORST-CASE dollars (1 bar = 1 interview ≈ $0.10 ceiling on a DeepSeek-class model; guided
  rebuild = 2 bars when it ships). Earned replenishment capped at +1 bar/week (no farming).
  BYO-key users exempt from energy (their key, their money; rate limit only). Budget: $5/mo
  platform AI to start, hard alert at $4 (D5 tripwire); per-user caps stop one maniac, the
  budget alert stops the crowd. Quota values + budget are CONFIG ROWS, not code — rescaled at
  each D7 ramp stage (50 → 500 → 5,000). Platform route is sized on a cheap PAID model with
  the Atria Dawn free tier as bonus headroom; free-tier account cycling is banned (ToS
  evasion, and it would die mid-launch).
- **[D29] Delivery surfaces — one spine, multiple clients (design chat 2026-10-07):**
  Website = the hub and always-there floor: spine, gap map, resume builder, briefing,
  gamification, and light features. Heavy AI features are DUAL-SURFACE when each ships:
  plugin/MCP as the recommended path (generation runs on the user's own agent + subscription,
  e.g. Antigravity + Gemini Pro) and a website version behind D28 energy bars for
  non-IDE users. SPLIT: generation user-side (their tokens, unmetered by us), evaluation
  platform-side (our grader, our rubric — plugin-generated artifacts enter the spine as
  claim-grade input via `source: agent_plugin` and earn full evidence weight only after
  platform grading, or at minimum transcripts flow back for later re-grading).
  D2 AMENDED: the gateway is the only path by which (a) the platform spends money and
  (b) trusted judgments enter the spine — client-side generation in the user's harness is
  input, not verdict; it is not metered/cached/routed by us. MCP server is built alongside S2
  (when eval machinery exists and platform costs bite), thin over the service layer.
  S0 additions: API tokens for agent auth (cookie for browser, token for agents); `source`
  values reserved day one (web | agent_plugin | extension | system — text column validated in
  the service layer); service-layer discipline is load-bearing (all rules in service
  functions; UI routes and MCP tools are thin wrappers — D21 pattern). Plugin onboarding must
  be friction-free for tech-newcomers and TEACH agentic-coding skills as product value (a
  GLaDOS guide/skill walking users through setup); onboarding is itself a distribution
  machine. TypeScript end to end reaffirmed after challenge (D8 upheld — industry-default for
  this product shape; Python returns only as a future ML worker per D13/D19).
- **[D30] Resume blocks + variants (resolves OQ6, design chat 2026-10-07):** One
  `resume_blocks` table holds originals AND variants. Fields: id, user_id, kind (summary |
  experience | skill_group | education | custom), source_ref (FK → projects, nullable — some
  blocks reference no project), content, status (draft | locked — locked text is never
  silently rewritten), parent_id (FK → resume_blocks; null = original), from_jd (FK → job
  descriptions; null = original), timestamps. Provenance = parent_id + from_jd + event log
  (edits recorded as events — blocks are mutable facts, history lives in the log, per the D25
  division). Variant regeneration never loses the old content (recoverable via log).
  Selection = DETERMINISTIC JD BINDING: a variant is bound to a JD at creation (from_jd);
  renderer rule = prefer the variant matching the current JD, else the parent; manual
  override stored per application; NO AI at render time. Principle (now decided three times —
  gap map, promotion, blocks): AI participates in CONSTRUCTION, never in SELECTION.
  Renderer then applies the D20 fit budget ("fit or flag"). Multi-tenancy: shared tables +
  user_id scoping — FKs connect the graph, user_id isolates islands; per-user tables are an
  anti-pattern (schema migrations ×N, cross-user queries become N queries, FK graphs break).
- **[D31] S0 stack picks (design chat 2026-10-07, all four confirmed by learner):**
  **Auth = Clerk** — free ≤10k MAU covers the D7 ramp; a later switch is a TRIGGER-REVIEW
  (when pricing/limits pinch or org needs diverge), not a default plan — password hashes never
  export from Clerk, so migration means forced resets. Agent API tokens stay custom (D29).
  Use the installed `clerk-billing` skill for Clerk Billing/Stripe work.
  **Queue = pg-boss** — Postgres-only; the killer feature is atomic enqueue in the SAME
  transaction as event inserts (no dual-write/outbox complexity). Redis is PARKED with a
  trigger (hot-read saturation or a latency need a table lookup can't meet); caching itself
  lives in Postgres (D4 content keys + D17 precomputed tables). BullMQ was the D8 alternative.
  **ORM = Prisma** — chosen on review-ability: the learner reviews AI-written code, so
  guardrails + rigid patterns beat raw visibility; SQL learning happens via Prisma query
  logging + deliberate raw-SQL escape hatches (gap-map set operations). Spec note: pg-boss
  shared-transaction integration is a known integration point.
  **Hosting = Vercel free tier NOW** — S0 has near-zero queue volume; pg-boss drained by a
  Vercel Cron route as a stopgap. TRIGGER: S1's first real queue jobs → move web + worker to
  a container platform (Railway/Render); GitHub Student Pack credits (Heroku ~$13/mo × 12,
  DigitalOcean $200/yr, free .me domain via Namecheap) may cover it entirely — verify current
  offers at education.github.com/pack when the trigger fires. Migration is cheap: D1
  statelessness keeps the monolith portable.
  Cost principle (learner's rule, now standing): free alternatives unless dramatically better;
  committed spend = the D28 AI budget only.

## S0 grill outcomes (2026-10-07 — design challenged, fixes folded back)

- **[D32] DB host + hosting compliance (grill):** **Postgres host = Neon free tier** —
  completes D31, which never named where Postgres runs. Pooled connection endpoint for the
  Vercel serverless app (direct connections exhaust serverless limits); pg-boss lives in the
  same DB; branching gives preview deploys their own copy. Chosen over Supabase free (pauses
  projects after 7 days of inactivity — unacceptable for a live spine; Neon's scale-to-zero
  wakes in ~1s). Free caps (~0.5–1 GB, ~100 compute-hrs/mo — verify at signup) sized for the
  D7 ramp. HOSTING — learner's explicit call (2026-10-07), overriding the grill's proposed
  proactive commercial trigger: ride Vercel Hobby (non-commercial per ToS) until enforcement
  actually bites, then reassess (Pro or Student-Pack container). Risk consciously accepted;
  the D31 container trigger (S1's first real queue jobs) stands unchanged. Fact
  correction: Clerk's free tier now covers 50k MAU (D31's ≤10k understated headroom; pick
  stands).
- **[D33] Skill model amendments (D24/D25 amended):** (a) D24 fuzzy ladder AMENDED —
  auto-accept at distance ≤1 only when the normalized string is ≥4 chars; shorter tokens
  always get the confirm chip ("ts" → "js" is distance 1 and wrong). Normalization
  ASCII-folds homoglyphs. Fuzzy matching runs against canonical names AND aliases AND
  existing candidates; candidates dedupe by normalized string. (b) D25×D24 immutability
  contradiction RESOLVED — event_log.skills[] stores skill IDs; skills are never
  hard-deleted; REJECT allowed only while zero events reference the candidate (service-layer
  guard: once evidenced, merge is the only path); MERGE = alias created + old row marked
  alias_of → target, so old event rows resolve read-time and user_skills recompute always
  lands on canonical ids.
- **[D34] Gateway runtime semantics (D26 amended):** BYO keys auto-win when the routing
  table lands on a provider the user has a key for (D2 zero-marginal-cost; no per-feature
  opt-out day one). BYO failure mid-call (401/429/quota): NO silent fallback — interactive
  calls surface a consent button ("your key failed — run this on the platform instead, costs
  1 energy bar"); the fallback call goes through the gateway, metered and D28-capped like any
  platform call (and doubles as the warmest possible upsell moment). Queued/background jobs
  can't ask: they hard-fail and surface a one-click "retry on platform" notice. Per-user
  auto-fallback toggle parked.
- **[D35] Identity & access (D29 operationalized):** (a) `source` is DERIVED from the auth
  channel, never accepted from client input — session cookie → web; API token → client may
  declare agent_plugin or extension; server-internal → system; web/system unreachable from
  tokens (client-declared source would be spoofable and poison D24/D29 trust weighting).
  (b) Agent API tokens: per-user, SHA-256-hashed at rest, shown once at creation, prefix-based
  lookup (GitHub-PAT pattern), revocable, full-user scope day one. (c) Clerk is the identity
  source of truth; webhooks (user.created/updated/deleted) maintain a local users table whose
  id is the spine FK; lazy row-creation on first use as backstop for webhook lag.
- **[D36] Energy mechanics (D28 amended):** the "+1 bar/week earned replenishment" is earned
  by ≥1 platform-verified evidence event in the trailing 7 days (ties the reward to the core
  loop; event types are platform-defined so idle clicks can't farm it). Energy bank caps at
  3 bars — scarcity is what keeps BYO attractive; away ≥2 weeks and banked value decays by
  design.
- **[D37] S0 scope lines:** (a) resume_blocks table DEFERRED to S1 — from_jd FKs to
  job_descriptions, an S1 entity; D30 stands as the design seed. (b) Cohort tables DEFERRED;
  Clerk organizations are the candidate vehicle if campus mode (D15) proceeds — the S0
  bullet's cohort promise is superseded. (c) target_roles(user_id, title, seniority,
  is_primary, timestamps) with exactly one primary; preferences = typed key–value rows,
  semantics filled in by features as they ship. (d) AI gateway STAYS in S0 with an admin-only
  gateway smoke probe as its first caller (resolver → adapter → metering proven before S1
  depends on it). (e) Weekly briefing PARKED — owner slice assigned at the S1 design chat.
- **[D38] S0 component mechanisms:** (a) Feature flags = feature_flags table + service-layer
  check; no SaaS flag provider (cost principle, D6). (b) Waitlist = public email-capture
  table + single-use invite codes; Clerk signups stay open and app middleware gates on
  redemption (funnel stays ours; works for the future agent-token path too; spam signups
  neutralized by gating everything behind redemption). (c) Metering = the gateway writes one
  usage row per call (user, feature, model, tokens, cost) + per-user daily counters + energy
  balance, all in the same transaction as the call record (the D31 atomicity lesson); spec
  plans a monthly rollup for row growth.

## Feature additions (2026-10-07, implementation chat)

- **[D39] Dynamic learning notes / pseudo-notes (added by learner):** whatever a user
  learns anywhere in the product gets captured as notes in the format the user prefers —
  summaries, pseudo-notes, outlines — so it can be revised later. Already named for S4
  ("pseudo-notes identity"); now promoted to a cross-slice, spine-adjacent first-class
  entity: S4 study sessions (learning React → notes), S2 interview debriefs (weaknesses →
  notes), S3b OSS rebuild learnings, S1 tailoring insights all attach notes. Direction:
  a `notes` table (user, source slice/type, skill-or-topic link, title, content in
  user-chosen format, timestamps) — an ADDITIVE migration, so no S0 schema change is
  needed; note edits are mutable facts with history in the event log per the D25
  division (events only if briefing/e-portfolio needs them). FSRS scheduling of note
  review = S4. Manual capture first; auto-summarizing a learning session is an
  AI-CONSTRUCTION feature through the gateway (AI in construction, never selection —
  D30 principle). Detail is challengeable/expandable at the S4 design chat.

## Open questions for the VibeWise design chat (argue these first)

1. Spine schema details: skills alias table design; evidence → level computation.
   **RESOLVED 2026-10-06 → [D24].**
2. Event log payload shape (must serve gap map, weekly briefing, recruiter view,
   gamification later). **RESOLVED 2026-10-06 → [D25].**
3. Credential resolver UX: how BYO keys are stored (encrypted at rest), provider
   coverage at launch (Google AI Studio free tier? OpenRouter free models? Groq?).
   **RESOLVED 2026-10-06 → [D26].**
4. Gap map computation: rule-based first pass vs embedding-assisted matching.
   **RESOLVED 2026-10-06 → [D27].**
5. Free-tier quota numbers per user per day (ties to unit costs).
   **RESOLVED 2026-10-06 → [D28].**
6. Data model for locked resume blocks + derived variants + provenance.
   **RESOLVED 2026-10-07 → [D30].**
7. Public product name candidates + rename checklist.
   **DEFERRED by learner 2026-10-07** — GLaDOS stays as repo codename; TRIGGER: any public
   launch step (domain purchase, public marketing, store listing) requires the rename
   checklist first: DNS sweep (free), USPTO class check (free), socials, criteria review.
   Sound-alike variants (glasdos-style) REJECTED: phonetic/visual similarity increases C&D
   risk rather than reducing it. (Chiron held as a working candidate: mythological mentor of
   heroes, trained Achilles; chiron.tech likely registerable ~$30–50/yr; USPTO check pending.)

All S0 open questions are resolved. **Grill chat 2026-10-07** challenged D24–D31 and folded
fixes → [D32]–[D38]. S0 has no open design questions; next step: `/to-spec`.

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
