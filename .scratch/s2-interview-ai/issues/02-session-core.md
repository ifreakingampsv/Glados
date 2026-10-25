# 02: Session core — schema, setup screen, question bank, energy

**What to build:** A user can start their first interview. The setup screen
walks scope (project only in this ticket) → ground (pick one project) →
length (quick 5 / deep 12) → start. Starting creates an `interview_sessions`
row, generates the ranked question bank (one gateway call over the visible
surface: project description, skills, repo README/deps/activity — cached by
user + scope + spine content version), deducts one energy bar, and shows the
first question. `interview_turns` table exists. Signup grants one welcome
bar, idempotently, on the first Clerk user-created webhook. BYO-key users
generate the bank on their key (existing consent fallback on failure).

**Blocked by:** 01 (keeps the prefactor-first discipline; only the routing
rows genuinely gate this).

**Status:** done (2026-10-25 — check green 36 files/137 tests)

- [x] Setup screen: scope → project picker → quick/deep → start, with the startup-persona framing copy
- [x] Session row created (user, scope, mode, status active, content-version snapshot, origin surface); turns table present
- [x] Bank generated once per user+scope+content version through the gateway cache; repeat starts hit the cache (no second generation spend)
- [x] One energy bar deducted per started platform-keyed interview; BYO bank generation costs no bar
- [x] Welcome bar +1 granted exactly once per user on first user.created webhook (idempotent under webhook retries)
- [x] Grounding pack reads ONLY the visible surface (D79) — no decision records, no quiz bands in the interviewer context
- [x] Service-layer tests: lifecycle, bank cache hit/miss, bar deduction, welcome-bar idempotence (gateway stubbed)
