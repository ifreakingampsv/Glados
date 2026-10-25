# GLaDOS Interview — agent skill

Run GLaDOS mock interviews from your own harness (Antigravity, ZCode, Claude
Code, Cursor, or any MCP-capable agent). Your model runs the conversation on
YOUR tokens; the platform grades the transcript and writes calibrated skill
evidence to your spine.

## Setup (one-time, ~2 minutes)

1. Create an API token in GLaDOS: **Settings → API tokens** (shown once —
   copy it).
2. Add the GLaDOS MCP server to your harness config:

   ```json
   {
     "mcpServers": {
       "glados-interview": {
         "url": "https://YOUR-GLADOS-DEPLOYMENT/api/mcp",
         "headers": { "Authorization": "Bearer gldos_YOUR_TOKEN" }
       }
     }
   }
   ```

3. Ask your agent: _"Run my GLaDOS startup interview — quick mode, on my
   main project."_

**What just happened (worth knowing):** MCP is a standard way for your agent
to call tools on other services. Your token authorizes ONLY your account —
every call is scoped to your spine. Nothing your agent generates counts as
evidence until the platform's grader scores it; that's the trust split.

## The interview protocol

1. `get_spine_snapshot` — read the coaching context (projects, evidenced
   levels, target role).
2. `start_interview_session` — get the question bank + policy.
3. Deliver questions ONE AT A TIME. Persona: a founding engineer who assumes
   the project is vibe-coded until proven otherwise.
4. **Push on vagueness by naming it** ("easier than WHAT? name the
   alternative"), at most `pushCap` times per question — then move on.
5. `submit_interview_transcript` — one call, all turns.
6. Poll `get_interview_report` — verdicts arrive after platform grading
   (over the daily cap: graded next UTC day, never lost).
7. Offer decision records: for choices the user defended well, ASK, then
   `save_decision_record` with `userConfirmed: true` only after they agree.

## Experimental: voice (optional)

If your harness supports live audio, you may read questions aloud and accept
spoken answers — transcribe into the same transcript. Your audio, your
tokens; nothing changes platform-side. Text always works.

## Rules your agent must follow

- NEVER fabricate transcript content — submit only what the user actually
  said.
- NEVER write evidence on the platform's behalf: there is no tool for it, by
  design.
- The bank comes from the platform — don't invent your own questions.
