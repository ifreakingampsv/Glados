# 02: Container move — web + worker on a container platform

**What to build:** The D31 trigger fires: the app (web) and a persistent pg-boss worker run as containers on Railway (preferred: native worker services; Render fallback — verify current Student Pack coverage at build). The nightly decay sweep becomes a pg-boss SCHEDULED job on the worker, fixing the S0 loose end where the decay route shipped with no scheduler anywhere; the HTTP cron route stays as a manual backstop (D65). Neon (pooled endpoint) and Clerk unchanged.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Web service deploys and serves the app from the container platform
- [x] Persistent worker service drains pg-boss queues (first real queue infrastructure in the repo)
- [x] Decay sweep runs on a pg-boss schedule (observed firing once); HTTP route still works as manual trigger
- [x] Env parity from container env: Neon pooled URL, Clerk keys, gateway KEK, CRON_SECRET, platform AI keys
- [x] Student Pack credits applied, or the ~$5/mo-class shortfall documented for the D43 dashboard
- [x] Preview/dev deploy story documented (Neon branching per D32, optional)
