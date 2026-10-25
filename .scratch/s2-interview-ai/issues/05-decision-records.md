# 05: Decision records + records-mode grading

**What to build:** Projects gain ADR-lite decision records and the grader
uses them. `decision_records` table (choice, alternatives, rationale, status
draft|confirmed, source interview_debrief|manual, session ref). Users can
hand-write records per project. After a graded session, the debrief offers
"you defended N choices — save them?" with AI-drafted records the user
confirms. The grader gains records mode: citations against records, findings
where answers contradict them, and the fallback ladder — records absent or
stale (predating the project's latest import/major event → recency-marked,
corroboration-only) grade intrinsically. Reports carry the evidence-basis
label honestly.

**Blocked by:** 04.

**Status:** done (2026-10-25 — check green 39 files/157 tests)

- [x] Manual decision-record authoring on a project (create/edit, confirmed only by user)
- [x] Post-session debrief drafts records from defended turns; nothing saves without user confirmation
- [x] Grader records mode: contradiction findings cited to record ids; stale records recency-marked and demoted to corroboration
- [x] Evidence-basis label on reports flips correctly (records vs intrinsic) for the same transcript
- [x] Records are claim-tier in the D46 ladder — they never add evidence points themselves
- [x] Tests: fallback ladder transitions, staleness demotion, draft→confirm flow, records never write points
