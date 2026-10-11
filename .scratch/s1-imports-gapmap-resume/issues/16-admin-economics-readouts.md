# 16: Admin economics dashboard + evidence readouts

**What to build:** The admin-only economics page (D43): (a) ACTUALS — platform AI spend by feature/day from the existing gateway usage rows; (b) PROJECTIONS — config-driven assumptions (scans/user/day × users × unit cost read from the routing table); (c) fixed server costs as config rows; (d) BREAK-EVEN — the price floor per paid user covering fixed + projected AI cost at a target margin. Plus the evidence-readout panel (D68): level distribution per skill (flat = uninformative), source mix, evidence-vs-quiz divergence (renders empty until S1.5), top movers — cheap aggregates over existing tables. v0 = three honest numbers + the panel; no gold-plating. Quota/budget tuning stays on the existing config rows.

**Blocked by:** 05 (config rows + new event types feed the aggregates).

**Status:** done

- [x] Actuals view: spend by feature/day from usage rows (admin-gated via assertAdmin)
- [x] Projections view: config assumptions × routing-table unit costs
- [x] Fixed server costs as config rows; break-even price floor at a target margin
- [x] Evidence readouts panel: level distribution, source mix, divergence placeholder, top movers
- [x] JD storage count surfaced (D61's ramp watch)
- [x] Service tests for the aggregates (actuals, projections, readouts)
