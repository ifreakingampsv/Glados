# 06: Portfolio + application scopes

**What to build:** The scope picker's other two options. Portfolio: up to 3
selected projects (config), cross-project opener ("which is your deepest
work and why"), rotating focus. Application: resume blocks + optional saved
JD; the bank skews toward the JD's extracted canonical skills; the report
frames results as a resume-claim audit ("claims you couldn't defend"). Both
scopes share the engine, persona, and grading; bank cache key includes the
scope hash; resume edits invalidate application-mode banks automatically.

**Blocked by:** 02.

**Status:** done (2026-10-25 — check green 40 files/161 tests)

- [x] Portfolio scope: multi-select ≤3, opener + rotating focus, session row records the scope
- [x] Application scope: resume + optional JD picker; bank generation consumes JD extracted skills
- [x] Resume edit invalidates cached application banks (content-version key)
- [x] Report framing for application scope surfaces un-defended claims
- [x] Tests: scope in cache key (three scopes never share a bank), cap enforcement, JD skew present in the grounding pack
