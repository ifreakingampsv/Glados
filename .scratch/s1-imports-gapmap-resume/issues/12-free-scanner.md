# 12: Free scanner + anonymous funnel

**What to build:** The public attractor (D51): anyone pastes a JD (+ optional resume) and sees a fit % + top-3 gaps WITHOUT an account; the full gap list and evidence detail sit behind joining the waitlist or redeeming an invite (D38b CTA — never a bare signup promise at ramp stage 1). Anonymous runs are resume-mode only (no profile exists). The anonymous JD + result live in a TTL side table (~30 days, config) keyed by an anonymous session cookie and are CLAIMED into the account on signup — teaser work follows you in (D61). Anonymous caps run on a HASHED IP (~2/day, config; raw IP never stored, env pepper, never logged); the shared-NAT soft edge is accepted as a tuning problem. Free accounts get full results under the existing D28 fixed caps. NO energy bars anywhere in this family (D60). This is the first public-facing surface — the UI polish ticket must have landed.

**Blocked by:** 01 (UI pass precedes public surfaces), 07 (transient parse), 11 (fit + gap computation).

**Status:** done

- [x] Public scanner route: paste JD (+ optional resume) → fit % + top-3 gaps for anonymous visitors; full detail gated
- [x] Anonymous daily cap by hashed IP (env pepper; raw IP never stored or logged — tested); cap value = config
- [x] Anonymous session cookie keys a TTL side table (~30d, config); signup claims the teaser JD + result into the account (tested, incl. TTL expiry)
- [x] CTA = join waitlist / redeem invite; flows through the existing D38b capture
- [x] Free-account path under D28 fixed caps (scanner 3/day, JD scan 5/day); zero energy-bar involvement
- [x] OQ7 note recorded in the ticket-adjacent docs: rename checklist fires before any public MARKETING of this surface (in-repo codename is fine for the friend cohort)
- [x] Service tests: caps, partial-results gating, TTL claim flow, hashed-IP privacy, tenant scoping
