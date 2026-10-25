# 03: Enrichment + strict tagging + top-unmatched readout

**What to build:** New-or-changed-sha repos get enriched (official star history → velocity within star band, tests/CI file checks, README length, license, size, dependency signals) and skill-tagged through a NEW read-only resolver — `resolveTagStrict` — that returns `unresolved` instead of ever creating a candidate skill. Only resolved outcomes (canonical | alias | ≤1-typo auto-accept on ≥4-char tokens) tag repos; everything else increments the top-unmatched-topics counter that admins read to grow the alias list deliberately. Sha-unchanged repos skip enrichment entirely.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] `resolveTagStrict` is pure: enrichment runs leave every skills table row-count unchanged (the grill's regression test)
- [ ] Canonical tags written only from resolved outcomes; existing-candidate and confirm-zone topics count as unmatched
- [ ] Top-unmatched counter accumulates per raw topic and is readable as an aggregate
- [ ] Sha-unchanged repos skip all enrichment calls
- [ ] Star history fetched once per repo; velocity percentile computed within band with the injectable clock
- [ ] Enrich never writes to user-visible spine state (no events, no user_skills)
