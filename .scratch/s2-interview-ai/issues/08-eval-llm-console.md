# 08: Eval harness II — LLM suite, anchors, drift cron, console, voice bench

**What to build:** The paid half of the eval harness plus its admin home.
promptfoo config runs the golden set through the real grader on demand, with
the per-run cost shown before the button is pressed. Consensus anchoring:
each fixture graded by three models; unanimous verdicts auto-anchor, splits
queue for human rank/band adjudication (one sitting). A weekly drift cron
re-runs the set and graphs score history — catching silent provider model
swaps. The admin console's grader-eval panel shows run-on-demand,
per-transcript diffs vs anchors, drift history, and hosts the voice-stack
cost bench button (bench script runs the three candidate stacks against a
golden transcript and prints $/session; on-demand only).

**Blocked by:** 07.

**Status:** done (2026-10-25 — check green 42 files/176 tests; deviations: native eval-runner instead of promptfoo dep (same contract, in-pipeline asserts), 3 independent runs as consensus (single provider live), voice bench = plan-printing script + console memo (live adapters unwired by design)

- [x] promptfoo run on demand via console; per-run cost estimate displayed before execution
- [x] 3-model consensus flow produces anchors (order + bands); split adjudication surfaces the disagreements with each model's reasoning
- [x] Weekly drift cron records golden scores; history graphed on the panel
- [x] Grader-eval panel: run, diff, history; admin-only
- [x] Voice cost bench script + button with cost warning; results memoized into a small report
- [x] Intentional grader improvements update anchors in the same change, with the diff as the review artifact
