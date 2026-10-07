# CODING_STANDARDS.md

Read during **review**, not implementation. Mechanical checks live in the linter,
typecheck, and pre-commit hook — only judgement calls live here. Vocabulary:
`CONTEXT.md`. Decisions behind these rules: `docs/DECISIONS.md` [D#].

## Only services write the database

Every Prisma write happens inside a `src/services/*` function. UI routes, server
actions, webhook handlers, cron routes, and (future) MCP tools call services — never
`db.` directly. This is the D21/D29 single-enforcement-path rule; a write outside a
service is a review-blocking finding, not a nitpick.

## Event log is append-only

No update or delete path may exist for `event_log` (D25). Corrections happen as new
events (`system_adjustment`). The reject-guard and read-time alias resolution (D33b)
depend on immutability — break it and levels lie.

## Prisma Json columns cast at the service boundary

Prisma's generated types reject plain object literals for `Json` fields. Cast at the
one place data enters (`as unknown as Prisma.InputJsonValue`), keep the domain type on
the service's input, and never let the cast spread past the service layer.

## All tests share one Postgres

`vitest.config.ts` sets `fileParallelism: false` because every test file hits the same
embedded Postgres (`tests/global-setup.ts`). Do not "optimize" this away — parallel
files race on shared cleanup and fail randomly. New test files join the shared setup;
per-file cleanup must delete only rows the file created.

## Tests assert behavior through seams

Tests call service functions and assert observable state (rows, balances, gates) —
never internals. Two seams exist: the service layer (everything) and the gateway
adapter boundary (stubbed HTTP, contract shape only). See `specs/s0-spine.md` →
Testing Decisions.
