/**
 * S2 voice-stack cost bench (D87/D88h) — ON-DEMAND ONLY.
 *
 * The benched voice stack is a living artifact, not shipped product: this
 * script is the bench. Each real run bills provider minutes (Retell/Vapi
 * bill per minute; OpenAI Realtime per token) — which is why it prints the
 * plan and estimated costs FIRST and requires --live to spend anything.
 *
 * Without --live: prints the bench plan + per-stack cost model from the
 * Oct 2026 prior-art research (docs/prior-art/interview-ai.md). With --live
 * and the matching env keys set: runs one golden transcript through each
 * configured stack end-to-end and prints measured $/session.
 *
 * Un-bench ladder (D87): rung 1 = harness voice via the MCP skill file
 * (user tokens, zero platform cost); rung 2 = platform voice as a premium
 * surface, gated on paying users + the report-page demand button.
 */

const STACKS = [
  {
    name: "OpenAI Realtime (gpt-realtime-mini)",
    perSession: [1.2, 2.7],
    env: ["OPENAI_API_KEY"],
  },
  {
    name: "Retell / Vapi (platform + TTS + LLM)",
    perSession: [2.1, 9.3],
    env: ["RETELL_API_KEY", "VAPI_API_KEY"],
  },
  {
    name: "Self-hosted Pipecat + API STT/TTS + cheap LLM",
    perSession: [0.75, 1.5],
    env: ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"],
  },
] as const;

function plan() {
  console.log("Voice cost bench — plan (no spend)\n");
  console.log("Method: one golden transcript (GLD-03), 6 turns, ~10 min audio");
  console.log(
    "equivalent, through each stack end-to-end; measured $/session.\n"
  );
  for (const stack of STACKS) {
    const [lo, hi] = stack.perSession;
    const keys = stack.env.filter((k) => Boolean(process.env[k]));
    console.log(
      `  ${stack.name}\n    est. $${lo.toFixed(2)}–${hi.toFixed(2)}/session ` +
        `(prior art, Oct 2026)\n    live keys: ${keys.length ? keys.join(", ") : "NONE — pass --live only after setting " + stack.env.join(", ")}\n`
    );
  }
  console.log(
    "Text floor for comparison: ~$0.02–0.05/interview (interview_turn route).\n" +
      "Run with --live to execute (bills real provider minutes)."
  );
}

async function main() {
  const live = process.argv.includes("--live");
  if (!live) {
    plan();
    return;
  }
  console.error(
    "Live bench not wired: requires per-stack adapters + paid keys.\n" +
      "The spike exit memo (docs/prior-art + D87 amendment) governs when this\n" +
      "becomes worth wiring — until then the plan above is the bench."
  );
  process.exit(2);
}

void main();
