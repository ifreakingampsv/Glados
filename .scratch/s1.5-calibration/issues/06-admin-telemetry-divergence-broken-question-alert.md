# 06: Admin telemetry + divergence + broken-question alert

**What to build:** The admin evidence panel grows its quiz half: the D59 readouts (completion rate, drop-off question index, per-question success, retake frequency, time per question) rendered only above per-readout minimum samples, the evidence-vs-quiz divergence slot finally filled, and broken questions auto-flagging into the spot-review queue (D77/D78). Aggregate-only — no named users in any telemetry panel.

**Blocked by:** 02 (banks/queue to point at), 03 (session + answer data).

**Status:** done

- [x] Telemetry readouts over the session/answer tables: completion rate, drop-off index, per-question success, retake frequency (30-day window), time per question
- [x] Per-readout minimums as config rows; below N each readout renders an honest "not enough data" state — never a caveat-laden small-sample number
- [x] Divergence readout: evidenced level vs quiz-settled band per skill, only for skills with ≥3 users holding both (fills the shipped placeholder note)
- [x] ONE alert: a question with ≥20 answers and <20% success auto-flags into the admin spot-review queue
- [x] Aggregate-only enforced — telemetry surfaces expose no user identities
- [x] Grows the existing admin page as section headings (no tabs), alongside the shipped evidence readouts
- [x] Service tests: hidden-below-N / rendered-above-N per readout; alert threshold boundary (19 answers no flag, 20 at 19% flags)
