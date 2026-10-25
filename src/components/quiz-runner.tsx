"use client";

import { useState, useTransition } from "react";
import {
  abandonQuizSessionAction,
  startQuizSessionAction,
  submitQuizRoundAction,
} from "@/app/actions/quiz";
import type {
  QuizQuestionClientView,
  SubmitQuizRoundResult,
} from "@/services/quiz";

export interface QuizRunnerProps {
  skillId: string;
  skillDisplay: string;
  startBand: string;
  startReason: string;
  onCooldown: boolean;
  nextRetakeAtIso: string | null;
}

export function QuizRunner({
  skillId,
  skillDisplay,
  startBand,
  startReason,
  onCooldown,
  nextRetakeAtIso,
}: QuizRunnerProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentBand, setCurrentBand] = useState<string>(startBand);
  const [roundNumber, setRoundNumber] = useState<number>(1);
  const [cap, setCap] = useState<number>(18);
  const [stepNote, setStepNote] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestionClientView[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, number>
  >({});
  const [roundStartMs, setRoundStartMs] = useState<number>(0);
  const [completedResult, setCompletedResult] = useState<Extract<
    SubmitQuizRoundResult,
    { status: "completed" }
  > | null>(null);

  if (onCooldown && nextRetakeAtIso && !completedResult) {
    const retakeDate = nextRetakeAtIso.slice(0, 10);
    return (
      <div className="muted" style={{ fontSize: "0.875rem" }}>
        <span className="badge">Cooldown active</span> Next retake available on{" "}
        <strong className="tabular">{retakeDate}</strong>
      </div>
    );
  }

  if (completedResult) {
    const deltaSign = completedResult.pointsDelta >= 0 ? "+" : "";
    const rawDeltaSign = completedResult.rawDelta >= 0 ? "+" : "";
    return (
      <div
        className="item-row stack"
        style={{ marginTop: "0.5rem", width: "100%" }}
      >
        <div className="row-between">
          <strong>{skillDisplay} calibration complete</strong>
          <span className="badge badge-accent">
            Settled band: {completedResult.settledBand}
          </span>
        </div>
        <p className="muted">
          Final round: {completedResult.roundCorrect} /{" "}
          {completedResult.roundTotal} correct. Updated skill:{" "}
          <strong>
            Evidenced L{completedResult.userSkill.level} (
            {completedResult.userSkill.score.toFixed(2)} pts)
          </strong>
          .
        </p>
        <div className="item-row tabular" style={{ fontSize: "0.875rem" }}>
          <div>
            <strong>Points delta arithmetic:</strong>{" "}
            {completedResult.rawPoints} pts (this session) minus{" "}
            {completedResult.previousRawPoints} pts (previous quiz raw) ={" "}
            {rawDeltaSign}
            {completedResult.rawDelta} raw delta, clamped to{" "}
            <strong>
              {deltaSign}
              {completedResult.pointsDelta} pts
            </strong>{" "}
            written to your append-only event log.
          </div>
          {completedResult.pointsDelta < 0 && (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Lower retake scores write a signed negative delta bounded strictly
              to prior decayed quiz credit, so repository, work-experience, and
              certificate evidence are never reduced.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="stack" style={{ marginTop: "0.35rem" }}>
        {!expanded ? (
          <div className="row">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setExpanded(true)}
            >
              Take 6-question check (free)
            </button>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Starts at {startBand} ({startReason})
            </span>
          </div>
        ) : (
          <div className="item-row stack">
            <div className="row-between">
              <strong>Calibrate {skillDisplay}</strong>
              <span className="badge badge-accent">
                Start band: {startBand}
              </span>
            </div>
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              {startReason}. Rounds of 6 multiple-choice questions step up on 5+
              correct, step down on 2 or fewer, and settle in 1 to 3 rounds
              (hard cap 18 questions). Taking quizzes is free and uncapped.
            </p>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <div className="row">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await startQuizSessionAction(skillId);
                    if (!res.ok) {
                      setError(res.message);
                      return;
                    }
                    setSessionId(res.data.session.id);
                    setCurrentBand(res.data.currentBand);
                    setRoundNumber(res.data.roundNumber);
                    setCap(res.data.cap);
                    setQuestions(res.data.currentRoundQuestions);
                    setSelectedAnswers({});
                    setRoundStartMs(Date.now());
                  });
                }}
              >
                {pending
                  ? "Preparing 6-question round..."
                  : "Start 6-question round"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => setExpanded(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const answeredCount = Object.keys(selectedAnswers).length;
  const allAnswered =
    questions.length > 0 && answeredCount === questions.length;

  return (
    <div
      className="item-row stack"
      style={{ marginTop: "0.5rem", width: "100%" }}
    >
      <div className="row-between">
        <div>
          <strong>
            {skillDisplay} - Round {roundNumber} (Band {currentBand})
          </strong>
        </div>
        <span className="badge tabular">
          Progress: {answeredCount} / {questions.length} answered (max {cap}{" "}
          questions total)
        </span>
      </div>

      {stepNote && (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          {stepNote}
        </p>
      )}

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <ol className="stack" style={{ paddingLeft: "1.25rem" }}>
        {questions.map((q) => (
          <li key={q.id} className="stack" style={{ marginBottom: "0.5rem" }}>
            <div>
              <strong>{q.prompt}</strong>
            </div>
            <div className="stack" style={{ gap: "0.25rem" }}>
              {q.options.map((opt, idx) => (
                <label
                  key={`${q.id}-${idx}`}
                  className="row"
                  style={{ cursor: "pointer", fontWeight: "normal" }}
                >
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    checked={selectedAnswers[q.id] === idx}
                    onChange={() =>
                      setSelectedAnswers((prev) => ({
                        ...prev,
                        [q.id]: idx,
                      }))
                    }
                    style={{ width: "auto" }}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <div className="row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending || !allAnswered}
          onClick={() => {
            setError(null);
            const elapsedPerQuestion = Math.max(
              500,
              Math.round(
                (Date.now() - roundStartMs) / Math.max(1, questions.length)
              )
            );
            const payload = questions.map((q) => ({
              questionId: q.id,
              selectedIndex: selectedAnswers[q.id] ?? 0,
              ms: elapsedPerQuestion,
            }));
            startTransition(async () => {
              const res = await submitQuizRoundAction(sessionId, payload);
              if (!res.ok) {
                setError(res.message);
                return;
              }
              if (res.data.status === "completed") {
                setCompletedResult(res.data);
                setSessionId(null);
              } else {
                setStepNote(
                  `Previous round (${res.data.previousBand}): ${res.data.previousRoundCorrect}/6 correct -> stepped ${res.data.stepDirection} to ${res.data.currentBand}.`
                );
                setCurrentBand(res.data.currentBand);
                setRoundNumber(res.data.roundNumber);
                setQuestions(res.data.currentRoundQuestions);
                setSelectedAnswers({});
                setRoundStartMs(Date.now());
              }
            });
          }}
        >
          {pending ? "Grading round..." : "Submit round"}
        </button>

        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              await abandonQuizSessionAction(sessionId);
              setSessionId(null);
              setExpanded(false);
              setQuestions([]);
              setSelectedAnswers({});
            });
          }}
        >
          Abandon check (no cooldown)
        </button>
      </div>
    </div>
  );
}
