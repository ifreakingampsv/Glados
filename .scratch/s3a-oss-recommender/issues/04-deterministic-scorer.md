# 04: Deterministic scorer + lane trust flags

**What to build:** Every shelf repo gets an explainable score. Hard filters (alive, not fork, license present, solo-modifiability size ceiling) gate scoring; config-row weights combine push recency, velocity percentile within band, tests/CI presence, README/docs quality, and license as a soft dim (GPL not disqualified). Cross-list vouch = memberships with lastSeen inside the ingest window. Dead repos (archived, 18-months-silent) flip shelf-eligible off. Same inputs always produce the same score and order.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] All weights read from config rows; changing a weight changes scores on re-run
- [ ] Hard-filter tests: fork, unlicensed, oversize repos never score
- [ ] Vouch counts only memberships with recent lastSeen (dropped-from-list loses its vouch)
- [ ] Determinism test: two scoring runs over identical data produce identical order
- [ ] Dead-repo fixture flips shelf-eligible=false; flagged repos stay stored, never deleted
