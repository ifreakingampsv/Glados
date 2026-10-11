# 05: Spine plumbing — event types, config rows, skill definitions

**What to build:** The shared S1 foundation. The fixed event vocabulary grows by the types S1 needs, all S1 tunables land as config rows (never code), and skills gain definitions — generated ONCE per skill through the gateway and cached (D4), reused later by gap-map explainers and S1.5 quiz banks (D70). An admin button triggers generation for demos/QA.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Event vocabulary + service validation extended: `repo_imported`, `work_experience_added`, `work_experience_confirmed`, `resume_imported` (audit only, 0 points)
- [x] `points.types` config rows added for the new types (values config-driven, editable via existing config mechanism)
- [x] S1 config rows seeded: anonymous scan cap, LinkedIn review cap (1/day), GitHub import cap (~25), JD soft cap (~20), anonymous TTL (~30d), fit weights (claim 0.5 / evidenced 1.0) + expected level (3), profile-strong threshold, typographic shrink bounds
- [x] `skills.definition` column added; lazy generation job through the gateway (one call per skill, D4-cached, idempotent — second run makes zero gateway calls)
- [x] Admin "generate definitions" action (admin-gated, shows progress/count)
- [x] Service tests: new event types append + recompute correctly; definition generation caching; config rows readable
