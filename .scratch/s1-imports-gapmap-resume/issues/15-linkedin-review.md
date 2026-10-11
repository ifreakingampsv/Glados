# 15: LinkedIn profile review

**What to build:** The user supplies their LinkedIn profile via the official data-export PDF (or pastes its text) — the same parse path as a resume — and gets a recruiter-attractiveness review against their target roles: what to add, what to post (feeds the S1.5 commit→post drafts later), visibility advice (D53). ONE gateway call over already-parsed data, cached per D4 (profile content + target role). Free, capped 1/day (D60). HARD CONSTRAINT: no scraping — fetching arbitrary profiles by URL is rejected by design (D22/D12 posture); only user-owned input.

**Blocked by:** 05 (caps/config), 07 (parse service).

**Status:** done

- [x] Review flow: export/paste → parse → ONE gateway review call vs target roles → structured recommendations (add / post / visibility)
- [x] Cached by profile-content + target-role hash — repeat review with unchanged input makes zero gateway calls (tested)
- [x] Free 1/day cap via config
- [x] No URL-fetch path exists anywhere in the feature
- [x] Service tests: cap, caching, review output shape; gateway stubbed
