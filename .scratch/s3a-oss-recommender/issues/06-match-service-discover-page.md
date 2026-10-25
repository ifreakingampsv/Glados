# 06: Spine match service + /discover page

**What to build:** The day job. A logged-in `/discover` page in the authenticated group: matched top-5 cards up top (evidenced + claimed + target-role archetype signals, each provenance-labeled), stretch badges on repos one level above evidenced skills (difficulty proxy = size + popularity + dependencies), strengths default with a persisted "aim at my gaps" toggle, archetype chips whose explicit picks beat titlePatterns inference and persist, already-imported repos excluded, and an empty-spine fallback to the global top-scored shelf with a personalize CTA. Below the fold: the browsable shelf with lane/band/archetype filters. Fit lines are deterministic template interpolation — no AI at render. Impressions log server-side at match time. Free + uncapped.

**Blocked by:** 04 (needs a scored shelf; cards render annotation text when present, gracefully without).

**Status:** done (built + verified 2026-10-26)

- [x] Cards label each signal (evidenced / claimed / target fit) and link to how-levels-work where trust matters
- [x] Stretch badge appears for one-level-up repos only; hidden when the user has no evidenced level
- [x] Gaps toggle + archetype picks persist per user; explicit pick overrides inference
- [x] Already-imported repos never appear in matched cards
- [x] Empty spine → global fallback + explainer CTA; the matched section is never a dead blank
- [x] One `RecImpression` row per shown card, written server-side at match time
- [x] Zero event_log writes anywhere in the flow (asserted in tests); route renders 200 in the authed group
