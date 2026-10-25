# 04: Grader, report, evidence write-back, readiness card

**What to build:** A completed session grades and pays out. A queued grading
job (intrinsic mode only in this ticket — no decision records yet) emits the
report: five anchored dimensions 1–4 as columns, per-question 🟢🟡🔴 verdicts
in payload, a groundedness audit section whose every citation resolves to a
real turn or record id, and an evidence-basis label (`intrinsic`). One
`interview_completed` event per probed skill with points = base × verdict
fraction (config), source `system`, origin in payload; probed-and-passed
skills visibly uncap past L3. Report UI shows verdicts, dimensions, Say/
Avoid/Fix coaching. Deleting a session tombstones it: content stripped,
recompute excludes its events, levels fall. A deterministic unbranded
readiness card (band + dimensions only) renders shareable behind a flag, plus
the one-tap "I'd want this with voice" demand button.

**Blocked by:** 01, 03.

**Status:** done (2026-10-25 — check green 38 files/153 tests)

- [x] Grading job produces report rows (dimension columns + evidence_basis); verdict fractions from config (green 1 / amber 0.5 / red 0)
- [x] One evidence event per probed skill, points scaled by verdict, source system, payload origin; L3 cap visibly lifts on corroborated skills
- [x] Every groundedness citation resolves programmatically; a hallucinated citation fails grading loudly
- [x] Tombstone deletion: transcript/report content stripped, events stop counting, levels fall; how-levels-work page gains the honest one-liner
- [x] Report UI with verdicts, dimensions, coaching; readiness card renders deterministically with no transcript content, no product wordmark, behind a flag
- [x] Voice-demand button writes a countable signal (config threshold for later)
- [x] Tests: verdict→points mapping, per-skill event emission, cap-uncap through recompute, tombstone exclusion, card renders from report data only
