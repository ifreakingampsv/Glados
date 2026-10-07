"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyTagAction,
  createCandidateAction,
  resolveTagAction,
} from "@/app/actions/skills";
import type { Resolution } from "@/services/skills";

export function SkillTagger() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [level, setLevel] = useState("");
  const [pending, startTransition] = useTransition();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await resolveTagAction(input);
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      if (result.status === "confirm") {
        setResolution(result);
        return;
      }
      const skillId =
        result.status === "candidate" ? result.skillId : result.skillId;
      const applied = await applyTagAction(
        input,
        skillId,
        level ? Number(level) : undefined
      );
      if (!applied.ok) {
        setMessage(applied.message ?? "failed");
        return;
      }
      setInput("");
      setLevel("");
      setResolution(null);
      router.refresh();
    });
  }

  function confirmPick(skillId?: string) {
    startTransition(async () => {
      const applied = skillId
        ? await applyTagAction(
            input,
            skillId,
            level ? Number(level) : undefined
          )
        : await createCandidateAction(input, level ? Number(level) : undefined);
      if (!applied.ok) {
        setMessage(applied.message ?? "failed");
        return;
      }
      setInput("");
      setLevel("");
      setResolution(null);
      router.refresh();
    });
  }

  return (
    <div style={{ margin: "1rem 0" }}>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a skill (e.g. rust, koltin, ts)"
      />
      <select value={level} onChange={(e) => setLevel(e.target.value)}>
        <option value="">no claimed level</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            claim L{n}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !input.trim()}
      >
        Tag
      </button>
      {pending && <span> …</span>}
      {message && <p style={{ color: "#a33" }}>{message}</p>}
      {resolution?.status === "confirm" && (
        <div
          style={{
            border: "1px solid #ccc",
            padding: "0.5rem",
            marginTop: "0.5rem",
          }}
        >
          <p>Did you mean one of these?</p>
          {resolution.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => confirmPick(choice.id)}
            >
              {choice.name} ({choice.kind}, d≤3)
            </button>
          ))}
          <button type="button" onClick={() => confirmPick(undefined)}>
            None of these — create “{resolution.tag}”
          </button>
        </div>
      )}
    </div>
  );
}
