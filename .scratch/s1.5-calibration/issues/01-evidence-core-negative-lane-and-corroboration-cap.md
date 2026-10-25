# 01: Evidence core — negative lane + corroboration cap

**What to build:** The spine's evidence engine becomes honest in the two ways D59/D46 always promised but the shipped code cannot do. First, retake deltas: quiz evidence may FALL — the event service accepts a negative points override for quiz events only, bounded so quiz credit alone can reach zero and can never eat repo, work-experience, or certificate evidence. Second, the corroboration cap: a skill whose evidence comes only from cap-limited source types clamps at L3 until a second source type corroborates (D46(5) — promised since the design chat, never shipped; the S1.5 grill caught it). This is the prefactor ticket: make the core trustworthy before features ride on it.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Negative overrides accepted ONLY for the quiz event type; every other type still floors at zero (focused tests on the event service)
- [x] The bound: a quiz delta may drive a skill's quiz-source contribution to exactly zero, never below; other sources untouched (fixed-clock test)
- [x] Decay edge pinned: January +16 quiz event decays; July retake at −8 lands the DECAYED quiz contribution at exactly 0; the quiz-source sum's sign never goes negative at any read time (uniform decay preserves sign — test proves it)
- [x] Corroboration clamp inside the single-writer recompute: repo-only, work-exp-only, quiz-only, and cert-only skills compute level ≤ L3 regardless of score
- [x] Any second source type uncaps (repo + quiz computes above L3 when the score allows; S2 interviews will inherit this for free)
- [x] The clamp is structural, not a config dial; point values and weights stay config rows
- [x] Seed config additions applied idempotently (the existing seed pattern); all tests service-layer against the shared test Postgres
