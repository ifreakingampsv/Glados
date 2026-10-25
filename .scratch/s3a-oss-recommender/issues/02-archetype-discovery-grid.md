# 02: Archetype discovery grid

**What to build:** The shelf's second lane. Archetypes live as one JSON config row (`{key, name, titlePatterns, topics, languages, enabled}`, ~6–10 seeded from the user's own target roles); the grid builder expands archetypes × topics × languages × star bands into hard-qualified search queries (`fork:false`, pushed-recency, `archived:false`); a global nightly query cap (config row) truncates deterministically with a rotating start offset so coverage stays fair across nights. Results upsert into the shelf with the search-lane trust flag (band + velocity).

**Blocked by:** 01 (shelf schema + GitHubReader seam).

**Status:** done (built + verified 2026-10-26)

- [x] Grid builder produces the exact expected query list from archetype fixtures (math asserted)
- [x] Query cap enforced deterministically; rotation shifts coverage between consecutive runs
- [x] Search results upsert idempotently alongside list-lane repos (same repo = one row, lane flags coexist)
- [x] Editing the archetype config row changes the grid with zero code changes
- [x] Fixture-reader tests cover empty results, page-through, and 429 backoff
