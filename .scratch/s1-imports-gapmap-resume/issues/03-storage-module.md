# 03: Storage module over Cloudflare R2

**What to build:** The gateway pattern applied to files: ONE thin service-layer module owns ALL object storage — put, get, short-lived signed URL, delete — over Cloudflare R2, in a private bucket (D64). Nothing else in the app touches storage directly, ever. S0 shipped with zero storage; this is the missing piece the S1 grill caught.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Storage service with put / get / signed-URL / delete semantics against a private R2 bucket
- [x] Contract tests against an in-memory S3-compatible fake — no network in CI (gateway-boundary pattern)
- [x] Admin "storage probe" action (upload → fetch → delete a test object), admin-gated, following the S0 smoke-probe pattern
- [x] R2 credentials come from env vars; `.env.example` updated
- [x] CODING_STANDARDS hold: only services touch storage; no public buckets; no raw URLs leaked to clients (signed, short-lived only)
