# 04: Quiz UI + trust-teaching surfaces

**What to build:** The user-facing take flow and the D62 teaching surfaces around it. Pick a leaf skill → take the quiz → see the settled band and the exact points delta in plain language; a cooldown shows its next-retake date; claim chips across the app gain the one-line verify CTA; the "how levels work" page gains quizzes and certificates as rungs with the user's own profile as the worked example. Taking is free and uncapped — no energy anywhere in the flow.

**Blocked by:** 03 (the engine).

**Status:** done

- [x] Take flow on the skills surface: start screen (start band + why, in one line), round rendering, visible progress, settle screen showing band + the delta arithmetic honestly (including a negative one)
- [x] Cooldown state renders the next-retake date instead of a start button
- [x] Verify CTA on claim chips: skills page, work-experience chips, unverified certificates — one line each, linking to the central page
- [x] "How levels work" page: quiz + certificate rungs, worked example from the viewer's own profile, the L3 cap explained in plain language
- [x] Free + uncapped: no energy, no daily cap, no upsell in the quiz flow (D78)
- [x] Only canonical leaf skills expose a quiz entry (parents and candidates don't)
- [x] UI kept thin — behavior covered at the service seam in ticket 03; route-level tests only
