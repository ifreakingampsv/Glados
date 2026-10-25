# 09: Weekly briefing — This Week page + Monday email

**What to build:** The habit loop ships (D50/D85). An in-app "This Week"
page renders five blocks from plain SQL: evidence events (verdict colors),
points/level moves both directions, interview dimension trends
("tradeoffs 2 → 2 → 3"), energy state + earned/decaying hooks, one
gap-map line. A Monday pg-boss job sends the email via Resend (first real
email surface; unsubscribe from day one, one-click hosted URL into a
preference row): three headline numbers + one link. Empty weeks stay
silent; the bank-decay week sends the win-back email. Exactly one CTA,
chosen by the deterministic ladder (resume unfinished interview > practice
lowest evidenced dimension among target-role skills > spend decaying bank >
verify a claimed skill). One ≤200-token coach's note wordsmiths the
pre-computed facts beneath the deterministic numbers. Null-email users are
skipped silently.

**Blocked by:** 04 (report columns feed the trends block).

**Status:** done (2026-10-25 — check green 43 files/184 tests; deviation: Resend via plain fetch, no SDK dep)

- [x] This Week page: five blocks, honest falls, always available in-app
- [x] Monday job: email with 3 numbers + link; skip rules (empty week silent, decay week = win-back) tested
- [x] Unsubscribe preference honored by the job; Resend integration behind env config
- [x] CTA ladder deterministic; coach's note renders beneath the numbers and cannot introduce a number that isn't in the blocks
- [x] Briefing writes nothing to the spine (reading is not evidence — D36 safe)
- [x] Tests: block computation, ladder order, skip rules, unsubscribe, null-email skip (gateway stubbed for the note)
