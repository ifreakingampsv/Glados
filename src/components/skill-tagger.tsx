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
    <div className="stack">
      <div className="row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a skill (e.g. rust, koltin, ts)"
          aria-label="Skill name"
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          aria-label="Claimed skill level"
        >
          <option value="">No claimed level</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              Claim L{n}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={pending || !input.trim()}
        >
          {pending ? "Tagging..." : "Tag skill"}
        </button>
      </div>
      {message && (
        <div className="alert alert-danger" role="alert">
          {message}
        </div>
      )}
      {resolution?.status === "confirm" && (
        <div className="item-row stack">
          <p className="muted">Did you mean one of these skills?</p>
          <div className="row">
            {resolution.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="btn btn-sm"
                onClick={() => confirmPick(choice.id)}
              >
                {choice.name} ({choice.kind}, d&le;3)
              </button>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => confirmPick(undefined)}
            >
              Create new candidate &ldquo;{resolution.tag}&rdquo;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
