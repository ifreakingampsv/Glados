# 01: UI polish pass

**What to build:** Every existing surface — landing, waitlist, profile, projects, skills, events, AI keys, tokens, admin — stops looking like scaffolding. One coherent visual system (typography, spacing, buttons, forms) across the app, with real empty/loading/error states, and a landing page that communicates what the product is with a clear waitlist CTA. This is the polish pass the learner scheduled as S1's first ticket (D49) so styling lands before the first public surface. No behavior changes.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] All S0 pages share one consistent visual system (typography, spacing, buttons, form styles)
- [x] Empty, loading, and error states exist for every data surface (no blank boxes, no raw error dumps)
- [x] Landing page states the product's value in one glance + visible waitlist CTA
- [x] Zero behavior change: existing service tests untouched and green; `npm run check` passes
- [x] Dev walkthrough of every page looks intentional (learner eyeballs it)
