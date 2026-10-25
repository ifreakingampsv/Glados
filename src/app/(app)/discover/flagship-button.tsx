"use client";

// D95/D96b: the flagship handoff button. Fetches the PRE-FILLED prompt from
// the server action (template + repo + the user's skill context — never live
// personalization), copies it, logs the card click, and shows where to paste
// it: the user's own AI, their tokens, platform $0.

import { useState, useTransition } from "react";
import { flagShipPromptAction } from "@/app/actions/discover";

export function FlagshipButton({ repoGithubId }: { repoGithubId: number }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const prompt = await flagShipPromptAction(repoGithubId);
          if (prompt) {
            try {
              await navigator.clipboard.writeText(prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 4000);
            } catch {
              // Clipboard blocked — fall back to a select-and-copy modal-less path.
              window.prompt("Copy your pre-filled flagship prompt:", prompt);
            }
          }
        });
      }}
    >
      {copied
        ? "Copied — paste it into your AI"
        : pending
          ? "Preparing…"
          : "Deep-dive this in your AI"}
    </button>
  );
}
