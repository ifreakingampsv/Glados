# 03: Turn loop — live turns, capped pushes, pause/resume, auto-abandon

**What to build:** A full interview runs end to end. Each answer submits and
the next question arrives in a plain request/response (no streaming, ~5s
target on the `interview_turn` routing row). When an answer is vague, the
interviewer pushes back by NAMING the vagueness ("easier than what?"), at
most 2 pushes per question (config row); pushes-used and per-turn duration
are recorded on the turn rows as telemetry. A failed gateway call retries
once, then the session pauses as active and is resumable. Sessions idle 7
days (config row) auto-abandon; resuming after spine content changes
regenerates the bank. Sessions answered under half write nothing.

**Blocked by:** 02.

**Status:** done (2026-10-25 — check green 37 files/146 tests)

- [x] Answer → next question round-trip works; every turn row persists question, answer, pushes_used, duration_ms
- [x] Push cap enforced (≤2 per question, config row); push text names a specific vagueness per prompt policy
- [x] Gateway failure mid-interview: one retry, then pause; resume continues from the same turn index
- [x] 7-day auto-abandon sweep (worker job) marks stale active sessions abandoned; sub-half sessions write no evidence later
- [x] Bank regeneration on resume when the spine content version changed
- [x] Tests: push-cap boundary, pause/resume, abandon sweep (injectable clock), telemetry recorded but never evidence
