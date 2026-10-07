# 02: Clerk auth + local users + webhook sync

**What to build:** A visitor signs up/in through Clerk and gets a local `users` row whose
id every spine table will FK. Clerk webhooks (user.created/updated/deleted) maintain the
row; lazy row-creation on first use backstops webhook lag. The auth middleware builds an
auth context (session cookie → user id, `source: web`). A `role` column (user | admin)
supports admin surfaces, seeded manually for now.

**Blocked by:** 01.

**Status:** ready-for-agent

- [x] Sign-in lands on the app with a local users row existing for the Clerk user (verified live 2026-10-07: Google OAuth sign-in + test account, backstop created the local row)
- [x] Simulated webhook payloads (created/updated/deleted) keep the local row in sync — tested via fixtures
- [x] First request from a known Clerk user with a missing local row creates it (backstop)
- [x] Auth context is available to service functions; `source: web` derived from cookie channel
