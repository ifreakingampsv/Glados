# Prior art — AI interviewing (input for the S2 design chat)

Researched 2026-10-25. Feeds the S2 design chat; nothing here is a decision yet.
Scope per user: (1) text interview shipping now on a cheap VPS; (2) full voice
stack built in parallel but benched. Economic bracket: ~$0.10–0.50 ceiling per
interview all-in ([D-something] ballpark; text target ≈ $0.02–0.05 achieved below).

## 1. Closed products

### interviewing.io (the closest big player; highest-value public methodology)

- AI Interviewer: coding + system design, FAANG-style; behavioral is human-only.
  Feedback reports; free practice via 200 book problems (https://interviewing.io,
  https://start.interviewing.io/interview-ai).
- Their real moat is DATA: predictive model trained on ~200k interview outcomes +
  LinkedIn profiles; "AI beats recruiters at resume screening" (2024 post);
  only ~25% of engineers perform consistently across interviews → repeated mocks
  per person are real signal. https://interviewing.io/blog/we-built-a-predictive-model-for-eng-hiring-that-outperforms-both-recruiters-and-ll-ms-want-to-try-it
- No public per-transcript rubric; their grading story is outcome-calibrated, not
  rubric-published. Their interviewer rating system post (Jan 2023) is the eval design
  to mine: https://interviewing.io/blog/our-business-depends-on-having-the-best-interviewers-so-we-built-an-interviewer-rating-system-and-you-can-too
- Adopt: free-unlimited-practice positioning (attractor), structured feedback
  dimensions (problem-solving / communication / tradeoffs — from a $225 mock review:
  https://medium.com/@mockingbird_71808/i-paid-225-for-interviewing-io-was-it-worth-the-money-fbc9aee76acb),
  and the "repeated mocks = signal" argument for our weekly briefing.

### Final Round AI

- $148–150/mo, realtime interview COPILOT (live assist) first, practice second.
  https://www.finalroundai.com/subscription — matches our competitor note in DECISIONS.md
  ("~$148/mo high-ARPU"). Adopt: nothing core; avoid their punish-light-users billing.

### Yoodli

- Speech coach: filler words, pacing (WPM), eye contact, conciseness; roleplay
  rubrics customizable; free tier; credits = sessions >30s. https://yoodli.ai
- Adopt (VOICE version only): dimension-based speech rubric for the benched voice
  interviewer's report.

### Google Interview Warmup — DEAD

- Shut down April 2026, quietly (URL redirects to a generic article).
  https://www.aceround.app/blog/google-interview-warmup-review
- It was: free, field-grounded questions, transcribed spoken answers, highlighted
  job terms + filler words. **Free-tool gap in exactly our bracket — our free text
  interview (waitlist gate per D7) lands in an emptied niche.**

### Employer-side (rubric sources only)

- HireVue / CodeSignal: structured scoring, anchored scales — mine for grader rubric
  shape, not features.

## 2. Open source

### WarlCang/interview-my-project — the direct ancestor, MIT ⭐ (9, v1, 20 commits)

https://github.com/WarlCang/interview-my-project

- EXACTLY our differentiator, already proven as an agent skill: reads your repo +
  mines Claude Code session logs (`~/.claude/projects/`) for pivots, error-fix
  cycles, and diffs approved without discussion; interviewer "assumes it's one more
  vibe-coded project until you prove otherwise."
- Flow: Ingest → Interrogate (ranked question bank: architecture choices, X-over-Y
  tradeoffs, failure modes, scale ceilings) → Drill (terminal, one question at a
  time, follow-up pushes on hand-waving) → Coach (verdict with file:line evidence,
  "Say" model answer, "Avoid" note, "Fix" = repo improvement) → Track
  (`.interview/scorecard.json` persists; shareable 1200×630 readiness card).
- Modes: quick (5q) / deep (12q + data-flow trace) / focus <subsystem> / role
  pm|design|data|eng. Distribution: `npx skills add`, Claude Code plugin, plain SKILL.md.
  Works with Claude Code, Cursor, Codex, Copilot, DeepSeek. Multilingual.
- Currently "markdown plus one HTML template" — ingestion is prompt-driven; real log
  parsing is their v2, voice their v3. MIT.
- **Adopt into S2**: the whole flow shape. We have a stronger grounding source than
  raw log mining — the spine already stores decision records + evidence
  ([D46]-adjacent, S1 machinery). Their Coach stage maps to our grader report;
  their Fix maps to our gap-map writeback. Shareable readiness card = distribution
  idea worth stealing for reports.

### Other practice-side repos (all small; no dominant OSS platform exists)

- Azzedde/aiva_mock_interviews — Firebase + voice agentic platform, auto-feedback.
- StephaneWamba/InterviewLab — LangGraph + LiveKit + FastAPI + Next.js voice prep w/
  code sandbox (architecture reference for the benched voice stack).
- daftpunkwav/real-mock — multi-round voice rooms, BYOK, Next.js + FastAPI.
- 123zhongyi12-sketch/resume-interview-agent — JD → multi-round mocks → scoring report.
- weiyu1029/Interview_Thread_AI — evidence-grounded coach matching resume↔JD.
- RezaSi/go-interview-practice (2.5k★) — Go challenge platform + AI interview sim.
- ccd97/SystemDesign.ai — system-design mock interviewer.
- Topic pages: https://github.com/topics/ai-interviewer, /mock-interview.

### Cheating-side (STT→LLM→overlay; reference only for voice INPUT wiring later)

- ecoute (robchawan), pyk-boo/ai-interview-helper (Groq/Claude/Gemini BYOK), etc.
- Ethics lane: GLaDOS never ships realtime copilot-for-real-interviews (market has
  plenty; reputational + ToS mess). Voice INPUT for practice is separate and fine.

### Voice stacks (for the benched version)

- Retell: $0.07–0.31/min infra+TTS (LLM excluded), 20 concurrent calls included,
  interviewer templates + prompt-engineering guide. https://www.retellai.com/pricing
- Vapi: $0.05/min platform + providers at cost (ElevenLabs ~$0.015–0.024/min TTS).
  https://vapi.ai/pricing
- LiveKit Cloud ~$0.01/min platform fee; self-hosted cascading STT→LLM→TTS
  ≈ $0.04–0.13/agent-min; local STT/TTS models want a GPU (L4/A10 class).
  https://www.assemblyai.com/blog/vapi-vs-pipecat-vs-livekit
- Pipecat: swap-any-layer pipeline framework (most flexible self-host).
- OpenAI Realtime: gpt-realtime-mini audio $10/$20 per 1M tok; real-world
  ≈ $0.04–0.09/min with caching; new gpt-live-1 flat $0.05/min.
  https://developers.openai.com/api/docs/pricing

## 3. Eval harness + golden transcripts

- promptfoo: TypeScript-native, YAML-driven, CLI; rubric/LLM-judge assertions +
  cheap non-LLM asserts; strong CI fit. https://github.com/promptfoo/promptfoo
  (deepeval is Python/pytest — stack mismatch; braintrust is a paid platform.)
- Golden-transcript pattern (locked in our slice definition): fix a set of
  transcripts spanning weak/medium/strong + edge cases (hand-waving, hallucinated
  project, short answers), grade once with human-anchored scores, then
  regression-gate every grader-prompt/model change in CI (promptfoo asserts:
  score deltas ≤ threshold, no hallucinated evidence citations).
- Interviewer-side eval (no golden answers exist): assert programmatically that
  each follow-up cites/grounded in a decision record and pushes on vagueness —
  the interview-my-project Drill mechanic, formalized.
- interviewing.io's lesson: grade the GRADER against outcomes over time (do report
  scores predict user-reported real-interview results?) — telemetry note for later,
  not v1.

## 4. Costs (Oct 2026)

LLM per 1M tokens (input/output):

- DeepSeek V3.2: $0.28 / $0.42 (cheapest good; off-peak discounts exist)
  https://api-docs.deepseek.com/quick_start/pricing
- Gemini 2.5 Flash: $0.30 / $2.50; Flash-Lite $0.10/$0.40; cache read $0.03; 1M ctx
  https://ai.google.dev/gemini-api/docs/pricing
- GLM-4.6: $0.43–0.60 / $1.75–2.20; cache read $0.08 https://openrouter.ai/z-ai/glm-4.6

Text interview token math (15 interviewer turns, ~8k-token grounded prefix, ~10k
transcript, ~2.5k report): roughly 40–60k input + 5–8k output per interview.

- DeepSeek: ≈ $0.015–0.025 → ~20× under our ceiling.
- Gemini Flash: ≈ $0.03–0.05 (caching the grounded prefix helps: 10+ turns reuse).
- GLM-4.6: ≈ $0.04–0.07.
- Even a premium grader call is affordable; the cheap tiers carry the interviewer turns.

STT (voice INPUT, future): Whisper API $0.006/min = $0.18 per 30-min interview;
Deepgram Nova-3 batch $0.0043–0.0052/min; faster-whisper CPU self-host ≈ free at
VPS scale, 0.5–2s latency (fine for non-realtime input).
https://deepgram.com/pricing, https://github.com/SYSTRAN/faster-whisper

Voice interview (benched) per 30-min session:

- OpenAI Realtime: ≈ $1.20–2.70 (realtime-mini, caching)
- Retell/Vapi platform: ≈ $2.10–9.30 + LLM (infra+TTS $0.07–0.31/min)
- Self-hosted LiveKit/Pipecat + API STT/TTS + DeepSeek: ≈ $0.75–1.50 (CPU-only if
  we use API STT/TTS; GPU only if local models) — plus ops burden.
  → Voice is $1–3/interview realistic floor: a premium/energy-bar surface (D28/D29)
  or user-side via MCP plugin on the user's own subscription (D29 split: generation
  user-side, evaluation platform-side). Matches D14 (voice later) — now with numbers.

## 5. morluto/rea — verdict

https://github.com/morluto/rea — MIT, real, ~381k★; reverse-engineers apps AND
websites (live browser observation, HAR/pcap captures) down to binaries via MCP.

- Websites: yes it works, but you get observed BEHAVIOR — DOM, flows, network
  shapes — not the server-side prompts, rubrics, or outcome data where these
  products' value actually lives. Everything extractable for S2 (prompts, rubric
  shapes, flows, licenses permitting) was mined directly from OSS repos above.
- Use for S2: none in the build path. Optional one-off: capture a competitor's
  interview UX flow (e.g. Yoodli roleplay) as behavioral reference. Not a shortcut
  to "all the features figured out" — that part is server-side and unextractable.

## 6. What S2 should take from all this (design-chat input, not decisions)

1. Don't clone a product; mine mechanics. Market = expensive copilots ($148/mo) +
   a dead free tool. Our wedge (project-grounded + evidence-to-spine) stays
   differentiated; interview-my-project proves demand but has no platform/spine.
2. From interview-my-project (MIT): 5-stage flow, ranked question bank over OUR
   decision records, follow-up-on-hand-waving, 🟢🟡🔴 honest scoring, persistent
   scorecard, shareable report card (distribution), role/mode variants.
3. From interviewing.io: free unlimited practice as attractor; report dimensions
   (problem-solving / communication / tradeoffs + groundedness); repeated-mocks-
   are-signal for the briefing.
4. From Yoodli (voice only): speech-dimension rubric.
5. Text-now stack: gateway → cheap tier (DeepSeek V3.2 or Gemini Flash) for
   interviewer turns with cached grounded prefix; grader call on same or slightly
   better model; ≈ $0.02–0.05/interview all-in.
6. Eval: promptfoo (TS-native) wrapping golden transcripts as the regression gate
   (definition-of-done item), + groundedness assertions for interviewer follow-ups.
7. Voice benched: keep the interviewer service text-in/text-out; voice = STT front
   (faster-whisper CPU = free) + TTS back; full realtime via Realtime API or
   Retell/Vapi templates when it un-benches (premium/energy-bar or user-side MCP).
8. Architecture constant across both: generation runs through the gateway (D29);
   every transcript lands in the spine as claim-grade input; platform grading is
   the verdict (source: agent_plugin discipline).
