# 09: Diff-and-stage re-upload

**What to build:** Re-uploading from the same source produces a staged diff the user reviews and accepts item by item — nothing writes until accepted (D55a/D72). The diff is PER-SOURCE: each import path (resume file, LinkedIn export) diffs only against content previously imported from that same source, via origin markers on blocks/claims; stale flags are per-source even though the claim pool is global (a skill absent from the new resume but present in the LinkedIn export does not go stale). Conflicts resolve evidence-wins automatically; claims absent from the newest same-source upload get STALE flags, never deletion; evidenced skills are untouched. The staged changeset persists so "review your import" survives sessions and is auditable.

**Blocked by:** 08 (write-back entities exist to diff against).

**Status:** done

- [x] Deterministic per-item diff (same / updated / new / gone) computed against same-source content only (origin markers on blocks/claims)
- [x] Staged changeset persists in a staging table; review UI lists proposed changes; user accepts individually or wholesale
- [x] Accept applies transactionally; declining leaves every row untouched (tested)
- [x] Evidence-wins conflicts resolve automatically — a file can never downgrade evidenced levels (tested)
- [x] Stale flags per-source; stale content displays as flagged, never auto-deleted
- [x] Old content recoverable via the event log; the stored PDF updates on accept
- [x] Service tests: all four diff outcomes, per-source staleness, evidence-wins, walk-away-and-return persistence, tenant scoping
