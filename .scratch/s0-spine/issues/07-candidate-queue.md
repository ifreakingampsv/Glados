# 07: Admin candidate queue

**What to build:** Admins promote candidates per [D24]/[D33]: approve → canonical, merge →
alias (old row marked `alias_of` so existing event references resolve read-time), reject →
retired. Skills are never hard-deleted. Reject is BLOCKED once any event references the
candidate (service-layer guard); merge is the only path thereafter.

**Blocked by:** 06.

**Status:** ready-for-agent

- [x] Admin sees the candidate queue with reference counts and acts on each entry
- [x] Approve makes the skill canonical and immediately resolvable
- [x] Merge creates the alias + pointer; rows referencing the old id resolve to the target
- [x] Reject succeeds for unreferenced candidates and is refused for referenced ones
- [x] No code path can hard-delete a skill row
