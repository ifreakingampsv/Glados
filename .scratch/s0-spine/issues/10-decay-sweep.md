# 10: Nightly decay sweep

**What to build:** pg-boss installed and drained by a Vercel Cron route ([D31] stopgap):
a nightly job recomputes user_skills through the SAME single-writer path as T9, so quiet
users' evidenced levels decay honestly ("levels must go down").

**Blocked by:** 09.

**Status:** ready-for-agent

- [x] Boss starts against the app DB; its schema coexists with Prisma's
- [x] Cron route enqueues/triggers the sweep; the sweep is the same recompute T9 uses
- [x] A user with no new events for months shows a decayed (not stale-high) level after the sweep
- [x] Test invokes the sweep service directly and asserts decay; the cron wrapper stays thin
