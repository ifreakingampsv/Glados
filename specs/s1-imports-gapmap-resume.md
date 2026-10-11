# S1 — Imports, gap map & resume (spec)

> Source: `docs/DECISIONS.md` [D40]–[D73] (design confirmed 2026-10-08, grilled same
> day — all grill recommendations accepted). Status: specced. Vocabulary: `CONTEXT.md`.
> Workflow: ROADMAP.md → slice workflow. Tickets: `.scratch/s1-imports-gapmap-resume/issues/`
> (via `/to-tickets`). Calibration layer (quizzes, certificates, tuning console,
> commit→post) was SPLIT OUT → S1.5 [D63].

## Problem Statement

A job seeker's evidence of skill is scattered across artifacts — a resume written once,
a LinkedIn profile maintained out of habit, GitHub repos that speak louder than either —
while GLaDOS's spine sits empty. They cannot answer the only question that matters when
a job posting appears: "how good a fit am I, and what exactly is missing?" Every
competitor asks them to trust a black-box score. And they have no free, instant reason
to arrive at all: nothing to diagnose, nothing to fix, nothing to come back for.

## Solution

Imports fill the spine from the artifacts users already have: GitHub repos become
projects with deterministic skill extraction; a resume or LinkedIn data-export PDF
seeds claims, resume blocks, and structured work experience — through a staged,
per-source diff where evidence always wins and nothing is ever silently changed. The
gap map turns any pasted JD into a deterministic fit percentage and an explainable gap
list, in two honesty modes (resume claims vs confirmed profile) with provenance labels
on every skill. The free scanner is that diagnosis without an account — the
distribution machine — with a teaser that follows the visitor into their account. The
resume builder turns spine content into an ATS-safe one-page PDF under a fit budget
that warns, then shrinks typography, but never cuts silently. A LinkedIn profile
review closes the loop against the user's target role. Admin sees free-tier economics
(actuals, projections, break-even) plus the first evidence-readout panel. Underneath,
S1 lands the infrastructure the design always assumed: object storage (Cloudflare R2)
and the container-hosting move that makes queue jobs and PDF rendering real.

## User Stories

**Scanner & gap map (the attractor)**

1. As an anonymous visitor, I want to paste a job description (and optionally my
   resume) and immediately see a fit percentage and my top gaps, so that I get real
   value before knowing anything about the product.
2. As an anonymous visitor, I want the full gap list and evidence detail to sit behind
   joining the waitlist or redeeming an invite, so that the funnel is honest and I
   know exactly what I'm missing.
3. As an anonymous visitor who signs up later, I want my teaser JD and result claimed
   into my account, so that my work follows me in instead of vanishing.
4. As an anonymous visitor on a shared campus/office network, I want the daily teaser
   cap to be a config value, so that NAT collisions are tuned rather than engineered
   around.
5. As a signed-in user, I want a fit percentage that always drills through to the
   per-skill gap list, so that I never have to trust a black-box number.
6. As a signed-in user, I want every skill in my gap-map result labeled by provenance
   (evidenced vs claimed), so that I know which parts to trust and which to verify.
7. As a signed-in user, I want to switch the gap map between resume mode (my claims)
   and profile mode (my evidence + projects) with an explainer beside the toggle, so
   that I choose what my results are built on and learn why it matters.
8. As a signed-in user, I want my mode choice remembered, and my explicit choice to
   always beat the automatic default, so that the system never overrides a decision I
   made.
9. As a user whose profile has become strong, I want profile mode to become the
   default automatically (when I never explicitly chose), so that results sharpen as
   my evidence grows.
10. As a user, I want my pasted JDs kept with no auto-expiry (soft-capped, oldest
    pruned), so that the iterate loop — scan Monday, edit Wednesday, re-scan Friday —
    always works.

**Imports**

11. As a signed-in user, I want to connect GitHub through my existing sign-in, so that
    I never manage a separate credential or OAuth dance.
12. As a signed-in user, I want a checkbox list of my public repos with active
    non-forks preselected and forks unchecked behind a one-line explainer, so that
    import starts from a sensible, honest selection.
13. As a signed-in user, I want an initial import cap with "import more" on demand, so
    that one click can never rack up unbounded queue cost.
14. As a signed-in user, I want imported repos to appear as projects carrying their
    metadata-derived skills, so that my project bank fills itself where it legitimately
    can.
15. As a signed-in user, I want to edit the skills on any of my projects, so that
    profile-mode matching reflects reality rather than only what dependencies implied.
16. As a signed-in user, I want an on-demand "Sync now" for my imported repos, so that
    evidence stays current without any nightly background machinery.
17. As a new user with no profile, I want to upload a resume and get scanner/gap-map
    results with nothing persisted to any profile, so that trying the product is
    commitment-free.
18. As a user creating a profile, I want my parsed resume to seed skill claims and
    resume blocks, so that I never retype my history.
19. As a user with parsed claims, I want them visibly labeled as unvalidated (with
    plain-language explanations one click away), so that I always know what is
    verified vs claimed and how to change that.
20. As a user re-uploading a resume from the same source, I want a staged diff
    (same / updated / new / gone) that I accept item by item, so that nothing about my
    profile changes behind my back.
21. As a user whose evidenced skills conflict with an uploaded resume, I want evidence
    to win automatically, so that a file can never downgrade my verified levels.
22. As a user, I want claims missing from my newest upload flagged stale rather than
    deleted, so that my history is never silently erased.
23. As a user, I want each import source diffed only against itself, so that a resume
    upload and a LinkedIn export never fight each other over the same content.
24. As a user with work experience in my resume, I want it structured as
    employer/title/period entries that earn evidence scaled by duration and
    specificity, so that real experience counts.
25. As a user, I want to re-confirm that a work-experience entry is still accurate, so
    that its evidence stays fresh without re-uploading a file.
26. As a user, I want to promote a parsed experience entry into a project with one
    click, so that my project bank stays user-curated.
27. As a user, I want to set self-assessed levels for skills with zero evidence, so
    that profile mode has no holes — and I can see they never count as evidence.
28. As a user, I want to upload my LinkedIn data-export PDF (or paste its text) and
    have it flow through the same parser as a resume, so that I don't maintain two
    import paths.

**Resume builder**

29. As a user, I want my resume content as editable blocks I can lock, so that
    approved text is never silently rewritten.
30. As a user tailoring to a JD, I want variants derived from originals with clear
    provenance, so that I can keep the original intact while targeting a role.
31. As a user, I want a live fit budget that warns on overflow and then shrinks
    typography within professional bounds, so that my resume stays one page without
    anything being cut silently.
32. As a user, I want a downloadable PDF rendered from one ATS-safe template, so that
    what I preview is what recruiters and parsers see.
33. As a user, I want the system to parse its own generated PDF and report
    parseability, so that I can trust the output.

**LinkedIn review & admin**

34. As a user, I want to review my LinkedIn profile's recruiter-attractiveness against
    my target role (via data-export upload or paste), so that I know what to add and
    fix before applying.
35. As an admin, I want an economics dashboard showing actual spend, config-driven
    projections, and a break-even price floor, so that free-tier cost stays visible
    from day one.
36. As an admin, I want an evidence-readout panel (level distribution, source mix,
    top movers), so that the points/decay knobs are tuned from observation, not vibes.

## Integration

- **Spine writes:** ALL database writes go through the service layer (CODING_STANDARDS).
  Evidence flows through the existing `appendEvent` → single-writer recompute path
  unchanged — S1 adds event types, never a second writer. New event types:
  `repo_imported`, `work_experience_added`, `work_experience_confirmed`,
  `resume_imported` (audit only, 0 points). `quiz_completed` already exists in the S0
  vocabulary; `certificate_added` is reserved for S1.5.
- **Schema changes:** ALTER `projects` (+ `skills String[]` [D66], backfilled from
  project_added events) and `skills` (+ `definition` [D70]); NEW tables:
  `resume_blocks` (deferred from S0 per [D37a], shape per [D30] + source_ref may FK
  work_experiences per [D56]), `work_experiences` ([D56]), `job_descriptions` ([D61]),
  a resume-import staging table ([D72]), an anonymous-scanner TTL side table ([D61]),
  plus config rows. NOT in S1: quiz banks, certificates, replay tables (S1.5).
- **Gateway:** S1 delivers S0's promise — the first production callers
  (`jd_extract`, `resume_parse`, `linkedin_review`; `bank_gen` follows in S1.5) with
  routing-table rows per feature, D4 content-hash caching, and the attractor caps'
  first real consumers.
- **Storage module:** new thin service-layer module over Cloudflare R2 ([D64]) — the
  gateway pattern applied to files: one path, contract-tested, no public buckets.
  S1.5 certificate uploads reuse it.
- **Hosting:** web + worker move to a container platform ([D65]); decay becomes a
  pg-boss scheduled job; the HTTP cron route stays as a manual backstop.
- **S1.5 depends on S1:** storage module (cert PDFs), parse service (cert upload path),
  work-experience entity, evidence readouts (console replays their aggregates), event
  vocabulary, commit fetch for D40 drafts.
- **S2:** parsed claims + evidenced levels remain the interview adaptation input —
  no new machinery needed.
- **D7 ramp:** anonymous caps, TTL days, import cap, JD cap, fit weights, and shrink
  bounds are all config rows — each ramp stage rescales without a deploy ([D60],
  [D61], [D58]).
- **OQ7 rename checklist fires before the scanner receives any public marketing** —
  the scanner is the first public surface; friend-cohort testing under the codename
  (D7 stage 1) is fine.

## Implementation Decisions

**Slice shape & infrastructure** ([D63]–[D65]): S1 ships infra first — Cloudflare R2
object storage behind a thin storage module (S3-compatible SDK; private bucket,
short-lived signed URLs; peppered hashing where IPs are stored), then the container
move: web + worker to Railway (preferred; Render fallback — provider verified at build
against current Student Pack offers). The UI polish pass is the first ticket ([D49]) —
S0 surfaces get right before any new surface exists. Decay sweep becomes a pg-boss
scheduled job on the worker; the existing HTTP route stays as a manual trigger.

**GitHub import** ([D45], [D58], [D67]): user connects GitHub as a Clerk external
account; the server reads the token via Clerk's OAuth-access-token API (minimal
public-repo scopes; expiry/refresh handled in one place). Connect screen lists every
public repo with checkboxes; smart preselection (non-fork + user-authored commits +
recent push + README/description start CHECKED, sorted by activity; forks start
UNCHECKED beside the explainer "only include repos you can talk about in depth");
initial import capped (~25, config row) with "import more" on demand; on-demand
"Sync now" only — no scheduled sync in S1 (deliberately defers nothing: the container
trigger fires anyway, but no nightly job exists). Per-repo queue job: metadata +
dependency files → deterministic skill extraction through the existing write-time
resolution ladder → project entity created/updated → `repo_imported` evidence event
(forks: zero-weight points per [D46]; all points config-driven). NO LLM summarization;
no commit storage (D40 fetches commits on demand in S1.5).

**Resume/LinkedIn parse & write-back** ([D53], [D55], [D72]): PDF → text via unpdf
(picked over pdf-parse per the research snapshot; pdf-parse is the fallback if
bundling bites — verified in the first parser ticket). One gateway parse call per
upload, cached by content hash (D4). Two cases: no profile → transient only (feeds
scanner/gap map, persists NOTHING); profile creation → parsed output seeds skill
CLAIMS + resume blocks + `work_experiences` rows, with validation nudges toward
quizzes (S1.5) and interviews (S2). Re-upload = diff-and-stage: deterministic per-item
diff (same/updated/new/gone) into a staging table; user accepts a staged changeset;
accept applies transactionally; evidence-wins conflicts; claims absent from the newest
same-source upload get a STALE flag, never deletion. Origin markers on blocks/claims
make stale flags per-source (resume vs LinkedIn export) while the claim pool is global.
Resumes never auto-create projects — one-click "promote to project" instead ([D55b]).
LinkedIn input = LinkedIn's own "Save to PDF" export (guide copy at build time) +
drop-in, with paste-text as the alternative; URL fetch is rejected (scraping posture).

**Work experience** ([D56], [D71]): parsed experience lands as structured
`work_experiences` rows (employer, title, period, kind: job|internship, description,
skills[]). Evidence = `work_experience_added` event: points scaled by DURATION ×
SPECIFICITY where specificity is a deterministic scorer (named-stack mentions ×
description depth; all parameters = config rows — auditable, stable across re-parses).
`occurred_at` = attestation time (when imported/verified); decay stays uniform per
[D24]; a user re-confirmation appends a `work_experience_confirmed` refresh event.
Ladder position per [D46]/[D56] (certificates insert above it in S1.5): platform-guided

> imported repos > job experience > internship > bare claims. The corroboration cap
> (L3 without a second source) applies unchanged.

**Gap map & fit score** ([D27], [D42], [D54], [D73]): computation stays the canonical-id
set difference with parent rollup (a required skill is matched if the have-set contains
it or any of its children). Two modes behind an explicit toggle: RESUME MODE (default
for new/no-profile users; have-set = parsed claims) and PROFILE MODE (evidenced levels

- project-bank matching on projects.skills). Merge rule: evidence always wins; claims
  fill only zero-evidence holes; every skill labeled by provenance. THE FIT FORMULA
  (fixed here, knobs are config rows):

```
fit% = round(100 × Σ_s credit(s) / |required|)     over canonical required skills s
credit(s) = provenance_weight × min(1, level(s) / expected_level)
  provenance_weight: evidenced 1.0 · claim 0.5        (config)
  level(s): evidenced level; else self-assessed; else 1 (bare claim)
  expected_level: config, default 3                   (seniority-aware later)
  missing: 0 · parent rollup applies
```

No AI at score time; the number always drills through to the explainable list. Mode
memory: the choice persists per user; once the profile is strong (threshold = config
row: evidenced skills ≥ N at level ≥ 1 AND ≥1 project with skills), profile mode
becomes the DEFAULT for users who never explicitly chose; an explicit manual choice
always wins and persists ([D73]).

**JD entity & extraction** ([D27], [D61]): `job_descriptions` = per-user rows, NO
auto-expiry; soft cap ~20 with FIFO prune of oldest (config); user can delete
manually. Extraction = one gateway call cached per JD content hash, instructed to
output canonical skill ids with categories and expansions resolved at extraction time
(D27). Anonymous teaser: pasted JD + result in a TTL side table (~30 days, config)
keyed by an anonymous session cookie, CLAIMED into the account on signup. D43 watches
JD storage at each ramp stage.

**Free scanner** ([D51], [D60]): ONE attractor surface = the merged public gap map.
Anonymous: resume-mode only (no profile exists), IP-based daily cap (~2/day, config;
IP stored HASHED with an env pepper, never raw), PARTIAL results — fit % + top-3 gaps
visible, full list + evidence detail behind account creation; CTA = join waitlist /
redeem invite (never a bare signup promise at ramp stage 1); known NAT soft edge
accepted, tuned via config. Free account: full results under D28 fixed daily caps
(scanner 3/day, JD scan 5/day). NO energy bars anywhere in the scanner/gap-map family.
LinkedIn review = free, 1/day.

**Resume builder** ([D9], [D20], [D30], [D44], [D69]): `resume_blocks` table (S0-deferred;
originals + variants in one table; status draft|locked; provenance = parent_id +
from_jd + event log). Variants are JD-BOUND at creation (deterministic; renderer
prefers the current JD's variant, else the parent; NO AI at render). ONE template at
launch: single column, standard headings, starting from a battle-tested print-CSS
template (prior-art note per [D16]/[D44]). Rendering: HTML/CSS → headless Chrome print
→ PDF, running in the WORKER container (the known Reactive-Resume integration point);
PDF stored via the storage module. Fit budget: (1) fit-or-flag live warning; (2)
deterministic typographic shrink — font/leading/margins as CSS variables stepped down
within professional bounds (bounds = config rows). Step 3 (evidence-weighted trim
suggestions) is DEFERRED per [D69]; locked blocks are excluded from any future trim.
Self-lint: the builder runs the S1 parser on its own generated PDF and scores
parseability (dogfooding as QA).

**LinkedIn profile review** ([D53]): parse service ingests the LinkedIn data-export
PDF (or pasted text); ONE gateway review call over the parsed profile + the user's
target roles (cached per D4) → recruiter-attractiveness assessment: what to add, what
to post (feeds D40 drafts in S1.5), visibility advice. Free, capped 1/day ([D60]).
Recruiter-side URL matching stays parked with D11.

**Admin economics + evidence readouts** ([D43], [D68]): one admin page: (a) ACTUALS —
spend by feature/day from usage rows; (b) PROJECTIONS — config-driven assumptions ×
unit costs from the routing table; (c) fixed server costs as config rows; (d)
break-even — price floor per paid user at a target margin. Plus the evidence-readout
panel (level distribution per skill, source mix, evidence-vs-quiz divergence — empty
until S1.5 — top movers): cheap aggregates over existing tables. Quota/budget tuning
happens through existing config rows; v0 = honest numbers, no gold-plating.

**Schema set (nothing more):** ALTER `projects` (+skills), ALTER `skills` (+definition);
NEW `resume_blocks`, `work_experiences`, `job_descriptions`, resume-import staging,
anonymous-scanner TTL table; config rows (anon caps, points.types additions,
work-exp scorer params, fit weights + expected level, profile-strong threshold,
import cap, JD cap, TTL days, shrink bounds). Explicitly NOT in S1: quiz banks,
certificate tables, what-if replay tables, work-experience scoring via LLM.

## Testing Decisions

- **A good test asserts external behavior through a seam** (CODING_STANDARDS): given
  spine state + an action, assert observable results (project rows + evidence events,
  staged diffs applied, caps consumed, fit scores and their inputs) — never internals.
- **Seam 1 (primary — everything): the service layer**, against the shared embedded
  Postgres (existing global setup; `fileParallelism: false`; per-file cleanup of only
  its own rows). Every S1 service is tested here: GitHub import, parse + diff-and-stage,
  work-experience scoring, gap map/fit, JD lifecycle, builder fit budget, scanner caps,
  review, dashboard aggregates. Clerk stays faked at the session boundary; GitHub API
  responses enter as fixtures at the import service boundary.
- **Seam 2 (existing, narrow): the gateway adapter boundary.** LLM-dependent services
  are tested by stubbing the gateway with deterministic outputs (parse JSON, review
  text) — no network, ever. D4 caching is asserted at the service seam: second call
  with the same content hash must not produce a second gateway invocation.
- **Seam 3 (new, narrow): the storage module** — contract tests against an in-memory
  S3-compatible fake (put/get/signed-URL semantics), the gateway-boundary pattern
  applied to files. No network in CI.
- **Queue:** real pg-boss against the same test Postgres (it is just Postgres); worker
  handlers invoked directly (S0 precedent: test the function the cron route calls, not
  the route).
- **Renderer:** a small set of real headless-Chrome tests against the ONE template —
  render a golden fixture resume, assert the PDF parses via our own parser above a
  threshold. Deliberately few; they are the slowest tests in the suite.
- **Parser fixtures:** committed sample PDFs (resume variants + one LinkedIn
  data-export) with golden structured outputs; diff-and-stage scenarios (same/updated/
  new/gone, evidence-wins, per-source staleness) as service-level tests.
- Prior art: S0's 13 service-test files / 64 tests; the shared-Postgres rules in
  CODING_STANDARDS are non-negotiable.

## Out of Scope

- **The entire S1.5 calibration layer** [D63]: skill quizzes (D41/D59/D70), course
  certificates (D57), the evidence tuning console incl. what-if replay + quiz
  telemetry (D47/D68), the commit→post generator (D22/D40).
- Private-repo GitHub import and PAT import (flag-gated later, [D58]); scheduled/
  nightly GitHub sync; LLM repo summarization (S3b).
- Auto-fit ladder step 3 (evidence-weighted trim suggestions) — deferred per [D69].
- Embeddings anywhere in matching ([D27] seam: construction only, parked until
  measurable); paid tiers/Stripe; weekly briefing (S2, [D50]); MCP server (S2, [D29]);
  recruiter/e-portfolio view ([D11]); multiple resume templates; template
  customization; resume PDF analytics beyond self-lint.

## Further Notes

- The spec-time list from the design chat resolved as: fit formula + profile-strength
  threshold + shrink bounds + all cap values → fixed above as config rows; unpdf →
  picked (fallback pdf-parse); milestone mechanics (D40) and provider allowlist seed
  (D57) move WITH their features to S1.5; LinkedIn guide copy = build-time content.
- Anonymous IP hashing requires a dedicated env pepper (never in DB, never logged) —
  same threat model as the gateway KEK ([D26]).
- Known integration points (verify in the first ticket that touches them): headless
  Chrome inside the worker image ([D44] — Reactive Resume's #1 self-host pain; write
  the D16 prior-art note before building); unpdf under the container runtime; Railway/
  Render worker + cron shapes vs Student Pack credits ([D31]/[D65]); Clerk
  OAuth-token expiry/refresh for GitHub ([D45]).
- Atria Dawn endpoint verification remains open from [D26]; the routing-table design
  keeps the swap cheap if it fails.
- The Prisma ↔ pg-boss shared-transaction enqueue pattern (flagged in the S0 spec)
  becomes load-bearing in S1 — first queue ticket designs it once, everyone reuses it.
