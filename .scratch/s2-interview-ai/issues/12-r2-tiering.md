# 12: Transcript R2 tiering + storage readout

**What to build:** Retention plumbing for the D82 policy. The admin
economics surface gains an interview-storage readout (sessions + blob size,
D43/D61 pattern). A worker job tiers transcript text blobs to R2 through
the existing storage module when the configured trigger fires — structured
columns and report rows stay joinable in Postgres; only transcript text
moves. Tombstoned sessions are stripped immediately and never archived.
Rehydration (read path) resolves transparently when a tombstone-free
session's transcript is viewed.

**Blocked by:** 04.

**Status:** done (2026-10-25 — check green 45 files/194 tests)

- [x] Storage readout on the admin dashboard (per-user aggregate, no content)
- [x] Tier job moves transcript text to R2 on trigger; queries still resolve full transcripts
- [x] Tombstoned content stripped immediately, never tiered
- [x] Tests: tier trigger boundary, rehydration, tombstone never archived
