# 10: Job-description entity + extraction

**What to build:** A signed-in user pastes job descriptions that PERSIST per-user with no auto-expiry — the iterate loop (paste Monday, edit resume Wednesday, re-scan Friday) always works (D61). A soft cap (~20, config) FIFO-prunes the oldest; users can delete any JD manually. Extraction runs through the gateway (one call cached per content hash, D4) and outputs CANONICAL skill ids — categories and expansions resolved at extraction time (D27) — so the gap map downstream stays a dumb fast set difference.

**Blocked by:** 05 (config rows).

**Status:** done

- [x] Per-user JD rows; no auto-expiry; FIFO prune at soft cap (config); manual delete
- [x] Extraction gateway call outputs canonical skill ids (categories + expansions resolved at extraction time), cached by content hash — second identical extraction makes zero gateway calls (tested)
- [x] JD manage UI: paste, browse, delete
- [x] JD storage surfaced as a count for the D43 dashboard to watch at ramp stages
- [x] Service tests: cap/FIFO, delete, caching, canonical-id output shape; gateway stubbed
