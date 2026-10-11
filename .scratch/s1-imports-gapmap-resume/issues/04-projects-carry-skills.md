# 04: Projects carry skills

**What to build:** Projects gain an editable skills list so the profile-mode gap map has something to match against (the grill's code catch: D54 assumed projects carry skills — they didn't). The column is backfilled once from each project's project_added evidence events, and users can add/remove skills on the project page through the existing tag resolution ladder. The column is the mutable fact; the event log stays the history (D25 division, D66).

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Project model carries skills as an array column (mirrors event_log.skills)
- [x] Idempotent one-time backfill populates the column from project_added events
- [x] Project edit UI adds/removes skills via the existing normalize → alias → fuzzy ladder (confirm chip still guards ambiguity)
- [x] Service-layer tests: backfill correctness (incl. merged-skill alias resolution), edit writes, tenant scoping
- [x] `npm run check` green
