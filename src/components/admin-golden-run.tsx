"use client";

import { useState, useTransition } from "react";
import { runGoldenSetAction } from "@/app/actions/admin";

// D83/D88g grader-eval panel trigger. The run is PAID (real grader calls ×
// fixtures × 3 gradings) — the estimate is displayed before the press.
export function GoldenRunButton({ estimateUsd }: { estimateUsd: number }) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack">
      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await runGoldenSetAction();
              setOutcome(result.message);
            })
          }
        >
          {pending
            ? "Grading the golden set (paid run)…"
            : `Run golden set — est. $${estimateUsd.toFixed(3)}`}
        </button>
      </div>
      {outcome && (
        <div className="alert" role="status">
          {outcome}
        </div>
      )}
    </div>
  );
}
