# 07: What-if replay + guarded apply

**What to build:** The D47 tuning loop, flag-gated: the admin edits candidate weights, replay re-runs the REAL event log under the hypothetical config and shows the per-skill score/level diff BEFORE anything applies — including level changes caused by the corroboration cap, not just raw point shifts. APPLY = a guarded maintenance job doing a bulk user_skills rebuild under the now-real config, explicitly outside the per-event single-writer path (the decay-sweep pattern). Dark at ship.

**Blocked by:** 01 (the clamp must exist to be diffed), 06 (the console surface it lives on).

**Status:** done

- [x] Replay diff: recompute under hypothetical weights vs current, per skill — score + level, clamp-aware (level changes from the L3 cap visible as their own rows)
- [x] Replay correctness test: the diff matches a from-scratch recompute under the same hypothetical config
- [x] On-the-fly replay per request (no persistence) — fine at ramp scale per D47
- [x] APPLY = bulk rebuild maintenance job outside the single-writer path; never a service-layer event write
- [x] Replay and apply each behind their own feature flag; flag-off hides the flow entirely from the console
- [x] The tuning-session consumption story holds: readouts + replay at each ramp stage (learner first, then the friend cohort)
