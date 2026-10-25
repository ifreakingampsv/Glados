"use client";

import { useEffect, useRef, useState } from "react";
import { gradeSessionAction } from "@/app/actions/interview";

// Auto-triggers grading once when a completed session is viewed (server
// action; the queue path serves the MCP surface instead).
export function GradeOnView({ sessionId }: { sessionId: string }) {
  const fired = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    setBusy(true);
    const data = new FormData();
    data.set("sessionId", sessionId);
    gradeSessionAction(data).finally(() => setBusy(false));
  }, [sessionId]);

  return (
    <p className="empty-state">
      {busy ? "Grading your session…" : "Waiting to grade…"}
    </p>
  );
}
