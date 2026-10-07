# 08: Event log (append-only evidence)

**What to build:** Platform-verified actions append immutable evidence events per [D25]:
columns user_id, type (fixed vocabulary), skills[] (skill IDs), points (signed),
occurred_at, source (derived per [D35]), payload JSONB. `occurred_at` is clamped to
≤ now. Levels never live on events. Users browse their history; events can reference
projects in payload. Append-only in practice: no update/delete paths exist.

**Blocked by:** 05, 06.

**Status:** ready-for-agent

- [x] Service append writes a complete event and returns it; users see it in their history
- [x] Future-dated occurred_at is clamped to now (decay math can't be gamed)
- [x] Events referencing a merged/retired skill still resolve to the canonical skill at read time
- [x] No update/delete path exists in the service layer or API
- [x] Source on events always matches the derived auth channel
