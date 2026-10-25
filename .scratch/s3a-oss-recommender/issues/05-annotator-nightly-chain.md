# 05: Annotator + nightly chain

**What to build:** Each night the top-N new survivors (N = config row) get one AI annotation each — why memorable, 3–5 modification ideas, learning payoff — through a new platform-only gateway route with a 120-second timeout. The full nightly chain (grid → enrich → score → annotate) runs as one scheduled, flag-checked, idempotent job; annotations cache by repo + default-branch sha and regenerate only when code actually changed. Annotations decorate cards; they can never affect rank order.

**Blocked by:** 04.

**Status:** done (built + verified 2026-10-26)

- [x] `repo_annotate` provider route row seeded, platform-only; call site passes the 120s timeout
- [x] Annotation written once per repo+sha; repeated chain runs with unchanged sha make ZERO gateway calls (stub call count asserted)
- [x] Nightly `discover-nightly` schedule registered; worker grows to six schedules total; both discover jobs flag-checked at run time
- [x] Full-chain idempotency: pipeline run twice → identical shelf state
- [x] Rank order identical with annotations on vs off (order never depends on annotation content)
- [x] Gateway stub tests assert metering happens like every platform call
