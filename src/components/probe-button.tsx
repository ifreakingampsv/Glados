"use client";

import { useState, useTransition } from "react";
import {
  generateDefinitionsAction,
  runSmokeProbeAction,
  runStorageProbeAction,
} from "@/app/actions/admin";

export function ProbeButton() {
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
              const result = await runSmokeProbeAction();
              setOutcome(result.message);
            })
          }
        >
          {pending ? "Probing gateway..." : "Run smoke probe"}
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

export function StorageProbeButton() {
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
              const result = await runStorageProbeAction();
              setOutcome(result.message);
            })
          }
        >
          {pending ? "Probing R2 storage..." : "Run storage probe"}
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

export function GenerateDefinitionsButton({
  initialWithDef,
  totalActive,
}: {
  initialWithDef: number;
  totalActive: number;
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack">
      <div className="row-between">
        <span className="muted tabular">
          {initialWithDef} / {totalActive} active skills have cached definitions
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await generateDefinitionsAction();
              setOutcome(result.message);
            })
          }
        >
          {pending ? "Generating definitions..." : "Generate definitions"}
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
