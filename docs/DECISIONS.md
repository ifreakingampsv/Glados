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

## S1 design chat (started 2026-10-07)

- **[D40] LinkedIn commit→post triggers (D22 amended, learner):** posting is ALWAYS
  user-triggered. The nightly cron (a scheduled job that runs with no human involved)
  becomes an OPTIONAL draft-preparer, not a poster. Primary path = an on-demand "draft a
  post" action that unlocks when the user marks a project milestone ("sizable portion
  done" — exact milestone signal defined at spec time; likely an event_log type + project
  status, deterministic and user-owned rather than AI-inferred). D22's guardrails stand:
  public repos / user-flagged work only, grounded in real commits, LinkedIn official share
  API, 1–2 posts/week max. AI constructs the draft; the user selects, edits, times, and
  posts it (D30 principle).
- **[D41] Skill calibration quizzes (upgrades the 2026-10-06 per-skill-quiz note from
  "S4 reinforcement" to calibration-first, learner):** deterministic, low-token quizzing
  that establishes a user's real level per skill up front. Per-skill question banks
  generated ONCE per skill through the gateway, cached, reused across all users
  (amortized cost — no per-user LLM calls). v1 = multiple-choice, graded deterministically
  (zero per-answer tokens); results write event_log evidence with a low-trust-weight quiz
  source (existing rule stands) and feed the level bands that S2 interviews, S3 project
  recommendations, and S4 study adapt to. Free-text "explain how it works" interview-style
  mode is staged LATER (self-assessed against a model answer, or LLM-graded once S2's
  eval harness exists — never LLM-graded inside S1). PLACEMENT DECIDED 2026-10-07 (learner
  delegated the call): v1 ships in S1 — a cheap first real client of the S0 spine (writes
  evidence events, recomputes user_skills, needs no queue or hosting migration).
- **[D42] Gap map fit score (learner, 2026-10-07):** the gap map gains a deterministic fit
  percentage (simplified.jobs-style "how good a fit is this JD"), DERIVED from the D27 set
  difference + user_skills levels — earned ÷ required with partial credit by level; exact
  formula fixed at spec time. No AI at score time (D30 principle); the number always drills
  through to the explainable gap list (D27 explainability preserved). One honest number,
  not ten — no fake precision.
- **[D43] Admin economics dashboard (learner, 2026-10-07; S1 ticket):** admin-only page
  tracking free-tier economics from day one: (a) ACTUALS — spend by feature/day from the
  D38c usage rows; (b) PROJECTIONS — config-driven assumptions (scans/user/day × users ×
  unit cost; unit costs read from the D26 routing table); (c) fixed server costs as config
  rows; (d) break-even view — the price floor per paid user covering fixed + projected AI
  cost at a target margin. Quota/budget tuning happens through the existing D28 config rows.
  v0 = three honest numbers on one page; no gold-plating.
- **[D44] Rendering engine re-evaluated (learner request, 2026-10-07):** D20 re-argued and
  STANDS: HTML/CSS → headless Chrome. Research confirms it is the industry-default path for
  web resume builders (Reactive Resume exports exactly this way; its #1 self-host pain is
  headless-Chrome container config — a known integration point, not a blocker). LaTeX
  rejected (TeX Live footprint, seconds-long compiles, TeX-injection risk when templating
  user content, a whole new language = poor learning transfer). Typst noted as the modern
  challenger (fast single binary, browser-side compilation possible) — revisit only if
  D20's ceiling provably pinches. react-pdf rejected for the main path (separate layout
  code from the preview, manual pagination, lower design ceiling). AMENDMENT to D20: adopt
  a battle-tested print-CSS template as the starting point (D16 prior-art note) rather
  than designing typography from scratch.
- **[D45] GitHub import auth (research + learner-delegated technical pick, 2026-10-07):**
  no custom OAuth dance — the user connects GitHub as a Clerk external account and the
  server reads the token via getUserOauthAccessToken(userId, "github") (server-side only).
  Request minimal scopes (read public repos + commits) at spec time; token expiry/refresh
  is a known OAuth rough edge (integration point). PAT import stays a flag-gated fallback
  for private repos / power users later.
- **Research snapshot (2026-10-07, S1 tools):** (1) LinkedIn member posting via the
  official API is SELF-SERVE — "Share on LinkedIn" product + w_member_social scope, no
  partner approval; only organization-page posting is partner-gated (not needed) → D22/D40
  posting path confirmed feasible. (2) GitHub REST API directly supports the evidence-weight
  mitigations below: repo objects carry a fork boolean; list-commits supports author
  filtering; search/commits CANNOT exclude forks (use per-repo listing); 5,000 req/hr with a
  token → octokit-plugin-throttling/retry is standard. (3) PDF text extraction: pdf-parse
  (simplest), pdfjs-dist (low-level, Next.js bundling friction), unpdf (PDF.js-based,
  serverless-friendly, maintained) — lean unpdf, final pick at spec. (4) Hosting trigger
  context: Railway free ≈ $5 trial + $1/mo credit; Render free tier = web only with cold
  starts, background workers are PAID — the D31 container move means a small paid instance
  (~$5/mo class) either way; verify Student Pack coverage when the trigger fires (D31 stands).

- **[D47] Evidence tuning console (learner, 2026-10-07; PROPOSED — challengeable):** the
  D43 admin surface grows a second tab for tuning the evidence/level pipeline, because
  point weights and decay knobs need observation, not vibes. Method: **change → replay →
  diff → apply** — weights live as config rows; the what-if replay re-runs the D24
  computation over the real event log (user_skills is already a materialized cache rebuilt
  from the log by one writer, so recompute is a known, already-built operation) and shows
  the resulting level diff BEFORE applying. Readouts v1 (S1, cheap): level distribution per
  skill (flat = uninformative), source-mix breakdown, evidence-vs-quiz divergence (the
  population-level AI-built-repo signal), top movers. What-if replay ships behind a flag
  once real traffic exists (meaningless at 5 users); tuning sessions happen at each D7
  ramp stage (50 → 500 → 5,000).
- **[D48] Resume auto-fit ladder (learner request, 2026-10-07; PROPOSED — challengeable;
  D20 amendment):** "must fit one page" is handled by an escalation ladder, never silent AI
  restructuring: (1) D20's fit-or-flag warning; (2) deterministic typographic shrink —
  font/leading/margins as CSS variables stepped down within professional bounds
  (~11pt → 10pt, margins toward 0.5in); (3) if still over, deterministic trim suggestions
  ranked by lowest evidence weight × age × least JD relevance — the user approves each;
  nothing is ever removed or rewritten silently. OSS builders (Reactive Resume, OpenResume)
  stop at manual size controls because content priority is user-specific and blind
  automated cutting looks bad; the ladder keeps every cut user-owned.

- **[D46] Evidence trust ladder (learner-adjusted, 2026-10-07):** resolves the AI-built/
  cloned-repo concern. Deterministic rules:
  (1) Forks/clones → zero weight (GitHub fork flag). (2) Only commits authored by the
  user's GitHub identity count. (3) Project evidence has PROVENANCE TIERS: platform-guided
  builds (S3b — the platform watched the work happen) > imported GitHub repos (verifiable
  existence) > resume/profile claims (take with a grain of salt). Quizzes weigh BELOW
  project evidence but are the corroboration currency. (4) PAIRING RULE: imported/claimed
  project skills get corroborated by quiz results; repo content is NOT mined for skill
  depth (inferring beginner-vs-advanced TypeScript from a repo is expensive and tags don't
  encode it) — the repo proves exposure, the quiz measures understanding. (5) CAP:
  imported/claimed evidence alone cannot exceed a mid band (L3) until a second source type
  corroborates (quiz or platform). (6) Wrong quiz answers write NEGATIVE signed evidence —
  levels can fall (D24 signed points stand). (7) Exact point values = config rows, tuned
  via the D47 console at each ramp stage; no lie-detection heuristics in v1; S2 interviews
  re-grade claims as the backstop.
- **[D49] UI pass timing (learner, 2026-10-07):** first ticket of S1 — polish lands right
  before the free scanner (the first public surface), one slice, no context switch.
- **[D50] Weekly briefing owner (resolves D37e, learner, 2026-10-07):** S2 — richest
  inputs (interviews, projects, events) make the briefing genuinely useful; ROADMAP S2 row
  updated.
- **[D51] "Public" gap map (resolves the ROADMAP ambiguity, learner, 2026-10-07):** merged
  with the free scanner as ONE attractor surface — paste a JD (+ resume) → fit % (D42) +
  explainable gap list. No-auth visitors see a teaser; full detail behind the waitlist
  gate (D7). This is what "public" means in the ROADMAP row.
- **[D52] "LinkedIn review" scope (agent proposal, 2026-10-07 — challengeable):** dropped
  as a separate feature. LinkedIn's exported profile PDF flows through the existing resume
  parser as just another import path (data import, not review); D40's commit→post
  generator is the S1 LinkedIn feature. If a true "review my LinkedIn" feature is wanted
  later, it returns as a design-chat item.

Open questions for the S1 design chat (argue these first — added 2026-10-07 after the
learner correctly flagged that S1 never got the OQ treatment S0 had):
OQ8. Gap map "have" side — does a claimed (unevidenced) skill count as "have" in the
set difference, and what does the fit score do with claims? (Learner raised: a
claimed skill must not silently erase a real gap.)
OQ9. Resume parse write-back — what does an uploaded PDF create (resume_blocks?
claimed skills?), and how do re-uploads and duplicates behave?
OQ10. GitHub import scope & cadence — all repos vs user-selected; re-import timing
(nightly vs on-demand); S1 = public repos only?
OQ11. Quiz bank design — seed authoring, questions per skill, difficulty tracks
(beginner/advanced — feeds the D46 depth problem), retake/farming rules.
OQ12. Cost treatment of S1 features — what's free (quiz taking, PDF rendering =
compute not AI), what draws energy, and how D28 caps apply to the merged
scanner surface.
OQ13. Job-description entity + privacy — where pasted JDs live, retention, per-user
limits, and what the no-auth teaser (D51) sees and stores.
OQ14. Teaching the trust model in-product — where the UI explains claimed vs
evidenced so users know why quizzes/projects make results accurate
(learner requirement).
Status (updated 2026-10-08): OQ8 RESOLVED → [D54]. OQ9 RESOLVED → [D55] (additions
confirmed by learner 2026-10-08) + [D56] (job/internship experience) + [D57]
(certificates). OQ10 RESOLVED → [D58]. Quiz v1 delivery surface = WEBSITE (learner
pick 2026-10-08; plugin/skill-library route stays available later via S2 MCP).
Adaptive direction agreed: tiered banks + deterministic staircase + generation-time
difficulty/sub-topic tags in S1; observed-success calibration + weak-concept loops =
S4 study mode; LLM runtime controller rejected; embeddings layer unnecessary
(canonical taxonomy replaces it). RESOLVED 2026-10-08: OQ12 → [D60], OQ13 → [D61],
OQ14 → [D62]. **S1 OQ LIST CLOSED — all of OQ8–OQ14 resolved into [D54]–[D62]; the
S1 design chat is COMPLETE (2026-10-08).** Spec-time items: milestone mechanics
(D40), profile-strength threshold (D54), provider allowlist seed (D57), band
boundaries + cap values (D59/D60/D61 config rows), unpdf-vs-pdf-parse pick,
LinkedIn "Save to PDF" guide copy (D53). D47/D48 were resolved by the 2026-10-08 grill → [D68]/[D69]. **GRILL
COMPLETE → [D63]–[D73]** (all 11 recommendations accepted). Spec:
specs/s1-imports-gapmap-resume.md. NEXT: /to-tickets → implementation chats
(VibeWise paused). Prior-art plan unchanged (spec time, outside the repo).

- **[D53] LinkedIn profile review (learner, 2026-10-08; supersedes D52):** the feature
  EXISTS, two intended surfaces. (a) USER SIDE (S1 candidate): the user supplies their
  LinkedIn profile via LinkedIn's official data-export PDF, which the S1 resume parser
  already ingests; GLaDOS then reviews how attractive the profile is to recruiters hiring
  for the user's target roles — what to add, what to post (feeds D40 drafts), visibility
  advice. One gateway call over data already parsed; cached per D4. (b) RECRUITER SIDE
  (parked): "paste a candidate's LinkedIn URL + JD → match score" is D11 recruiter-view
  territory (staged, opt-in candidates post-launch). HARD CONSTRAINT (D22/D12 posture):
  LinkedIn actively litigates scraping — fetching arbitrary profiles by URL is off the
  table for a tool provider; the compliant path is user-owned export + upload. Goal
  alignment: minimal-friction guidance for people new to the job scene.
- **[D54] Gap map modes (resolves OQ8, learner design, 2026-10-08):** the gap map runs in
  two modes behind an explicit toggle. RESUME MODE (default; new + no-auth users): the
  have-set comes from the parsed resume's claims — a new user gets a real, useful gap map
  instead of an empty one. PROFILE MODE ("use your confirmed profile"): the have-set
  merges evidenced skill levels with the user's project bank — projects match the JD
  deterministically via their skill lists (S0 projects carry skills[]), so the map can
  surface a relevant TypeScript project even when the uploaded resume lists only Python
  work. The toggle carries adjacent explainer text: resume-mode results reflect CLAIMS,
  not verified skill — build your profile, take quizzes, add projects for
  ecosystem-accurate results (the OQ14 teaching surface). Resolves the trust dilemma both
  ways: claims never impersonate evidence, new users never see claims count as zero.
  AGENT-PROPOSED ADDITIONS — CONFIRMED by learner 2026-10-08: merge rule = evidence
  always wins, claims fill only skills with zero evidence; every skill in the result
  labeled by provenance (evidenced/claimed); fit score = the same D42 formula over
  whichever have-set the mode produces; toggle guard = new users with no profile see
  resume mode only (no dead switch). MODE MEMORY (learner): the chosen mode persists
  per user across sessions; once the profile is strong (threshold fixed at spec time),
  profile mode becomes the default automatically; a manual switch to resume mode always
  wins and also persists until changed.
- **[D55] Resume parse write-back (resolves OQ9 core, learner, 2026-10-08):** TWO CASES.
  (1) No profile yet: an uploaded resume feeds the gap map/scanner transiently (D54
  resume mode) and persists NOTHING — no skills, no blocks, no profile row. (2) Profile
  creation: the parsed resume seeds the spine — skills enter as CLAIMS (unconfirmed),
  content enters the D30 blocks table, and the UI offers validation paths: quizzes
  (S1, D41) and interviews (S2). Unvalidated claims stay visible but are excluded from
  every evidence-based surface — recruiter filters like "TypeScript L3+" query evidenced
  user_skills only (D24: claims never in score). RE-UPLOAD: agent-proposed diff-and-stage,
  below. AGENT-PROPOSED ADDITIONS (pending learner confirm): (a) diff-and-stage
  re-upload — deterministic per-item diff (same / updated / new / gone), user accepts a
  staged changeset, nothing writes until accepted; old content preserved via the event
  log (D30) and the stored PDF (S3); skills already evidenced are untouched (D46);
  claims absent from the newest upload get a stale flag, never auto-deleted; conflict
  resolution is the evidence-wins rule — no similarity-based or quiz-based merge logic
  needed. (b) Resumes never auto-create project entities — experience lands as blocks;
  a one-click "promote to project" adds it to the project bank (which D54 profile mode
  matches against), keeping the bank user-curated. (c) UNIFIED ERAS: instead of a
  removable early "manual override button" for skill levels, self-set levels are a
  PERMANENT self-assessment tier in the claim track (D24's claimed level, now
  user-settable): displayed "self-assessed, L?", fills zero-evidence holes in profile
  mode, never enters the evidenced score in any era. Incentive to verify grows as
  evidence-reading surfaces ship (recruiter view, e-portfolio, S2 grading) — nothing is
  ever taken away, so the early audience is never alienated and no data ever needs
  reclassifying.
- **[D56] Job + internship experience as evidence (learner, 2026-10-08):** parsed work
  experience becomes a structured `work_experiences` entity (employer, title, period,
  kind: job|internship, description, skills[]) that FEEDS SKILL EVIDENCE — one year
  building a product in TypeScript/Next.js earns real points, scaled by DURATION ×
  SPECIFICITY of what the resume describes (vague bullet < named stack + described work).
  Ladder position (amends D46 tiers): platform-guided (S3b) > imported repos > JOB
  experience > INTERNSHIP experience (same mechanism, lower base weight) > bare skill
  claims. Honest framing kept: job experience is still self-reported — a structured
  claim, not an artifact — so the D46 corroboration cap (L3 without a second source)
  and quiz pairing apply unchanged. Corroboration paths: targeted quiz questions from
  the claimed skill's bank (S1), deeper interview-style probing (S2 machinery).
  QUIZ DELIVERY SURFACES (learner wants both kept separate; choose later on economics):
  (a) website quiz (banks generated once per skill through the gateway, cached — taking
  is free, grading deterministic); (b) SKILL LIBRARY / PLUGIN route per D29's dual-surface
  pattern — quiz packs as a GLaDOS skill/library the user's own harness (Antigravity,
  Gemini) generates/runs on THEIR tokens, results flow back for platform-side grading
  (generation user-side, evaluation platform-side; MCP return path ships with S2's
  server). S0 BACKTRACK: none required — new event type + base_points rows + the
  work_experiences table are additive migrations (D39 precedent); resume_blocks
  experience-kind references the entity via source_ref (D30 amendment: source_ref may
  FK to work_experiences as well as projects).
- **[D57] Course certificates as evidence (learner, 2026-10-08):** upload path for
  certificates from reputable providers (Educative, deeplearning.ai, Coursera, etc.).
  VALIDATION IS SMALL AND SHIPPABLE IN v1: provider ALLOWLIST (config rows, seeded with
  ~10 majors) + per-provider VERIFICATION-URL pattern + existence check — Coursera-class
  certificates carry public verify URLs made for sharing, so this is a fetch of a public
  page, not scraping; name-mismatch on the verify page is a soft warning, never a gate
  (nicknames/romanization are legit). Unverified upload or off-list provider = plain
  claim tier. Ladder placement (amends D46/D56): platform-guided > verified certificate
  ≈ imported repo (externally anchored but individually weak) > job experience >
  internship > bare claim; corroboration cap applies unchanged. STALENESS NEEDS NO NEW
  MECHANISM: occurred_at = cert issue date, so D24's 90-day half-life automatically
  decays a two-year-old cert toward zero — "certified it long ago, forgot it" is handled
  by the existing math. QUIZ CORROBORATION = optional one-line nudge ("verify with a
  5-question check to strengthen this skill"), NEVER forced — the cap bounds cheat
  damage already and a forced quiz wall would wreck the UX. Course→skills mapping is one
  cached gateway call per course (D4 — every user taking "Frontend Web Developer" career
  path reuses one mapping). S0 backtrack: none (new event type + config rows, additive).
- **[D58] GitHub import scope & cadence (resolves OQ10, learner design + delegated
  refinements, 2026-10-08):** HYBRID SCOPE — the connect screen lists every repo with
  checkboxes; "import all" shortcut AND per-repo selection both available. SMART
  PRESELECTION (agent refinement): non-fork repos with real signal (user-authored
  commits, recent push, README/description) start CHECKED, sorted by activity; forks
  start UNCHECKED (D46 gives them zero weight anyway) with one explainer line — "only
  include repos you can talk about in depth, not minor-change forks" — guidance, not a
  gate. CAP: initial import capped (~25 repos, config row) to bound API/queue cost;
  "import more" on demand. CADENCE: ON-DEMAND "Sync now" per user in S1 — deliberately
  DEFERS the D31 container-hosting trigger (no nightly background sync until the queue
  exists for S2 work anyway); scheduled refresh can ship later behind a flag. PUBLIC
  repos only in S1 per D45; private-repo import = later, flag-gated, bigger permission
  ask.
- **[D59] Quiz bank design v1 (resolves OQ11, agent-seeded at learner's request, all
  values CONFIG ROWS for D47 tuning, 2026-10-08):** 3 bands/skill (L0–2, L3–4, L5–6),
  ~24 questions per band generated once (batched gateway call, grounded in the canonical
  skill definition), staircase session = 6 questions per round (≥5 correct steps up,
  ≤2 steps down, else settle; typical 6–12 questions, hard cap 18, ~5–10 min). RETAKES:
  7-day cooldown + SIGNED-DELTA events — each quiz writes points = new − previous
  result, so append-only stands (D25), the latest state reflects best recent
  performance, deltas cancel and grinding banks nothing; negative evidence is bounded
  by the quiz's own positive magnitude. QA: deterministic lint (dedupe, one correct
  option, tags present) + admin-queue spot review before a bank goes live. Tuning
  method (learner): initial numbers now, D47 console + user interviews (learner first,
  then the D7 50-user friend cohort) adjust later. D47 AMENDED: quiz telemetry readouts
  added — completion rate, drop-off question index, per-question success rate, retake
  frequency, time per question.
- **[D60] Free-tier surface ladder (resolves OQ12, learner + agent refinements,
  2026-10-08):** the funnel is a cost ladder. (1) ANONYMOUS teaser (D51): tight IP-based
  daily cap (~2 scans/day, config row; IP stored HASHED, never raw) + PARTIAL results —
  fit % and top-3 gaps visible, full gap list + evidence detail behind account creation;
  known soft edge accepted: shared NAT (campus/office) can trip the cap for several
  humans — tune via config, don't engineer around in v1. CTA reconciles with D7 waitlist
  gating: "join the waitlist" (D38b email capture) or "redeem invite" — never a bare
  signup promise at ramp stage 1. (2) FREE ACCOUNT: full results, D28 fixed daily caps
  unchanged (scanner 3/day, JD scan 5/day). (3) No energy bars anywhere in the
  scanner/gap-map family (all fixed-cap attractors); LinkedIn profile review (D53) =
  free, 1/day cap (one cached gateway call — rare and cheap). Anonymous gap map is
  resume-mode only by definition (no profile exists).
- **[D61] Job-description persistence (resolves OQ13, agent recommendation over learner's
  ephemeral sketch, 2026-10-08):** `job_descriptions` = per-user rows, NO auto-expiry —
  the learner's 1-day/wipe-on-application idea was honestly argued and REJECTED because
  auto-wipe breaks the iterate loop (paste JD Monday → refine resume Wednesday → re-scan
  Friday: the JD must still be there) and expiry states create support noise; soft cap
  ~20 JDs per user with FIFO prune of oldest (config row) handles storage growth instead;
  user can delete any JD manually; "application done" archiving is an S5 jobs-tracker
  lifecycle concept (S5 adds status to JDs, not S1). ANONYMOUS teaser data (the pasted
  JD + its result) stored in a TTL side table (~30 days, config) keyed by anonymous
  session cookie and CLAIMED into the account on signup — the learner's carry-over idea,
  accepted: your teaser work follows you into your profile, and persistence becomes a
  quiet account incentive. Storage math: JDs are ~2–6 KB text — trivial at D7 ramp
  (50 users ≈ 6 MB); at the 5k-user stage ~600 MB would bite Neon's free tier, so the
  D43 dashboard watches JD storage at each ramp.
- **[D62] Teaching the trust model in-product (resolves OQ14, learner confirmed,
  2026-10-08):** BOTH placement layers. (a) Contextual micro-teaching at every
  provenance surface — one-line tooltips on claimed/evidenced chips, the D54
  mode-toggle explainer, quiz nudges after certificates, each written for the exact
  moment of curiosity, never a wall of text. (b) One central "How levels work" page —
  the honest ladder (claims → corroboration → evidence → levels), rendered with the
  USER'S OWN profile as the worked example, ending on the action that sharpens results
  (verify more). Every label and nudge links there; the page is the destination the
  existing UI references, not new machinery.

## S1 grill outcomes (2026-10-08 — D40–D62 challenged; all 11 recommendations accepted)

`/grill-with-docs` grounded in a code fact-sweep of the S0 spine. Four code-vs-design
catches: Project carries NO skills (D54 assumed it does); Skill has no definition field
(D59 assumed one); D59's "L5–6" band cannot exist (shipped levels.bands = L0–L5); the
decay cron route shipped with NO scheduler anywhere (decay never actually ran). All
fixed below. Learner accepted every recommendation ("all as recommended", 2026-10-08).

- **[D63] S1 slice split (grill):** the design chat ~tripled S1 and it must also absorb
  storage + the container move. SPLIT: S1 = infra (R2, container) + UI pass + imports
  (GitHub; resume/LinkedIn parse; work experiences) + gap map + free scanner + JD
  entity + resume builder + D43 economics + D53 LinkedIn review. S1.5 (new ROADMAP
  row) = the calibration layer: quizzes (D41/D59), certificates (D57), tuning console
  - what-if replay + quiz telemetry (D47), commit→post generator (D40). Rationale: the
    attractor surfaces don't depend on the calibration layer; claims stay claim-labeled
    until S1.5 lands (D54 resume mode needs no quizzes). ROADMAP updated.
- **[D64] Object storage = Cloudflare R2 (grill — the S0-style gap):** S0 shipped with
  zero storage (no SDK, env, or code) and S1 must persist uploaded PDFs (resume
  re-uploads for diff history per D55, LinkedIn exports, later certificates). Pick:
  R2 — S3-compatible API (D1's promise held), ~10 GB free tier fits the D7 ramp, zero
  egress fees, private bucket + short-lived signed URLs. File IO goes ONLY through a
  thin storage module in the service layer (the gateway pattern: one path, testable
  seam), never public buckets.
- **[D65] Container hosting = early S1 ticket + decay cron fix (grill):** the D31
  trigger genuinely fires at S1 build start (first real queue jobs: imports, parse,
  render; headless Chrome needs a container per D44). Web + worker move to Railway
  (preferred: native worker services + cron; Render fallback) — Student Pack credits
  expected to cover the ~$5/mo class; provider verified at build. CORRECTION: the S0
  decay route shipped unscheduled (no cron config existed) — decay becomes a pg-boss
  SCHEDULED job on the worker (in-DB, atomic), HTTP route kept as a manual backstop.
  Neon and Clerk unchanged.
- **[D66] Project skills column (grill, code catch):** D54 profile mode matches
  projects "via their skill lists" — which don't exist (Project = title/description/
  links only). Per D25's rule (filterable → real column): `skills String[]` on
  projects (mirrors event_log.skills), backfilled from project_added events, editable
  in the S1 project UI. Column = mutable fact; event log = history.
- **[D67] GitHub import depth (grill):** metadata + deterministic skill extraction
  ONLY (repo metadata, dependency files, README/activity signals, fork flag) — NO LLM
  repo summarization in S1 (its consumer is S3b; D46: repos prove exposure, quizzes
  measure depth). Import CREATES project entities directly (a repo is a verifiable
  artifact — contrast D55b, where resume claims never auto-create projects). Forks
  import with zero-weight evidence if explicitly selected. Commit listing defers to
  S1.5's D40 (fetched on demand at draft time via the stored token).
- **[D68] Evidence tuning console CONFIRMED, split along D63 (grill resolves
  PROPOSED):** evidence readouts (level distribution per skill, source mix,
  evidence-vs-quiz divergence, top movers) ship IN S1 as a panel on the D43 admin
  dashboard (cheap aggregates over existing tables). Quiz telemetry (D59 readouts) +
  the what-if replay (change → replay → diff → apply) ship in S1.5's console; replay
  stays flag-gated until real traffic. "APPLY" = guarded maintenance job (bulk
  user_skills rebuild, decay-sweep pattern) — explicitly OUTSIDE the per-event
  single-writer path, never a service-layer write.
- **[D69] Auto-fit ladder CONFIRMED, trimmed (grill resolves PROPOSED):** v1 ships
  ladder steps 1–2 only: D20's fit-or-flag warning + deterministic typographic shrink
  (font/leading/margins as CSS variables stepped within professional bounds — bounds
  are config rows). Step 3 (evidence-weighted trim suggestions) DEFERRED until real
  resumes overflow — its blocks→source_ref→evidence ranking is machinery for an
  unobserved problem. Locked blocks (D9) are excluded from trim suggestions in any era.
- **[D70] Quiz bank mechanics (D59 amended by grill):** (a) skills gain a definition
  field — generated ONCE per skill through the gateway, cached (D4); reused by gap-map
  explainers. (b) Banks generate LAZILY: the first take on a skill/band enqueues a
  bank-generation job; cached thereafter (key: skill + band + bank version); admin
  "generate now" button for demos/QA. (c) BANDS RE-MAPPED to the shipped levels.bands
  (L0–L5; D59's "L5–6" was impossible): L0–1 / L2–3 / L4–5. (d) Leaf skills only —
  parent categories get no banks in v1 (rollups aren't takeable skills).
- **[D71] Work-experience evidence mechanics (D56 fixed by grill):** (a) specificity =
  DETERMINISTIC heuristics v1 (named-stack mentions × description depth; parameters =
  config rows) — not LLM-scored, so D55 re-parses can't silently re-emit different
  evidence and every score is auditable; LLM scoring may return later if it misfires.
  (b) Decay stays UNIFORM (D24): occurred_at = attestation/confirmation time (when
  imported/verified), points scaled by duration × specificity; re-confirmation (a
  user action) appends a refresh event. Deliberate contrast with D57: certs decay
  from issue date (knowledge goes stale); experience decays from attestation (the
  experience is still yours — re-confirming keeps it fresh, honestly).
- **[D72] Diff-and-stage scope (D55a refined by grill):** PER-SOURCE diff — each
  import path (resume file, LinkedIn export) diffs against content previously
  imported from that same source; claims/blocks carry an origin marker; stale flags
  are per-source even though the claim pool is global (a skill absent from the new
  resume but present in the LinkedIn export does not go stale). Staged changesets
  persist in a staging table — "review your import" survives sessions and is
  auditable; accept applies transactionally with evidence-wins conflicts (D55a
  otherwise unchanged).
- **[D73] Mode-memory priority (D54 edge fixed by grill):** an explicit manual mode
  choice ALWAYS beats the strength-threshold auto-flip; the auto-flip sets the default
  only for users who never explicitly chose. The toggle shows the current effective
  mode; the "manual switch always wins and persists" promise holds across sessions.

## S1.5 design chat (2026-10-11 — the four S1 spec-time leftovers argued; spec same session)

- **[D74] Commit→post milestone mechanics (D40 resolved; learner direction, details
  delegated, 2026-10-11):** milestone = a DERIVED, STATELESS gate — the learner
  REJECTED the explicit button ("users can just self-claim things"). Eligibility for
  "draft a post" on a GitHub-linked project = count of USER-AUTHORED commits (D46
  rule 2) on the linked repo since the last `post_drafted` event for that project
  (or since repo import when none) ≥ `posts.minCommitsPerMilestone` (config row,
  default 10, tuned in the admin console — learner will tune). NO milestone event
  type, NO per-project status column: the audit trail is its own "since" anchor;
  eligibility is computed live at check time through the existing live Clerk-token
  fetch pattern (D67; nothing stored). SIGNAL = PUSHED commits only — local commits
  are invisible until pushed (the D46 verifiability boundary; from the user's view
  nothing changes: commit locally, push, the work counts). Non-GitHub projects
  (manual, promoted-from-experience) get NO post-unlock in v1 — the feature is
  GitHub-grounded by construction (D22). UNIT: raw user-authored commit count —
  cheapest verifiable unit, no per-commit stats calls, the same fetch the draft
  generator needs anyway; issues/PRs-closed ("tickets") penalize students who don't
  use issue trackers and add API surface (parked as an alternative config signal);
  user-declared phases reintroduce self-claim (rejected). Sizing tradeoff recorded:
  5 = every weekend's churn; 25+ = months between unlocks (feature feels dead);
  10 ≈ several focused sessions. ONE dial + the D22 weekly cap (1–2 posts/week,
  enforced at draft action) bounds output. Posting/drafting stays ALWAYS
  user-triggered (D40); evidence writes stay automatic with no user toggle
  (learner: progress doesn't need user-side flexibility).
- **[D75] Certificate allowlist seed + shape (D57 resolved; learner agreed with the
  argued direction, 2026-10-11):** VERIFIABLE-ONLY — allowlist rows exist only for
  providers with public verify-URL patterns; trusted-but-unverifiable providers
  (AWS, Microsoft, LinkedIn Learning) fall to the plain-CLAIM tier, no badge, no
  elevated weight (removes the paste-any-PDF cheat surface; the ladder slot's
  "externally anchored" meaning survives). Submission shape for allowlisted rows:
  provider + verify URL REQUIRED, cert PDF optional (stored via the storage module,
  private bucket). Verification = one fetch of the public page (cached per URL),
  200 + name-on-page soft match (mismatch = warning, never gate). Course→skill
  mapping = one cached gateway call per course (D4); the user CONFIRMS the mapped
  skills at submission (construction/selection split). Issue date from the verify
  page when present, user-entered otherwise (decay-critical, D57). Seed list
  (agent-delegated; CURRENT URL shapes verified at build): Coursera, edX,
  DeepLearning.AI (Coursera-hosted), Udacity, freeCodeCamp, Google/Meta career
  certificates (Coursera-hosted), DataCamp, Codecademy, Educative, HackerRank,
  MongoDB University. Config row: `certs.providers`.
- **[D76] Signed-delta retake mechanics (D59 spec-time edges resolved; learner
  agreed, 2026-10-11):** (a) CLAMP FIX — `appendEvent` gains ONE narrow permission:
  `quiz_completed` may carry negative points; every other event type keeps the ≥0
  seatbelt. The bound is computed in the QUIZ SERVICE (the door stays dumb, policy
  lives with the feature that owns it): delta ≥ −(current DECAYED quiz-source
  contribution to that user+skill's score) — quiz credit floors at zero in
  `user_skills`, never goes negative, never eats repo/work-exp/cert evidence.
  (Decayed floor chosen over raw-sum floor: raw would let the decayed quiz
  contribution render negative while the raw sum stays ≥0.) (b) COOLDOWN — per
  SKILL (not per band), rolling 7 days from a COMPLETED session's end; the
  staircase already traverses bands inside one session, so per-band granularity
  only preserves the band-hopping dodge. Abandoned sessions (< half the first
  round answered) write NOTHING and don't consume the cooldown. (c) DECAY-0-DELTA
  EDGE — ACCEPTED, no refresh mechanism: a same-level retake writes delta 0 and
  old quiz events keep decaying (staleness is the honest core; refresh-by-retake
  = farming; decay-relative deltas break the sum-of-deltas-equals-latest
  auditability). `quiz_completed` payload records settled band + per-band
  correct/total (feeds the D68 divergence readout).
- **[D77] Quiz telemetry thresholds (D47/D59 readout gates resolved; learner
  agreed, 2026-10-11):** data shape = `quiz_sessions` + `quiz_answers` tables
  (per-question outcomes + durations; durations are client-clock TELEMETRY, never
  evidence). Rule shape = PER-READOUT MINIMUMS as config rows (flat gate and
  show-with-caveats rejected — one N can't serve different noise floors, and
  caveat-laden dashboards train admins to ignore them): per-question success
  ≥ ~20 answers per question; completion ≥ ~10 sessions per bank; drop-off index
  ≥ ~20 sessions; time per question ≥ ~50 answers; retake frequency on a 30-day
  window; divergence panel only for skills with ≥3 users holding BOTH evidence
  and quiz data. ONE alert: a question with ≥20 answers and <20% success
  auto-flags into the bank spot-review queue (D59 QA); everything else
  display-only, consumed at D47 tuning sessions per ramp stage. Telemetry panels
  are AGGREGATE-ONLY (no named users).

**S1.5 OQ LIST CLOSED** — all four S1 spec-time items resolved into [D74]–[D77]
(2026-10-11). PIPELINE CORRECTION (learner, same day): a spec draft was written
before /grill-with-docs ran — standing rule 3 requires design → grill → spec.
The draft was parked and the grill then ran in THIS chat (2026-10-11).

- **[D78] S1.5 grill outcomes (7/7 recommendations accepted by learner,
  2026-10-11):** (a) CODE CATCH — the D46(5) corroboration cap was never shipped:
  `recomputeUserSkill` sums all events with no source-aware cap, so repo-only
  users could already exceed L3. ENFORCED in S1.5 inside the single-writer
  recompute: when a skill's evidenced events contain only cap-limited source
  types, the computed level clamps at L3; quiz + one imported source (the D46(4)
  pairing) = uncapped. Quiz is deliberately BOTH cap-limited (weighs below
  projects) and a corroborator. (b) D59 review-gating AMENDED: banks go live on
  deterministic lint pass (dedupe, one correct option, tags present); admin
  spot-review runs asynchronously and retires bad banks via new bank version;
  a feature flag can flip back to strict review-gating if lint-pass rates are
  ugly. Resolves the D59×D70 conflict (lazy generation + review-before-live
  would wall off the first taker). (c) First take on a skill enqueues bank
  generation for ALL THREE bands (3 batched D4-cached calls, once ever) — no
  mid-session waits when the staircase steps up. (d) Session start band = the
  band matching the HIGHER of claimed/self-assessed and evidenced level
  (self-assessment is a placement hint, never score input; D24 stands; default
  L0–1 when neither exists). (e) D60 GAP FILLED: quiz-taking is free and
  UNCAPTED in v1 (zero marginal cost; the 7-day cooldown is the only rate
  limit); attractor-style cap is one config row away if abuse appears. (f) D34
  AMENDED (narrow): shared-cache gateway features (`bank_gen`, `cert_course_map`)
  route PLATFORM-only — the first taker must not fund a shared asset with a BYO
  key (shipped `skill_definition` precedent); personal-output features
  (`post_draft`) keep BYO auto-win. (g) D74 anchor confirmed: `post_drafted`
  resets the commit counter even if the post never happens (anti-spam ratchet;
  no honor-system "I posted" button). Fold-ins without decisions: admin evidence
  panel grows section headings (not tabs); certificate verify results cache on
  the certificate row (not the LLM gateway cache). SPEC FINALIZED:
  specs/s1.5-calibration.md (2026-10-11). NEXT: /to-tickets (learner quizzes the
  breakdown before publishing) → implementation chats (VibeWise paused).

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
