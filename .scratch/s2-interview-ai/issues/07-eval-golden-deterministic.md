# 07: Eval harness I — golden set + deterministic CI suite

**What to build:** The grader gets a regression floor that costs nothing to
run. Ten synthetic golden transcripts live in-repo (fictional candidates on
a GLaDOS-shaped project — never real user data, never fed into grader
prompts as examples): project-scope weak/medium/strong, application-scope
medium-claim-collapse + strong, edge cases (hand-waver, hallucinated
project, ultra-short answers), and one records-vs-intrinsic pair. The
deterministic vitest suite asserts over fixtures with the gateway stubbed:
every citation resolves, pushes fire on known-vague fixture answers, no
fixture can produce an unresolvable citation. The suite is wired into
`check` and the pre-push hook.

**Blocked by:** 04.

**Status:** done (2026-10-25 — check green 41 files/173 tests; note: suite IS vitest so check/pre-push wiring is automatic)

- [x] Ten fixtures in-repo covering both scopes, both grading modes, three edge behaviors
- [x] Deterministic suite: citation-resolution + push-on-vague asserts green with zero LLM spend
- [x] Suite runs as part of `npm run check` and pre-push; a broken assert fails the gate
- [x] Fixtures importable by the LLM suite (08) without duplication
