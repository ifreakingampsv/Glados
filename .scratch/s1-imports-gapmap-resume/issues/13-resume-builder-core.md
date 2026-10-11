# 13: Resume builder core — blocks, lock, variants

**What to build:** Users assemble a resume from blocks (D9/D30): edit content units (summary, experience, skill_group, education, custom), LOCK a block so its text is never silently rewritten, and create JD-bound VARIANTS with full provenance (parent_id + from_jd). Selection is deterministic — the renderer prefers the variant bound to the current JD, else the parent; manual override is stored, never guessed; NO AI at render time (the AI-in-construction-never-selection principle). Regenerating a variant never loses old content (event-log history per the D25 division).

**Blocked by:** 08 (blocks table + seeded content), 10 (JDs to bind variants to).

**Status:** done

- [x] Blocks CRUD with all kinds; source_ref may point at projects or work_experiences
- [x] Lock/unlock with guardrails: locked text excluded from every rewrite path (tested)
- [x] Variant creation bound to a JD at creation (from_jd); regeneration preserves the old content (recoverable via event log)
- [x] Selection rule implemented and tested: current-JD variant → else parent → manual override stored
- [x] Builder UI: reorder, edit, lock, derive variant (provenance visible in the UI)
- [x] Service tests: lock guard, provenance chain, selection rule, tenant scoping
