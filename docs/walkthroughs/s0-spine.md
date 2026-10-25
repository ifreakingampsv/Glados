# S0 — Spine walkthrough

Preflight: see [README](README.md) (dev:db, dev server, test account sign-in).

## Sign-in & gating

- [ ] **Do:** sign in with the test account.
      **Expect:** you land inside the app (the test account is admin — the invite gate
      passes). In a private window, a fresh non-invited signup should hit the
      waitlist/invite screen instead.

## Profile

- [ ] **Do:** open Profile; edit a field or two; set a target role (mark one primary).
      **Expect:** changes save; exactly one target role shows as primary.

## Projects

- [ ] **Do:** add a project with a title, description, and a few skill tags.
      **Expect:** it appears in your project list carrying those skills.

## Skills & claims

- [ ] **Do:** open Skills; tag a skill with a self-rating ("claimed level").
      **Expect:** the claim is visibly labeled as unvalidated/self-assessed — it must
      NOT change any evidenced score or level shown anywhere.

## Evidence log

- [ ] **Do:** open the events page.
      **Expect:** your actions (project added, skills tagged) appear as immutable
      history rows with type, points, and timestamp.

## Agent tokens

- [ ] **Do:** open Tokens; create one; then revoke it.
      **Expect:** the secret shows exactly once at creation; the list shows the token
      with prefix + last-4 only; after revocation it no longer authenticates.

## Admin surfaces (test account is admin)

- [ ] **Do:** open the gateway page and run the smoke probe (needs provider keys in
      `.env`; skip if unset — the button should explain, not crash).
      **Expect:** a metered call result or a clear "no route configured" message.

## The honest-math sanity check

- [ ] **Do:** find any skill with a nonzero evidenced level; note its level.
      **Expect:** the number is derived from event points decaying over time —
      nothing you can claim by typing raises it. That is the whole S0 promise.
