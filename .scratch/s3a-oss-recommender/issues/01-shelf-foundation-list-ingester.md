# 01: Shelf foundation + curated-list ingester

**What to build:** The shelf exists and fills itself from curated lists. A weekly flag-checked job reads the configured list READMEs through a read-only GitHub client (the new GitHubReader seam, app-owned token, paced + backoff), parses `- [name](url) — desc` rows, hydrates repo metadata, and writes `Repo` + `RepoListMembership` rows with lastSeenAt vouches. Forks and archived repos never become shelf-eligible; anti-generic negative-keyword gates (config rows) apply at ingest. Re-running with unchanged data writes nothing.

**Blocked by:** None (can start immediately).

**Status:** done (built + verified 2026-10-26)

- [x] `Repo` + `RepoListMembership` models migrated; curated-list sources as config rows
- [x] GitHubReader interface at the HTTP boundary; real client on the app-owned read-only env token; fixture reader used by tests
- [x] Weekly `discover-lists` schedule registered; job no-ops while the `discover` flag is off
- [x] Ingest is idempotent: second run with unchanged fixtures writes zero new rows
- [x] Forked/archived entries and anti-generic gate hits never become shelf-eligible
- [x] Service tests against real Postgres with fixture reader responses
