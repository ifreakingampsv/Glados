# 09: Evidenced levels (user_skills cache)

**What to build:** user_skills as the materialized cache per [D24]: ONE writer recomputes
on every event — score = Σ base_points(type, source) × 0.5^(age_days/90), level = L0–L5
band lookup, claimed level stored alongside but NEVER in the score. base_points and band
thresholds are seeded config rows. Users see evidenced levels per skill.

**Blocked by:** 08.

**Status:** ready-for-agent

- [x] Appending an event updates the affected user_skills rows through the single writer
- [x] Score math verified: decay, trust-weighted sources, signed points
- [x] Level bands map scores to L0–L5 from config, not code constants
- [x] Setting a claimed level never changes the evidenced score/level
- [x] Replay-safe: recomputing from the same log yields identical state
