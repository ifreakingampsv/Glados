# 11: Gap map modes + fit score

**What to build:** The signed-in gap map: pick a JD → fit percentage + a fully explainable gap list. Two modes behind an explicit toggle (D54): RESUME MODE (default for new/no-profile users; have-set = parsed resume claims) and PROFILE MODE (evidenced levels + the project bank matched via projects.skills, with claims filling only zero-evidence holes). Merge rule: evidence always wins; every skill in the result carries a provenance label (evidenced / claimed / self-assessed). The fit formula is the spec's fixed one — provenance-weighted level credit ÷ expected level, parent rollup, all knobs config rows, NO AI at score time — and every number drills through to the per-skill list. Mode memory: choice persists per user; profile mode becomes the DEFAULT automatically once the profile is strong (config threshold) but ONLY for users who never explicitly chose; a manual choice always wins and persists (D73). Includes the central "How levels work" page rendered with the user's own profile as the worked example; every label links there (D62).

**Blocked by:** 04 (project skills), 07 (claims for resume mode), 10 (JD requirements).

**Status:** done

- [x] Fit formula implemented exactly as specced; deterministic; parent rollup applies; drills through to the explainable per-skill list
- [x] Resume mode + profile mode behind a toggle with adjacent explainer text; new/no-profile users see resume mode only (no dead switch)
- [x] Merge rule: evidence wins; claims fill zero-evidence holes; provenance label on every skill
- [x] Mode memory: persisted choice; auto-flip at the config strength threshold only when no explicit choice exists; manual choice always wins
- [x] "How levels work" central page (user's own profile as worked example, ends on the verify-more action); all labels/nudges link to it
- [x] Anonymous-safe: this computation is reusable by the scanner ticket without auth assumptions baked in
- [x] Service tests: both modes, merge rule, parent rollup, formula math, mode-memory priority, tenant scoping
