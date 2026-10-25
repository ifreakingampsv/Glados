# 07: Picks + notes + flagship handoff

**What to build:** The user can act on a card. A "deep-dive this in your AI" button copies the user's flagship-hunt prompt pre-filled with the repo name and their skill context (their tokens, platform $0); a paste-box saves the returned brief as a note with an optional skill link (the D39 Note model's first writer). Picking a repo creates a study-list entry with status considering → building → dropped. None of it touches evidence.

**Blocked by:** 06.

**Status:** done (built + verified 2026-10-26)

- [x] Flagship button produces the pre-filled prompt (template = config row; repo + skill context interpolated)
- [x] `Note` model + save action (source kind, title, content, optional skill link); saved notes retrievable
- [x] `ProjectPick` create / status-transition / drop actions with validated statuses
- [x] Browsing, picking, and note-saving write zero evidence events and never touch user_skills (asserted)
- [x] Demoable flow on the dev test account: pick → see considering → copy prompt → paste brief → note saved
