# GLaDOS — Domain Language

Glossary for the GLaDOS job-prep ecosystem: one shared user "spine" that feature
slices read and write. Decisions live in `docs/DECISIONS.md`; this file records the
vocabulary, not the implementation.

## Spine & identity

**Spine**:
The shared per-user core — profile, evidenced skills, projects, target role,
preferences, event log — that every feature slice reads and writes.
_Avoid_: "profile" when you mean the whole spine.

**Target role**:
The job a user is aiming at; gap-map framing and recommendations anchor to it.

**Cohort**:
An optional named group of users with an owner; the seed of a future campus mode.
_Avoid_: org, team.

**Source**:
The channel an action entered the system through (web, agent_plugin, extension,
system) — derived from how the request authenticated, never client-declared; drives
trust weighting of evidence.

**Invite code**:
A single-use code that redeems a waitlist signup; app access gates on redemption.

## Skills & evidence

**Canonical skill**:
The single approved vocabulary entry for a capability.
_Avoid_: skill tag.

**Alias**:
Text that resolves to a canonical skill.

**Candidate skill**:
A typed skill awaiting promotion (approve / merge / reject).

**Claimed level**:
A user's self-rated ability for a skill; never contributes to the evidenced score.

**Evidence event**:
One immutable log row: who, what type, which skills, signed points, when, source.
_Avoid_: activity, history entry.

**Evidenced level**:
The L0–L5 band over a skill's decayed evidence score.
_Avoid_: "skill level" (ambiguous with claimed level).

**user_skills**:
The materialized per-user, per-skill current score and level, rebuilt from the log.

**Retired skill**:
A skill no longer offered for new tagging but kept because evidence events reference
it; a merge leaves a pointer to the absorbing canonical skill.

**Gap map**:
Required-vs-have skill comparison for a JD, computed as a canonical-id set
difference.

**Calibration quiz**:
A deterministic multiple-choice check that settles a skill's band and writes
signed-delta evidence. _Avoid_: test, assessment.

**Quiz bank**:
The cached question set for one skill + band + version; generated lazily, shared
by all users. _Avoid_: "bank" alone — say quiz bank or interview bank.

**Staircase**:
The round-based quiz session that steps between bands and settles at one.

**Signed delta**:
A quiz event's points equal the new result minus the previous result; negative
deltas make levels fall, bounded so quiz credit alone can hit zero.

**Cooldown**:
The per-skill wait between completed quiz sessions.

**Verify URL**:
A certificate provider's public page proving a certificate exists; the basis of
verification.

**Allowlisted provider**:
A certificate provider with a verify-URL pattern; only allowlisted providers can
earn verified evidence — everyone else is a plain claim.

**Corroboration cap**:
The rule that evidence from a single weak source type cannot raise a skill past
L3 until a second source type corroborates it.

## AI & quota

**Gateway**:
The single path through which platform AI money is spent and trusted judgments
enter the spine.

**Platform fallback**:
Explicit per-incident user consent to run a failed BYO call on the platform route —
metered and capped like any platform call; never silent.

**Energy bar**:
One unit of platform-paid AI allowance for heavy features, denominated in
worst-case dollars.

**Attractor feature**:
A free AI feature with a fixed daily cap, used to draw users in.
_Avoid_: free tool.

**Weekly briefing**:
A periodic personal progress report generated over the event log.

## Resume

**Resume block**:
One unit of resume content; originals and variants share one table.

**Original**:
A resume block with no parent.

**Variant**:
A JD-bound derived copy of an original.

**Locked block**:
A block whose text the user froze; never silently rewritten.

**Fit budget**:
The roughly one-page content limit the resume builder enforces ("fit or flag").

## Interviews (S2)

**Interview session**:
One mock interview run — startup persona, fixed question count, one scope.

**Scope**:
What the interviewer was "holding" when the session started: project (one repo),
portfolio (up to three), or application (resume + optional JD).
_Avoid_: mode (that's quick/deep, the session length).

**Interview bank**:
The ranked question list built once per user + scope + spine content version,
cached and shared by both surfaces.
_Avoid_: quiz bank (deterministic MCQ set, shared across users).

**Turn**:
One question-answer exchange; the unit of transcript storage and telemetry.

**Push**:
A follow-up that names a specific vagueness; capped per turn.

**Verdict**:
The per-question 🟢 / 🟡 / 🔴 judgment that scales evidence points.

**Grader**:
The platform-side judgment call after a session ends; the only writer of
interview evidence. Never runs client-side.

**Evidence basis**:
Whether a report was graded against decision records (records) or transcript
alone (intrinsic); always labeled on the report.

**Golden transcript**:
A fixed synthetic interview with sworn scores, used to regression-gate the
grader. _Avoid_: test transcript, sample.

**Anchor**:
The human-confirmed rank order + bands a golden transcript may not drift from.

**Decision record**:
An ADR-lite per-project note — choice, alternatives, why; claim-tier evidence,
AI-drafted, user-confirmed.

**Readiness card**:
The shareable summary card of a report (band + dimensions, never transcript
content).

**Pending grade**:
An accepted MCP transcript waiting for the daily grading cap to reset; claim-grade
until graded.

**Surface**:
Which front door a session used — the website or the user's own harness via MCP.
_Avoid_: "source" (that's the event-log trust channel).

## OSS recommender (S3a)

**Shelf**:
The shared corpus of candidate rebuildable repos that every user's cards come
from. _Avoid_: "library" (the ROADMAP's older word for the same thing).

**Lane**:
How a repo entered the shelf — curated-list ingester or search grid; stored as
provenance + trust flags, never as separate UIs.

**Archetype**:
A named bundle of search ingredients (topics, languages, star bands) plus
target-role title patterns; the night job's query grid is built from them.
Grown one row at a time, never a pre-built taxonomy.

**Star band**:
A star-count pool (e.g. 50–300, 300–1500, 1500–8000); velocity is compared
within a band, never across the whole shelf.

**Annotation**:
The once-per-repo AI card text — why memorable, modification ideas, learning
payoff; cached by repo + branch sha; decorates cards, never ranks them.
_Avoid_: "brief" (that's the flagship prompt's output).

**Flagship prompt**:
The user's own deep-dive prompt, copied pre-filled from a card; its output is
pasted back and saved as a note.

**Pick**:
A study-list row on a shelf repo (considering → building → dropped); never a
project, never evidence.

**Stretch badge**:
Card marker for a repo one level above the user's evidenced level on the
matching skills.
