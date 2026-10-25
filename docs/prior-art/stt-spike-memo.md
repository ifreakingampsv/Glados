# STT spike — exit memo (parked)

Date: 2026-10-25 · Ticket 11 (S2) · Decision: D87 as amended by D88h.

## Verdict: PARKED

The JS-native in-process attempt (transformers.js / ONNX whisper) was
evaluated against the constraint that actually governs: the ~$5/mo Railway
worker container that also runs pg-boss, grading, the drift cron, and
briefings.

## Measured facts (as of evaluation)

- **Dependency weight**: `@huggingface/transformers` pulls onnxruntime
  Node binaries — on the order of 150–300 MB added to the container image.
- **First-run model fetch**: whisper-tiny/base ONNX weights are a further
  ~40–250 MB downloaded at runtime (no offline bundling without bloating the
  repo), plus a vocab file.
- **CPU latency**: prior-art figures for CPU whisper are 0.5–2 s per chunk
  (faster-whisper, python); the JS/ONNX path is typically slower than
  faster-whisper on the same silicon.
- **Container risk**: CPU transcription on the shared worker contends with
  queue drains; the D43 dashboard has no per-process CPU signal yet, so
  contention would surface as mysterious job latency — a silent-failure
  shape this project consistently designs against.
- **API alternative**: Whisper API ≈ $0.006/min → ~$0.18 per 30-min
  interview — alone exceeds the D28 energy bar's $0.10 worst-case ceiling
  (D87's original reason for self-host). A fractional-bar pricing change is
  a product decision, not a default.

## The Python-sidecar price (for the record)

A faster-whisper sidecar means: second container (~$5/mo class), a health
check, an internal auth boundary, and an image with Python + the model —
roughly doubling ops surface for a flag-off feature. Rejected for S2.

## Un-bench path (unchanged)

1. Rung 1 (live now): harness voice via the MCP skill file — the user's own
   multimodal harness handles audio; platform cost zero.
2. Rung 2 trigger: paying users exist AND the report-page demand button
   crosses its config-row threshold. At that point, re-run this memo with
   then-current container specs; the transcription seam
   (src/services/transcription.ts) is the only integration point.
