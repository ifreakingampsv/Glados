# 01: Evidence prefactor — event rename + interview routing rows

**What to build:** The reserved S2 evidence event is renamed before any real
rows exist, and the gateway gains its two interview routing rows. After this
ticket, the evidence vocabulary says `interview_completed` (one event per
probed skill, verdict-scaled — D81/D88a) everywhere: event-type list,
corroboration bucket classifier, default points, seed config. Two new
routing-table rows (`interview_turn` cheap tier, `interview_grader`) seed
idempotently so later tickets never hardcode a model. A stale `points.types`
config key from the old name is stripped by the seed merge.

**Blocked by:** None (can start immediately).

**Status:** done (2026-10-25, design chat — check green 35 files/130 tests)

- [x] `interview_completed` is the event type in the vocabulary, bucket classifier, and default points (base 10, strongest tier); no `interview_passed` references remain in source
- [x] Seed config merge removes the dead `interview_passed` key from an existing `points.types` row (zero-row rename stays clean in the DB)
- [x] Routing rows `interview_turn` and `interview_grader` exist in the seed routes, OpenAI-compatible, following the existing route-entry shape
- [x] `npm run check` green
