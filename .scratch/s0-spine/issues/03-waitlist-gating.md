# 03: Waitlist gating

**What to build:** The D7 ramp: a public landing page captures waitlist emails; admins
mint single-use invite codes; Clerk signups stay open while app middleware gates every
page on invite redemption. A visitor can join the waitlist; an unredeemed user sees the
gate; redeeming unlocks the app.

**Blocked by:** 02.

**Status:** ready-for-agent

- [x] Email submitted on the landing page lands in the waitlist table (visible to admin)
- [x] Admin can generate single-use invite codes and see redemption state
- [x] A signed-in user without a redeemed code sees the waitlist gate, not app pages
- [x] Redeeming a valid code (once) unlocks the app; the code cannot be reused
