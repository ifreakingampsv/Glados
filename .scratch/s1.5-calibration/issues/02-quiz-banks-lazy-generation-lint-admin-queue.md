# 02: Quiz banks — lazy generation, lint gate, admin queue

**What to build:** Per-skill question banks that cost nothing until someone takes a quiz. The first take request on a skill enqueues generation of ALL THREE bands at once (batched gateway calls, cached forever per the content-hash discipline); a deterministic lint decides what goes live; admin gets a spot-review queue and a "generate now" button; bad banks retire via a replacement version (D70/D78). Publishing is lint-pass → live immediately, admin review runs after — the flag can flip back to strict review-gating if lint-pass rates come in ugly.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Bank schema (skill, band, version, status) + question schema (prompt, options, correct index, difficulty/sub-topic tags), ~24 questions per band
- [x] First take request triggers all-3-band generation; banks cached per skill + band + version; a second request never produces a second gateway call (D4 asserted at the service seam)
- [x] Generation grounded in the skill's definition field (generate-on-demand for missing definitions, the shipped pattern)
- [x] Deterministic lint before live: duplicates, zero/multiple correct options, missing tags → regenerate once → otherwise land unlive in the admin queue
- [x] Lint-passed banks serve takes immediately; admin spot-review queue lists them; retire-and-replace publishes a new version and old sessions keep their version reference
- [x] Admin "generate now" action for demos/QA
- [x] Publishing flag: lint-live (default) ↔ strict review-gating
- [x] Gateway feature routed PLATFORM-only — a BYO key must never fund a shared bank (D78)
- [x] Gateway stubbed with deterministic JSON in tests; no network
