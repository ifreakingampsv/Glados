# 13: Provider adapters + admin smoke probe

**What to build:** Remaining launch adapters per [D26] — Google AI Studio, OpenRouter — as
routing-table rows implementing the same OpenAI-compatible contract (Atria Dawn API shape
verified at build time). Admin-only smoke probe exercises resolver → adapter → metering
end-to-end ([D37d]). Admin UI toggles feature flags; budget-alert hook wired ([D5]).

**Blocked by:** 12.

**Status:** ready-for-agent

- [x] Smoke probe (admin only, gated by role) performs a real configured call and shows the metering row it produced
- [x] Non-admins cannot reach the probe
- [x] Each new provider is provably a routing row + adapter, no gateway surgery
- [x] Flag toggles take effect on the next gateway call
- [x] Budget threshold crossing raises the alert hook (log/event; email delivery later)
