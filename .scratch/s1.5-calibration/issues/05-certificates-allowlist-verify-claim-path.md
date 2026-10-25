# 05: Certificates — allowlist, verification, claim path

**What to build:** The certificate upload path (D57/D75): a user submits a certificate from an ALLOWLISTED provider with its verify URL — the server matches the provider's URL pattern, fetches the public page once, softly matches the name, and writes externally anchored evidence that decays from the issue date. Off-list providers and failed fetches store a plain claim with a one-line quiz nudge (never forced). The user confirms the course→skill mapping before anything writes. Optional PDF stored via the storage module.

**Blocked by:** None (can start immediately — every seam it needs shipped in S1).

**Status:** done

- [x] Provider allowlist as config rows (~10 verifiable providers, current URL shapes verified at build; entries = slug, name, verify pattern, example URL)
- [x] Verification: pattern match → one fetch of the public page (result cached on the certificate row, not the LLM gateway cache) → 200 + soft name match; mismatch = visible warning, never a gate; fetch failure = unverified and resubmittable
- [x] Verified → evidence event at the verified-cert ladder weight with occurred_at = issue date (from the verify page when present, user-entered otherwise); unverified/off-list → claim tier + quiz nudge
- [x] Course→skills mapping: one cached platform-route gateway call per course; user CONFIRMS the mapped skills before any write (construction/selection split)
- [x] Optional PDF through the storage module (private bucket, signed URLs); course name/dates from the shipped PDF text path where present
- [x] Staleness needs no new mechanism: fixed-clock test — a 2-year-old certificate decays toward zero through the normal 90-day half-life
- [x] No network in tests (verify fetch stubbed at the service boundary); storage contract tests extended
