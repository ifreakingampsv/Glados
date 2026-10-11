# 07: Resume/LinkedIn parse — transient path

**What to build:** A user uploads a resume PDF or pastes text — LinkedIn's official "Save to PDF" export rides the same path (D53) — and gets a structured parse result that feeds the scanner/gap map. With no profile, NOTHING persists (D55 case 1): no skills, no blocks, no profile row — the result is returned transiently. Parse text extraction uses unpdf (pdf-parse is the documented fallback if bundling bites — verify in this ticket); the parse itself is ONE gateway call cached by content hash (D4), run live through the gateway (interactive, not queued).

**Blocked by:** 03 (storage module for uploads), 05 (config/caps).

**Status:** done

- [x] PDF upload (held transiently via the storage module) or paste-text input; unpdf extraction working under the app runtime
- [x] ONE gateway parse call per upload, cached by content hash — second identical upload makes zero gateway calls (tested)
- [x] Structured parse output shape: skills, block-shaped content sections, work-experience entries (employer/title/period/description), education
- [x] LinkedIn data-export PDF parses through the same path (committed fixture test)
- [x] No-profile path persists nothing (verified by test: no skill/claim/block/profile rows after parse)
- [x] Daily cap via config (attractor-style); caps consumed through the existing counter mechanism
- [x] Service tests with the gateway stubbed (deterministic parse outputs); guide copy for the LinkedIn "Save to PDF" flow present in the UI
