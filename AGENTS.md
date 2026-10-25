# GLaDOS — repo instructions for every chat

GLaDOS is a job-prep ecosystem web app, built slice-by-slice (S0 spine → S5).
Context lives in files, not in any chat. Read what your role needs — never everything.

## The three living docs

- `docs/DECISIONS.md` — the WHY. D1–D23 = locked priors (challengeable in design chats).
  D24–D31 = S0 spine design. Design and grill chats read it fully; all other chats read
  only the [D#] entries they actually touch.
- `ROADMAP.md` — the WHERE. Slice table + statuses. Update the status row in the same
  session when a slice moves (backlog → designing → specced → building → shipped).
- `specs/<slice>.md` — the WHAT. After `/to-spec`, implementation chats work from the
  spec + `.scratch/<slice>/issues/` tickets — NOT the full DECISIONS.md.

`.vibe-wise/` is VibeWise learner state; only design chats read it (it is gitignored).

## Standing rules

1. Any chat that makes or changes a decision writes it back to `docs/DECISIONS.md`
   (next [D#], dated) in the same session, before ending. No exceptions.
2. Reference by path + [D#] / section — never paste file contents into chat.
3. Per-slice workflow: design (VibeWise ON) → `/grill-with-docs` → `/to-spec` →
   `/to-tickets` → implementation chats ("VibeWise paused — work the frontier") →
   update ROADMAP status → optional `/retro`. GATE: before `/to-spec`, verify
   DECISIONS.md contains the slice's grill-outcomes section — a kickoff prompt
   naming `/to-spec` never substitutes for the grill.
4. Product naming: GLaDOS is an internal codename only (Valve trademark). The rename
   checklist in DECISIONS.md OQ7 fires before any public step (domain purchase,
   marketing, store listing).
5. Slice closing (every slice): write the slice's hands-on checklist under
   `docs/walkthroughs/<slice>.md` (input → expected output per feature), refresh
   `README.md` as the GitHub-facing doc for what the slice added, commit the work,
   and push to `github.com/ifreakingampsv/Glados` (remote `origin`). The slice is
   not "shipped" until the user has walked its checklist hands-on — ROADMAP shows
   `building` until that walk passes, then `shipped`. `CODING_STANDARDS.md` is read
   during review; the pre-commit hook (husky) runs lint-staged + typecheck +
   tests — never bypass it without saying why.

## Interaction preferences (any host)

- English only — never mix other languages into responses.
- A pasted error gets what / why / fix in simple language, in that order, before any fix.
- Keep replies short and dense — the user is latency-sensitive.
