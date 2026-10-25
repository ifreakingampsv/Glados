# 11: STT spike — transcription interface behind a flag

**What to build:** The voice-input experiment that cannot rot. A single
transcription interface (the only seam allowed to know a whisper library
exists) with a JS-native in-process implementation attempted first. A
spike: if quality or CPU on the worker is unacceptable, the ticket EXITS
PARKED — the Python-sidecar cost is written into a short memo (docs), the
flag stays off, no sidecar ships. If acceptable: a flagged (default off)
answer-by-voice control on the interview screen transcribes into the same
answer_text column; no engine changes.

**Blocked by:** 03.

**Status:** done (2026-10-25 — spike exited PARKED: cost memo at docs/prior-art/stt-spike-memo.md; seam + honest error shipped, no whisper dep)

- [x] Transcription interface exists; no other module imports a whisper library
- [x] Spike verdict recorded: either a working JS-native path (flag off by default) or a parked memo with measured cost/latency and the sidecar price
- [x] If working: voice answer transcribes into the standard turn flow, inside the same 1-bar economics
