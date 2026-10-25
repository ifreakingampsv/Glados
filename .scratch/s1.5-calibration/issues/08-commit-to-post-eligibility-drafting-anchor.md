# 08: Commit→post — eligibility, drafting, anchor

**What to build:** The D22/D40/D74 distribution machine. Post drafting unlocks from a stateless derived gate: user-authored PUSHED commits on a GitHub-linked project since the last draft cross a config threshold (default 10). The draft action (user-triggered only, weekly-capped) fetches the actual commit range and grounds one gateway call in commits + project description + the cached LinkedIn-review "what to post" output → 2–3 candidate drafts. The user edits, times, and posts themselves via LinkedIn's self-serve share flow — no auto-posting anywhere. Each draft appends the anchor event, resetting eligibility even if the post never happens.

**Blocked by:** None (can start immediately — the GitHub token pattern, LinkedIn review output, and gateway all shipped in S1).

**Status:** done

- [x] Eligibility check: live author-filtered commit count since the last draft event (repo-import date as baseline when none) ≥ `posts.minCommitsPerMilestone` (config, default 10); computed through the existing Clerk token pattern; nothing stored
- [x] Threshold boundary tested (9 commits = locked, 10 = eligible); forks excluded by the author filter; non-GitHub projects show no post surface at all
- [x] Draft action: one gateway call (personal output — BYO auto-win applies per D78), grounded in the commit range + description + cached LinkedIn-review output → 2–3 candidates
- [x] D22 guardrails enforced at draft time: public repos or user-flagged work only; 2 drafts per rolling week (config)
- [x] Each draft appends the 0-point anchor event (project id + commit range in payload) — the "since" anchor for the next eligibility window
- [x] No milestone button, no project status column, no honor-system "I posted" toggle — the gate is stateless by design (D74)
- [x] LinkedIn share-flow guide copy as build-time content; posting happens outside the system
