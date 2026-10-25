# 08: MCP shortlist tool + telemetry readouts

**What to build:** The dual-surface door and the feedback loop. `get_rebuild_shortlist(archetype?)` joins the shipped MCP server's tools — a thin read-only wrapper over the same match service the page calls, returning cards (repo, score, fit lines, annotation text when present), generating nothing; the SKILL.md gains a short shelf section (versioned bump). Admin telemetry: click updates the impression row; per-repo and per-archetype CTR readouts with minimum-count rules (hidden below threshold), aggregate-only; the top-unmatched-topics panel lands on the admin surface. The single `discover` flag verifiably gates page + jobs + tool together.

**Blocked by:** 06.

**Status:** ready-for-agent

- [ ] Tool listed in the MCP smoke; token auth identical to the five shipped tools; returns cards read-only
- [ ] SKILL.md shelf section added with a version bump
- [ ] Click telemetry updates the existing impression row (no second table)
- [ ] CTR readouts hidden below minimum counts; aggregate-only, never named users
- [ ] Top-unmatched-topics panel visible to admins
- [ ] Flag-off disables page + both schedules + the tool — verified in one test
