"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveTagAction } from "@/app/actions/skills";
import { addProjectSkillAction } from "@/app/actions/projects";
import type { Resolution } from "@/services/skills";

export function ProjectSkillEditor({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const resolved = await resolveTagAction(input);
      if (resolved.status === "error") {
        setMessage(resolved.message);
        return;
      }
      if (resolved.status === "confirm") {
        setResolution(resolved);
        return;
      }
      const applied = await addProjectSkillAction(projectId, input, {
        confirmedSkillId: resolved.skillId,
      });
      if (!applied.ok) {
        setMessage(applied.message ?? "failed");
        return;
      }
      setInput("");
      setResolution(null);
      router.refresh();
    });
  }

  function confirmPick(skillId?: string) {
    startTransition(async () => {
      const applied = skillId
        ? await addProjectSkillAction(projectId, input, {
            confirmedSkillId: skillId,
          })
        : await addProjectSkillAction(projectId, input, {
            createCandidate: true,
          });
      if (!applied.ok) {
        setMessage(applied.message ?? "failed");
        return;
      }
      setInput("");
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
          placeholder="Add skill to project (e.g. typescript, react)"
          aria-label="Project skill"
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={submit}
          disabled={pending || !input.trim()}
        >
          {pending ? "Adding..." : "Add skill"}
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
