"use client";

import { useState, useTransition } from "react";
import {
  applyReplayMaintenanceAction,
  generateQuizBanksNowAction,
  runWhatIfReplayAction,
} from "@/app/actions/admin";
import type { WhatIfReplayResult } from "@/services/replay";

export function GenerateQuizBanksForm({
  leafSkills,
}: {
  leafSkills: Array<{ id: string; display: string }>;
}) {
  const [selectedSkillId, setSelectedSkillId] = useState<string>(
    leafSkills[0]?.id ?? ""
  );
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (leafSkills.length === 0) {
    return (
      <p className="empty-state">
        No canonical leaf skills available for bank generation.
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <select
          aria-label="Leaf skill for quiz bank generation"
          value={selectedSkillId}
          onChange={(e) => setSelectedSkillId(e.target.value)}
        >
          {leafSkills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || !selectedSkillId}
          onClick={() =>
            startTransition(async () => {
              const res = await generateQuizBanksNowAction(selectedSkillId);
              setOutcome(res.message);
            })
          }
        >
          {pending ? "Generating 3 band banks..." : "Generate banks now"}
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

export function WhatIfReplayPanel({
  initialPoints,
  initialSourceWeights,
  applyEnabled,
}: {
  initialPoints: Record<string, number>;
  initialSourceWeights: Record<string, number>;
  applyEnabled: boolean;
}) {
  const [pointsDraft, setPointsDraft] =
    useState<Record<string, number>>(initialPoints);
  const [weightsDraft, setWeightsDraft] =
    useState<Record<string, number>>(initialSourceWeights);
  const [replayResult, setReplayResult] = useState<WhatIfReplayResult | null>(
    null
  );
  const [applyOutcome, setApplyOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editablePointKeys = [
    "repo_imported",
    "work_experience_added",
    "certificate_added",
    "quiz_completed",
    "project_tagged",
  ];

  return (
    <div className="stack">
      <p className="muted">
        Edit candidate event weights below and run an on-the-fly replay over the
        real append-only event log. Level changes caused by the L3 corroboration
        cap are surfaced explicitly before any apply.
      </p>

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        {editablePointKeys.map((key) => (
          <label
            key={key}
            className="stack"
            style={{ fontSize: "0.85rem", minWidth: "150px" }}
          >
            <code>{key}</code>
            <input
              type="number"
              step="1"
              value={pointsDraft[key] ?? 0}
              onChange={(e) =>
                setPointsDraft((prev) => ({
                  ...prev,
                  [key]: Number(e.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        {Object.entries(weightsDraft).map(([srcKey, val]) => (
          <label
            key={srcKey}
            className="stack"
            style={{ fontSize: "0.85rem", minWidth: "120px" }}
          >
            <code>source:{srcKey}</code>
            <input
              type="number"
              step="0.1"
              value={val}
              onChange={(e) =>
                setWeightsDraft((prev) => ({
                  ...prev,
                  [srcKey]: Number(e.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {applyOutcome && (
        <div className="alert" role="status">
          {applyOutcome}
        </div>
      )}

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => {
            setError(null);
            setApplyOutcome(null);
            startTransition(async () => {
              const res = await runWhatIfReplayAction({
                pointsTypes: pointsDraft,
                sourceWeights: weightsDraft,
              });
              if (!res.ok) {
                setError(res.message);
                return;
              }
              setReplayResult(res.data);
            });
          }}
        >
          {pending ? "Replaying event log..." : "Run what-if replay diff"}
        </button>

        {applyEnabled && replayResult && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await applyReplayMaintenanceAction({
                  pointsTypes: pointsDraft,
                  sourceWeights: weightsDraft,
                });
                if (!res.ok) {
                  setError(res.message);
                  return;
                }
                setApplyOutcome(
                  `Guarded maintenance apply complete: persisted [${res.data.persistedConfigKeys.join(", ")}] and rebuilt ${res.data.rebuiltUserSkillCount} user_skills cell(s).`
                );
              });
            }}
          >
            {pending
              ? "Running bulk rebuild..."
              : "Apply & bulk-rebuild user_skills (maintenance job)"}
          </button>
        )}
      </div>

      {replayResult && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <div>
            <h3>
              Per-skill replay diff ({replayResult.totalCellsEvaluated}{" "}
              user-skill cells evaluated)
            </h3>
            {replayResult.perSkillDiffs.length === 0 ? (
              <p className="empty-state">
                No evidenced user-skill cells found in the event log.
              </p>
            ) : (
              <ul className="item-list">
                {replayResult.perSkillDiffs.map((row) => (
                  <li key={row.skillId} className="item-row row-between">
                    <div className="row">
                      <strong>{row.skillDisplay}</strong>
                      <span className="muted tabular">
                        ({row.userCount} user(s))
                      </span>
                    </div>
                    <div className="row tabular">
                      <span>
                        Avg score: {row.avgCurrentScore.toFixed(2)} -&gt;{" "}
                        {row.avgHypotheticalScore.toFixed(2)} (
                        {row.avgScoreDelta >= 0 ? "+" : ""}
                        {row.avgScoreDelta.toFixed(2)})
                      </span>
                      <span className="badge">
                        {row.levelChangedUsers} level change(s)
                      </span>
                      <span className="badge badge-warn">
                        L3 clamped: {row.clampedUsersCurrent} -&gt;{" "}
                        {row.clampedUsersHypothetical}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3>
              Corroboration cap (L3 clamp) effect rows (
              {replayResult.clampEffectRows.length})
            </h3>
            {replayResult.clampEffectRows.length === 0 ? (
              <p className="empty-state">
                No cells clamped by the L3 single-source corroboration cap under
                the hypothetical weights.
              </p>
            ) : (
              <ul className="item-list">
                {replayResult.clampEffectRows.map((clampRow, idx) => (
                  <li
                    key={`${clampRow.skillId}-${idx}`}
                    className="item-row row-between"
                  >
                    <div className="row">
                      <strong>{clampRow.skillDisplay}</strong>
                      <span className="badge badge-warn">
                        Raw L{clampRow.unclampedLevel} -&gt; Clamped L
                        {clampRow.clampedLevel}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      {clampRow.hypotheticalScore.toFixed(2)} pts ·{" "}
                      {clampRow.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
