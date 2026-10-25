# Slice walkthroughs — the hands-on close ritual

Every slice closes with a hands-on walk (AGENTS.md rule 5): the user drives each
shipped feature with real inputs and checks the expected output. A slice is not
"shipped" until this passes.

## How to run a walkthrough

1. Terminal 1: `npm run dev:db` — revives the local database (it stops between
   sessions). Wait for the "ready" line.
2. Terminal 2: `npm run dev` — starts the app. Open the printed localhost URL.
3. Sign in with the dev test account: `gladostest+clerk_test@example.com`
   (password in `scripts/make-test-user.ts`; admin role, energy 9999).
4. Open the slice's checklist below and work top to bottom: **Do** the action,
   confirm **Expect**, tick the box.
5. Anything that fails → note it; that's a bug report for the next chat, not a
   blocker to noting the rest.

## Checklists

- [S0 — Spine](s0-spine.md)
- [S1 — Imports, gap map, scanner, resume](s1-imports-gapmap-resume.md)
- [S1.5 — Calibration layer](s1.5-calibration.md)

New slices get a new file here, written during the verification pass (same chat
that refreshes the README and commits).
