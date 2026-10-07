# 01: Repo scaffold + service-layer seam

**What to build:** A deployable Next.js + TypeScript + Prisma skeleton on Vercel with a
real Postgres reachable via a pooled connection (Neon in prod; embedded-postgres binaries
for local dev/test), pg-boss installed against the same DB, and Vitest running
service-layer tests. One trivial demo service is wired route → service → DB to prove the
seam. The service-layer discipline (all rules in service functions; routes are thin
wrappers) is established here and never broken after.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] `npm run dev` serves the app; health route returns DB time + boss readiness via a service function, not inline DB calls
- [x] `npm test` runs Vitest against a REAL Postgres (started/stopped by the test global setup) — no mocks for DB/queue
- [x] Prisma client is a singleton; pg-boss is a lazily-started singleton; both read DATABASE_URL from env
- [x] `.env.example` documents Neon pooled URL + local dev/test DB setup; `.pgdata/` gitignored
- [x] `next build` succeeds (Vercel-deployable shape)
