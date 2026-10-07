# 14: Energy economics

**What to build:** The D28/D36 quota economy finished: +1 bar/week earned by ≥1
platform-verified evidence event in the trailing 7 days (bank cap 3 stands); BYO-key users
exempt from energy draining (rate limits only); attractor daily caps plumbed as config
(consumers arrive in S1); all quota values + budget rescalable per D7 ramp stage.

**Blocked by:** 12, 08.

**Status:** ready-for-agent

- [x] User with ≥1 evidence event in the trailing week gains +1 bar (once per week max)
- [x] Inactive users do not earn; bank never exceeds 3
- [x] BYO users' platform-route calls skip energy deduction entirely
- [x] Attractor counters increment and enforce their configured daily caps
- [x] Quota/budget values live in config rows — changing them needs no deploy
