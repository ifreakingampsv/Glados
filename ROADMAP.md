# GLaDOS Roadmap

> The slice tracker. Design decisions live in `docs/DECISIONS.md`; per-slice contracts
> live in `specs/`; tickets live in `.scratch/<slice-slug>/issues/`. Update status as
> slices move: `backlog → designing → specced → building → shipped`.

## The product in one line

A job-prep ecosystem: one shared user spine (projects + evidenced skills + target job +
preferences + event log) that every feature reads and writes. Full vision: `docs/DECISIONS.md` → "What GLaDOS is".

## Slices

| #   | Slice                                                                                                                                                            | Status                 | Depends on | Spec                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| S0  | Spine: auth, profile, skills+aliases, projects+evidence, target roles, preferences, event log, AI gateway (dual-credential), queue, flags, caps, waitlist gating | **shipped** 2026-10-07 | —          | [specs/s0-spine.md](specs/s0-spine.md) · [.scratch/s0-spine/issues/](.scratch/s0-spine/issues/) |
| S1  | Imports (GitHub + resume parse), public gap map, free resume scanner, resume builder (locked blocks, D9/D20), LinkedIn review + commit→post generator (D22)      | backlog                | S0         | —                                                                                               |
| S2  | Interview AI — text-only, startup mode; eval harness + golden transcripts; MCP server alongside (D29)                                                            | backlog                | S0, S1     | —                                                                                               |
| S3a | OSS recommender (library + spine matching, D17 pipeline)                                                                                                         | backlog                | S0         | —                                                                                               |
| S3b | OSS ingestion MVP (summarize → learning path; rebuild+comparison later)                                                                                          | backlog                | S0, S3a    | —                                                                                               |
| S4  | Study mode (FSRS, dynamic learning notes / pseudo-notes [D39], interview-weakness scheduling); gig directory (D23)                                               | backlog                | S2         | —                                                                                               |
| S5  | Jobs tracker + alerts; user-run automation tools (D12) later                                                                                                     | backlog                | S0         | —                                                                                               |

## Parking lot (decided, not scheduled)

Recruiter view staging (D11: e-portfolio page → recruiter lite → CRM), campus B2B mode
(D15), weekly briefing (parked — owner assigned at S1 design chat, D37),
gamification/productivity suite, public product rename (D18). MCP server is NOT parked —
it ships alongside S2 per D29. **UI/design pass:** recommended as the first ticket of S1
(the free scanner is the first public-facing surface, so polish lands right before the
distribution machine), or as a small "S0.5" after live verification — learner picks at
the S1 design chat.

## Slice workflow (per slice)

1. **Design chat** (VibeWise ON, main checkout): checkpoints → design confirmed.
2. `/grill-with-docs` on the design + DECISIONS.md → fold fixes back.
3. `/to-spec` → `specs/<slice>.md` (must include an **Integration** section).
4. `/to-tickets` → `.scratch/<slice>/issues/` (tracer bullets + blocking edges).
5. **Implementation chat(s)** (VibeWise off): work the frontier of tickets.
6. Update this file's status; `/retro` optional.
