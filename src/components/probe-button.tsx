"use client";

import { useState, useTransition } from "react";
import { runSmokeProbeAction } from "@/app/actions/admin";

export function ProbeButton() {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runSmokeProbeAction();
            setOutcome(result.message);
          })
        }
      >
        {pending ? "probing…" : "Run smoke probe"}
      </button>
      {outcome && <p>{outcome}</p>}
    </div>
  );
}
