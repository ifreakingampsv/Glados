# 03: Staircase sessions + signed deltas + cooldown

**What to build:** The quiz engine: a user answers 6-question rounds that step between bands (≥5 correct steps up, ≤2 steps down, otherwise settle), hard-capped at 18 questions. Completion writes ONE quiz evidence event per skill with SIGNED DELTA points through the narrow negative lane; a per-skill 7-day cooldown gates retakes; abandoned sessions write nothing and consume nothing; every question outcome lands in the telemetry tables (D59/D76).

**Blocked by:** 01 (negative lane + bound), 02 (banks to draw from).

**Status:** done

- [x] Session schema: user, skill, bank version, start band, settled band, started/ended, outcome, questions asked, correct count — plus per-question rows (position, band, correct, duration ms)
- [x] Start band = the band matching the HIGHER of claimed/self-assessed and evidenced level; L0–1 when neither exists (placement hint only — claims never touch the score)
- [x] Staircase state machine: exactly ≥5 up / ≤2 down / else settle per round; hard cap 18 questions; deterministic grading (zero per-answer tokens)
- [x] Signed delta: first quiz writes the full positive; a retake writes new − previous raw, floored by the decayed quiz contribution (ticket 01's bound)
- [x] Cooldown: per SKILL, rolling 7 days from a completed session's end; abandoned sessions (< half the first round answered) write nothing and do NOT consume the cooldown
- [x] Evidence event payload: settled band, per-band correct/total, session id, bank version
- [x] Fixed-clock tests for the decay/delta edge and cooldown boundaries; same-level retake writes exactly 0
