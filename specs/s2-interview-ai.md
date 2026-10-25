# S2 — Interview AI, text-only, startup mode (spec)

Status: FINAL (2026-10-25). Source of truth for decisions: `docs/DECISIONS.md`
[D79]–[D88]. Vocabulary: `CONTEXT.md` → "Interviews (S2)". This spec is the
implementation contract; implementation chats work from this file plus tickets
in `.scratch/s2-interview-ai/issues/` — NOT from full DECISIONS.md.

## Problem Statement

A job-seeker can list a project on their resume but has never had to defend it
under pressure — and doesn't know they can't. Existing options are expensive
($148/mo copilots), generic (dead free tools, non-project-grounded mocks), or
isolated (terminal skills that produce a score no ecosystem remembers). Nobody
turns "how you performed defending your own work" into durable, calibrated
skill evidence. GLaDOS has the spine to do exactly that, and no interview
feature exists yet.

## Solution

A text-only mock interviewer, startup persona ("assumes it's one more
vibe-coded project until you prove otherwise"), grounded in the user's own
spine through asymmetric grounding: the interviewer sees only what a real
interviewer would hold (project description, skills, resume blocks, repo
public surface — per scope), while the platform-side grader sees everything
including optional per-project decision records. Sessions are fixed-length
(quick 5 / deep 12), delivered turn-by-turn from a cached ranked question
bank with capped follow-up pushes on vagueness. Graded sessions produce a
rubric report (five anchored dimensions, per-question verdicts, groundedness
audit) and write per-skill evidence into the spine — the strongest shipped
evidence tier, uncapping the L3 corroboration ceiling on probed-and-passed
skills. The same engine serves two surfaces: the website (platform-run,
1 energy bar) and the user's own harness via an MCP server (their tokens run
the conversation; the platform grades, free but daily-capped and deferrable).
The definition of done is the eval harness: a ten-transcript golden set with
consensus-anchored scores, deterministic asserts in CI, paid LLM runs gating
releases, and a weekly drift cron. The slice also ships the weekly briefing
(email nudge + in-app page), a shareable unbranded readiness card, an STT
input spike behind a flag, and a living cost bench for the benched voice
stack.

## User Stories

1. As a job-seeker, I want to practice a realistic startup interview about
   my own project, so that I find out I can't defend it before a real
   interviewer finds out for me.
2. As a job-seeker, I want to choose what the interviewer "is holding" —
   one project, up to three, or my resume plus a JD — so that practice
   matches the real scenario I'm preparing for.
3. As a job-seeker, I want a quick 5-question session when I have ten
   minutes, so that practice fits into an evening.
4. As a job-seeker, I want a deep 12-question session when I have half an
   hour, so that breadth and depth both get probed.
5. As a job-seeker, I want the interviewer to ask only from what it could
   realistically know about me, so that the practice feels like a real
   interviewer, not a mind-reader.
6. As a job-seeker, when I hand-wave, I want the interviewer to push back
   by naming the exact vagueness ("easier than what?"), so that I learn
   where my story falls apart.
7. As a job-seeker, I want the interviewer to move on after at most two
   pushes, so that one weak answer doesn't consume the session.
8. As a job-seeker, I want to pause an interview and resume it later, so
   that life doesn't waste a paid session.
9. As a job-seeker, I want each session to cost exactly one energy bar
   regardless of quick or deep, so that the pricing is simple and
   predictable.
10. As a new user, I want one bonus energy bar on signup, so that my first
    interview is effectively free.
11. As a job-seeker, I want a report minutes after the session with one
    verdict per question (🟢🟡🔴), so that feedback is concrete, not vibes.
12. As a job-seeker, I want five dimension scores (technical depth per
    skill, problem solving, tradeoffs, communication, composure), so that I
    know what to practice, not just that I did badly.
13. As a job-seeker, I want the report to tell me where my answers
    contradicted my own decision records or the visible surface, so that
    the audit catches what I'm bluffing about.
14. As a job-seeker, I want the report to say whether it was graded against
    decision records or reasoning-quality alone, so that I know how much to
    trust the grade.
15. As a job-seeker, after a session I want to be offered "save the choices
    you just defended" as decision records, so that future interviews (and
    grades) get sharper without me writing essays.
16. As a job-seeker, I want to hand-write a decision record for a project,
    so that I can prepare the sharp version before ever being asked.
17. As a job-seeker, I want a passing interview to actually raise my
    evidenced skill levels, so that practice pays off in the spine.
18. As a job-seeker, I want a partially-defended skill to earn partial
    credit and a failed one to earn nothing, so that levels reflect reality.
19. As a job-seeker, I want an interview I defended well to remove the L3
    corroboration ceiling on the skills I actually defended, so that
    verification unlocks real levels.
20. As a job-seeker, I want to delete a session and its transcript, so that
    an embarrassing interview doesn't haunt me — accepting my levels fall
    if I burn the evidence.
21. As a job-seeker, I want a shareable readiness card with my band and
    dimension summary, so that I can show progress without exposing my
    transcript.
22. As a returning user, I want later sessions to probe what earlier
    reports found weak, so that practice compounds.
23. As a harness user (Antigravity/ZCode), I want to run the interview in
    my own agent on my own subscription, so that practice costs the
    platform nothing and me zero extra.
24. As a harness user, I want the platform to hand my agent the same
    question bank the website uses, so that the interview is identical
    wherever I run it.
25. As a harness user, when I submit more transcripts than the daily
    grading cap allows, I want them stored and graded tomorrow, so that
    nothing I did is ever lost.
26. As a BYO-key user on the website, I want my own key to power my
    interview turns, so that I never spend energy bars.
27. As a lapsed user, I want a Monday email with three headline numbers and
    one next action, so that the product pulls me back.
28. As a user whose energy bank is decaying, I want a win-back email that
    says exactly that, so that I know what I'm losing.
29. As a user, I want to unsubscribe from the briefing in one click, so
    that the nudge never becomes spam.
30. As a user, I want an in-app "This Week" page with all the numbers and
    the honest down-moves too, so that the briefing never lies to me.
31. As a user who prefers speaking, I want to answer by voice with the
    platform transcribing into the same interview, so that typing speed
    doesn't cap my answers. (Flag-gated spike; may park.)
32. As a user, I want a one-tap "I'd want this with voice" button on my
    report, so that demand decides when real voice ships.
33. As an admin, I want a grader-eval panel that replays the golden set on
    demand with per-transcript diffs, so that I can tune the grader safely.
34. As an admin, I want a weekly drift history of golden-set scores, so
    that a silent provider model swap can't corrupt grading unnoticed.
35. As an admin, I want an on-demand voice-stack cost bench button that
    shows what a run costs before I press it, so that the bench stays
    honest and current.
36. As the platform, I want deterministic eval asserts in CI so that
    citation and follow-up-policy regressions block commits for free.
37. As the platform, I want the paid LLM golden suite to gate releases —
    not every commit — so that eval rigor doesn't tax development.
38. As the platform, I want no MCP tool to ever write evidence directly,
    so that trusted judgments only enter the spine through platform grading.

## Integration

- **Events (code catch, first ticket):** rename the reserved
  `interview_passed` type to `interview_completed` across the event
  vocabulary, the corroborations-bucket classifier (already maps the
  interview bucket), the default points map (base 10 stays — already the
  strongest tier), and the seed config. Zero-row rename, valid only because
  no production events of this type exist.
- **Evidence write-back:** one `interview_completed` event PER PROBED SKILL
  via `appendEvent` with `pointsOverride = round(base × verdictFraction)`
  (config `interview.verdictFractions` = green 1 / amber 0.5 / red 0); the
  shipped non-negative override clamp is the only guard needed. `source` =
  `system` (server-internal grading job, D35a); the surface is recorded on
  the session row and mirrored in the event payload as `origin: web | mcp`.
  Interview events land in the existing "interview" evidence bucket, so the
  D78a corroboration logic already knows a second corroborating bucket when
  it sees one — no recompute changes.
- **Gateway:** all three call classes route through the existing
  `gatewayCall` seam with two new routing-table rows: `interview_turn`
  (cheap tier, ~5s target) and `interview_grader`. Bank generation uses a
  content-hash cache key over (user, scope, spine content version) — the
  shipped GatewayCache pattern; it is BYO-eligible on web with the existing
  D34 consent-fallback, and platform read-or-generate on the MCP path. Bank
  spend never counts against the MCP grading cap.
- **Energy:** web sessions deduct one bar per started interview via the
  existing energy account; the welcome bar (+1, once) is granted
  idempotently on the first Clerk `user.created` webhook. BYO-turn sessions
  draw no bar. Interviews count as platform-verified evidence events, so
  the existing D36 weekly earned-bar logic self-subsidizes practice with no
  changes.
- **Quotas:** MCP grading uses a per-user `DailyCounter`
  (`mcp_grade:{userId}`), cap from config `interview.mcpGradeDailyCap`
  (default 3). The grading job checks the counter at run time; over-cap jobs
  re-enqueue themselves for the next UTC day via pg-boss delayed schedule.
- **Worker:** new pg-boss jobs — session grading (offline, D3), transcript
  R2 tiering (on dashboard trigger), weekly briefing (cron, Monday), weekly
  golden-set drift run (cron), and the voice cost bench (on-demand, admin-
  triggered). The decay sweep is the scheduling precedent.
- **Auth/MCP:** API tokens (D35) authenticate the MCP server; `source` is
  derived from the auth channel exactly as shipped; the MCP transport is a
  thin layer over the same service functions the website calls (D21) and
  ships feature-flagged.
- **Admin console:** the D43/D47 admin surface grows the grader-eval panel
  (run golden set, per-transcript diffs, drift history) and the bench
  button; evidence readouts gain interview-source rows.
- **Email:** Resend enters the stack here (first real email surface);
  briefing skips null-email users (Clerk webhook backfills); unsubscribe is
  a preference row set by a one-click hosted URL.
- **Docs/process:** README gains a "What S2 adds" section; the slice closes
  per AGENTS rule 5 (walkthrough checklist at `docs/walkthroughs/s2.md`,
  commit, push). CONTEXT.md S2 vocabulary is already live.

## Implementation Decisions

- **Modules (all service-layer, D21 pattern):**
  - `interview` service — session lifecycle (setup screen model: scope →
    ground → quick/deep → start), bank generation + cache, turn loop
    (request/response, no streaming v1), push policy enforcement (cap 2,
    config row), auto-abandon sweep (7 days, config row), resume-with-
    regeneration when the spine content version changed.
  - `interview-grader` service — queued grading call, rubric emission
    (five dimensions 1–4, per-question verdicts, groundedness audit with
    resolvable citations), evidence write-back per probed skill, report
    persistence, evidence-basis labeling (records vs intrinsic; stale
    records are recency-marked corroboration-only), debrief decision-record
    drafting (AI constructs, user confirms).
  - `briefing` service — weekly computation (five input blocks), one AI
    coach's note (wordsmiths, never computes; renders beneath deterministic
    numbers), one-action CTA ladder, email send + skip rules (empty week =
    silence; bank-decay week = win-back), unsubscribe check.
  - `mcp` module — the five tools (start_interview_session,
    submit_interview_transcript, get_interview_report, get_spine_snapshot,
    save_decision_record) as thin wrappers; skill-file distribution
    (one-command install + token paste) whose onboarding teaches; the
    experimental harness-voice paragraph (D87 rung 1) lives in the skill
    file. NO tool writes evidence events — grader is the only writer.
  - `transcription` module — a single interface for STT input (the spike:
    JS-native whisper in-process first); nothing else imports a whisper
    library. Flag-gated, default OFF.
  - `eval` harness — golden-set fixtures in-repo (10 synthetic transcripts
    in the GLaDOS stack), deterministic assert suite (citation resolution,
    push-on-vague), promptfoo config for the paid LLM runs, drift-run
    recording, consensus anchoring flow (3-model grading; unanimous =
    auto-anchor; splits = human adjudication of order + bands).
- **Schema (four new tables; D25 column-vs-payload split as decided in
  D82):** `interview_sessions` (columns: user, scope, mode, status
  active|completed|abandoned|graded, timestamps; payload: grounding refs,
  spine content version snapshot, interviewer config, origin surface),
  `interview_turns` (session, idx, question, answer, pushes_used,
  duration_ms — telemetry columns by design, D77 justification),
  `interview_reports` (session, five dimension scores + evidence_basis as
  columns; per-question verdicts, groundedness findings, coaching, model +
  prompt versions in payload), `decision_records` (project, choice,
  alternatives, rationale, status draft|confirmed, source
  interview_debrief|manual|plugin, session ref, timestamps).
- **Deletion:** tombstone, not cascade — strip transcript/report content,
  mark payload `deleted_at`, recompute excludes the session's events, levels
  fall visibly; the how-levels-work page gains one honest line.
- **Retention:** transcripts in Postgres at ramp stages 1–2; tier text
  blobs to R2 through the storage module when the D43 dashboard says so;
  tombstoned content is stripped immediately and never archived.
- **Share card:** deterministic render from report data (no AI at render),
  band + dimensions only, user's name, no product wordmark (URL hostname
  leak accepted; OQ7 rename checklist fires before anything branded),
  feature-flagged.
- **Config rows (all tunable via console):** verdict fractions, push cap,
  session lengths, auto-abandon days, MCP grading cap, bars per interview,
  welcome bar, bank cache version, voice un-bench demand threshold,
  briefing skip rules, rubric tolerances.
- **D83/D87 amendments (grill, D88):** deterministic asserts block commits
  (pre-push + `check` extension); the paid LLM golden suite gates releases
  via console runs + weekly drift cron. No Python sidecar ships; STT is a
  spike behind the transcription seam that may exit parked with its cost
  memo written down.

## Testing Decisions

- **Good tests here assert external behavior at the service seam:** start a
  session, feed turns, run the grader, and assert on the report rows,
  evidence events, points, and recompute outcomes — never on prompt text or
  internal helper calls. The gateway is stubbed at its existing seam; no
  test talks to a real provider.
- **Modules tested:** interview service (lifecycle, bank cache hit/miss,
  push cap enforcement, abandon/resume/expiry), grader service (verdict →
  points mapping, per-skill event emission, evidence-basis labeling,
  fallback ladder, citation-resolution asserts, tombstone exclusion),
  briefing service (block computation, CTA ladder, skip rules, coach-note
  is wordsmith-only), MCP tools (auth + user scoping, cap-and-defer flow,
  no-evidence-write invariant), energy/quota integration (bar deduction,
  welcome-bar idempotence, daily counter).
- **Prior art in the repo:** the S1.5 quiz tests (negative lane, decayed
  floor, injectable clock), events/levels recompute tests, energy grant
  tests, and the D76/D78 boundary tests are the direct templates.
- **Eval harness testing:** the deterministic suite runs in vitest (fixture
  transcripts, stubbed gateway) and is wired into `check`/pre-push; the
  promptfoo LLM suite is run on demand and by the weekly drift cron, its
  results recorded for the console graphs. Golden fixtures are synthetic,
  never user data, and never fed into grader prompts as examples.

## Out of Scope

- Big-tech mode (algorithmics/system-design bank generator) and role/focus
  variants (flag-gated prompt flips only, not built).
- Portfolio-scope golden transcripts (project + application cover the set).
- Any recruiter-facing surface (D11 stays staged; the D81 options menu is a
  pre-commitment, not a build).
- Negative evidence for interviews (🔴 = zero, no deductions, v1).
- Platform voice (rung 2) and any Python STT sidecar; the voice cost bench
  is a script + notes, not a product surface.
- Quiz-pack delivery via MCP (D56 route stays parked).
- Real-time streaming turns; multi-language interviews; interviewer
  personas beyond startup; embeddings anywhere in the loop.

## Further Notes

- **Definition of done (D83 as amended by D88):** (a) the ten-transcript
  golden set spans both scopes, both grading modes, and the three edge
  behaviors (hand-waver, hallucinated project, ultra-short), with consensus
  - human order/band anchors; (b) deterministic suites block commits on
    citation/push violations; (c) the console replays the set with visible
    diffs and drift history; (d) zero hallucinated citations across the set;
    (e) a release does not ship without a green on-demand LLM run.
- **Cheating posture (D81):** v1 consciously accepts the
  ChatGPT-in-another-tab hole (self-harm only at this stage); structural
  mitigations only. The recruiter-era menu is the pre-committed response.
- **Cost expectations:** ~$0.02–0.05 per platform-funded interview (cheap
  tier + cached bank); grader fractions of a cent; briefing ~$0.001/user/
  week; the $5/mo platform budget row is expected to need its first ramp
  review if adoption runs hot (D84 honest flag).
- **Standing patterns named this slice for reuse:** deterministic scaffold
  - live delivery (D30 family; S3b/S4 will use it) and bounded adaptivity
    (every adaptive behavior capped by a config row).
