"use client";

import { useRef, useState } from "react";
import { answerTurnAction } from "@/app/actions/interview";

export function InterviewAnswerForm({
  sessionId,
  paused,
}: {
  sessionId: string;
  paused?: boolean;
}) {
  const shownAt = useRef(Date.now());
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        shownAt.current = Date.now();
        try {
          await answerTurnAction(formData);
        } finally {
          setBusy(false);
        }
      }}
      className="stack"
    >
      {paused ? (
        <p role="alert" className="error-text">
          The interviewer stalled — your answer was saved. Submit again to
          continue.
        </p>
      ) : null}
      <input type="hidden" name="sessionId" value={sessionId} />
      <input
        type="hidden"
        name="durationMs"
        value={String(Math.max(0, Date.now() - shownAt.current))}
      />
      <textarea
        name="answer"
        rows={5}
        required
        placeholder="Answer like you would out loud — specifics beat polish."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
      />
      <button type="submit" disabled={busy || value.trim().length === 0}>
        {busy ? "Interviewer is thinking…" : "Send answer"}
      </button>
    </form>
  );
}
