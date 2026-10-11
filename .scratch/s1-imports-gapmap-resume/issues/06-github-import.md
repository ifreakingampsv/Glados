# 06: GitHub connect + import

**What to build:** A user connects GitHub through their existing Clerk sign-in (no separate OAuth dance — D45), sees every public repo as a checkbox list with smart preselection — active non-forks with signal (user-authored commits, recent push, README) start CHECKED sorted by activity; forks start UNCHECKED beside the one-line explainer "only include repos you can talk about in depth, not minor-change forks" — and imports up to the config cap ("import more" on demand). Each import runs as a queue job: repo metadata + dependency files → deterministic skill extraction through the existing resolution ladder → a project entity created/updated → a `repo_imported` evidence event with config-driven points. Forks, if explicitly selected, import with zero-weight evidence (D46). "Sync now" re-runs selection on demand (D58: on-demand cadence only, no nightly sync in S1).

**Blocked by:** 02 (worker must exist for queue jobs), 04 (projects carry skills), 05 (event types + config).

**Status:** done

- [x] GitHub external account connect via Clerk; token read server-side only, minimal public scopes; expiry/refresh handled in one place
- [x] Repo list UI with preselection rules + fork explainer; initial import cap (config) + "import more"
- [x] Import queue job: metadata + dependency files → deterministic skill extraction → project upsert (repo = verifiable artifact; import CREATES projects directly, unlike resume claims per D55b)
- [x] `repo_imported` evidence events, points from config; forks = zero-weight points if explicitly selected
- [x] NO LLM repo summarization anywhere; NO commit storage (commit fetch defers to S1.5's D40)
- [x] "Sync now" re-imports selected repos on demand
- [x] GitHub API responses enter as fixtures at the import service boundary (no network in tests)
- [x] Service tests: preselection rules, extraction ladder, project upsert, evidence append, fork zero-weight, cap enforcement, tenant scoping
