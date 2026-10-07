# 12: Gateway core — credentials, metering, energy deduction, fallback

**What to build:** The gateway module per [D2]/[D26]/[D34]/[D36]/[D38]: the ONLY path for
platform AI spend. Routing table is DATA. BYO keys pasted once over HTTPS, encrypted
server-side (KEK from env), decrypted only in gateway memory, never logged, masked to
last 4 in UI. BYO auto-wins when the user has a key for the routed provider. Each call
writes one usage row (user, feature, model, tokens, cost) + daily counters + energy
balance IN THE SAME TRANSACTION; lazy 1-bar/day grant, bank capped at 3; interactive BYO
failure → explicit platform-fallback button ("costs 1 energy bar"); queued jobs hard-fail
with a retry-on-platform notice. Silent fallback banned. Feature-flag check in the call
path ([D6]/[D38a]). ONE adapter behind a stubbed-HTTP contract harness (OpenAI-compatible
shapes); no real provider calls in CI.

**Blocked by:** 02.

**Status:** ready-for-agent

- [x] A service-level call through the gateway returns the adapter response and a usage row + counter + energy deduction exist in the same transaction
- [x] BYO key used when present for the routed provider; platform route otherwise
- [x] Key at rest is ciphertext; UI sees last-4 only; nothing logs plaintext
- [x] Interactive BYO failure shows fallback consent (costs 1 bar) — never silent spend
- [x] Queued-path BYO failure hard-fails with retry-on-platform semantics
- [x] Daily grant (1 bar) with 3-bar bank cap verified; disabled feature flag short-circuits the call
- [x] Adapter contract tests run against stubbed HTTP
