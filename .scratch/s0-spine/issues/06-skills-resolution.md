# 06: Skills vocabulary + resolution ladder

**What to build:** Tagging with a skill runs the write-time resolution ladder per [D24]
as amended by [D33]: normalize (lowercase, strip punctuation, ASCII-fold homoglyphs) →
alias lookup → fuzzy match against canonical names AND aliases AND existing candidates
(edit distance ≤1 auto-accepts ONLY at normalized length ≥4; 2–3 → confirm chip; ≥4 →
no match) → no match creates/dedupes a candidate (one per normalized string). `skills`
carries the `parent` column now ([D27]). Canonical list is seeded.

**Blocked by:** 04.

**Status:** ready-for-agent

- [x] Typing a canonical name or alias resolves invisibly; "koltin" auto-resolves to kotlin
- [x] "ts" does NOT auto-resolve to "js" — short/ambiguous input shows a confirm chip
- [x] Homoglyph input ("react" with a Cyrillic с) normalizes to the canonical skill
- [x] Unknown input creates exactly one candidate no matter how many users type it
- [x] Service-layer tests cover every ladder branch incl. the ≥4-char auto-accept guard
