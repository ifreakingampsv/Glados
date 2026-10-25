# 10: MCP server — five tools, grading flow-back, skill file

**What to build:** The user's own harness runs the interview. A thin MCP
transport (in the monolith, over the same service functions the website
calls; feature-flagged) exposes five token-authed tools:
start_interview_session (returns the SAME cached bank + policy),
submit_interview_transcript (one call at session end; full turn log;
sub-half = abandoned, writes nothing), get_interview_report (pending until
graded), get_spine_snapshot (read-only coaching context),
save_decision_record (writes only user-confirmed records; claim-tier).
Grading enforces the per-user daily cap (DailyCounter, config default 3):
over-cap jobs re-enqueue for the next UTC day; transcripts wait as pending,
never lost. NO tool writes evidence events — the platform grader is the
only writer. Distribution: a versioned SKILL.md (one-command install +
token paste) whose onboarding teaches what MCP is, what the token does,
where evidence goes — including the experimental harness-voice paragraph
(read questions aloud, accept speech; their audio, their tokens).

**Blocked by:** 03, 05.

**Status:** done (2026-10-25 — check green 44 files/190 tests)

- [x] Five tools working over API tokens; user-scoped; source derived from auth channel
- [x] start returns the website's cached bank (ship-the-bank); harness runs turns on its own model
- [x] Cap-and-defer: 4th transcript of a day sits pending, graded next UTC day; nothing lost
- [x] No-evidence-write invariant tested (submitting transcripts through MCP never appends events directly)
- [x] save_decision_record requires confirmation, writes claim-tier records only
- [x] SKILL.md with teaching onboarding + harness-voice paragraph; surface behind a feature flag
- [x] Transport is a thin wrapper: no business logic outside the service layer
