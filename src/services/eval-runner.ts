import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import { gradeInterviewSession } from "@/services/interview-grader";
import { GOLDEN_TRANSCRIPTS, goldenById } from "@/services/eval-golden";

// S2 eval runner (D83 as amended by D88g). Runs the golden set through the
// REAL grading pipeline on demand (console button / weekly drift cron) and
// records results + drift history. DEVIATION NOTED (ticket 08): promptfoo is
// not installed — the native runner implements the same contract (on-demand
// LLM run + deterministic asserts already enforced in-pipeline by
// validateGraderOutput); a promptfooconfig can wrap this later without
// product change. Consensus anchoring runs 3 independent gradings per
// fixture (single configured provider — 3-model consensus needs more
// providers live; noted for when routing rows diversify).

export interface EvalRunResult {
  fixtureId: string;
  label: string;
  bands: Array<string | null>; // one per independent grading
  band: string | null; // majority band, null on total failure
  anchorBand: string | null;
  drift: boolean; // majority band differs from anchor
  error?: string;
}

export interface EvalRunSummary {
  runId: string;
  at: string;
  results: EvalRunResult[];
  pendingAdjudication: string[]; // fixture ids with split bands
  autoAnchored: string[];
}

export interface EvalAnchors {
  // fixtureId -> human-confirmed band (rank/band anchors, D83)
  [fixtureId: string]: string;
}

const HISTORY_KEY = "eval.runHistory";
const ANCHORS_KEY = "eval.anchors";
const HISTORY_CAP = 20;

async function setConfigJson(key: string, value: unknown) {
  await db.config.upsert({
    where: { key },
    update: { value: value as never },
    create: { key, value: value as never },
  });
}

export async function getEvalAnchors(): Promise<EvalAnchors> {
  return getConfig<EvalAnchors>(ANCHORS_KEY, {});
}

export async function setEvalAnchor(fixtureId: string, band: string) {
  const anchors = await getEvalAnchors();
  anchors[fixtureId] = band;
  await setConfigJson(ANCHORS_KEY, anchors);
}

export async function getEvalRunHistory(): Promise<EvalRunSummary[]> {
  return getConfig<EvalRunSummary[]>(HISTORY_KEY, []);
}

// Rough pre-run cost estimate from the active grader route — the console
// shows this BEFORE the paid button press (D83/D88g).
export async function estimateEvalRunCostUsd(
  runsPerFixture = 3
): Promise<number> {
  const route = await db.providerRoute.findFirst({
    where: { feature: "interview_grader", isActive: true },
  });
  if (!route) return 0;
  const estTokensPerGrading = 4000; // ~3k in + ~1k out per fixture transcript
  return (
    (GOLDEN_TRANSCRIPTS.length *
      runsPerFixture *
      estTokensPerGrading *
      route.costPer1kUsd) /
    1000
  );
}

async function materializeEvalSession(
  evalUserId: string,
  fixtureId: string
): Promise<string> {
  const fixture = goldenById(fixtureId)!;
  const session = await db.interviewSession.create({
    data: {
      userId: evalUserId,
      scope: fixture.scope,
      mode: fixture.mode,
      status: "completed",
      origin: "web",
      payload: {
        grounding: { projectId: null, projectIds: [], jdId: null },
        groundingPack: {
          scope: fixture.scope,
          project: {
            id: "fixture-project",
            title: "Booking app",
            description: "Next.js + Postgres booking platform",
            skills: ["nextjs", "postgresql", "typescript"],
            links: [],
          },
        },
        questionCount: fixture.turns.length,
        pushCap: 2,
      },
      completedAt: new Date(),
    },
  });
  for (const [i, t] of fixture.turns.entries()) {
    await db.interviewTurn.create({
      data: {
        sessionId: session.id,
        idx: i,
        questionText: t.question,
        answerText: t.answer,
        pushesUsed: t.pushesUsed,
        durationMs: 20000,
      },
    });
  }
  return session.id;
}

async function cleanupEvalUserData(evalUserId: string) {
  await db.interviewReport.deleteMany({
    where: { session: { userId: evalUserId } },
  });
  await db.interviewSession.deleteMany({ where: { userId: evalUserId } });
  await db.eventLog.deleteMany({ where: { userId: evalUserId } });
  await db.userSkill.deleteMany({ where: { userId: evalUserId } });
  await db.usage.deleteMany({ where: { userId: evalUserId } });
  await db.dailyCounter.deleteMany({ where: { userId: evalUserId } });
}

export async function runGoldenSet(options?: {
  runsPerFixture?: number;
  fetchImpl?: typeof fetch;
  skipHistory?: boolean;
}): Promise<EvalRunSummary> {
  const runs = options?.runsPerFixture ?? 3;
  const fetchImpl = options?.fetchImpl;
  const anchors = await getEvalAnchors();

  // Dedicated eval service user keeps synthetic data out of real spines;
  // removed after the run (synthetic scaffolding, not user history).
  let evalUser = await db.user.findUnique({
    where: { clerkId: "eval_golden_runner" },
  });
  if (!evalUser) {
    evalUser = await db.user.create({
      data: { clerkId: "eval_golden_runner" },
    });
  }

  const results: EvalRunResult[] = [];
  const pendingAdjudication: string[] = [];
  const autoAnchored: string[] = [];

  for (const fixture of GOLDEN_TRANSCRIPTS) {
    const bands: Array<string | null> = [];
    let error: string | undefined;
    for (let r = 0; r < runs; r++) {
      const sid = await materializeEvalSession(evalUser.id, fixture.id);
      try {
        const res = await gradeInterviewSession(sid, fetchImpl);
        const report = await db.interviewReport.findUnique({
          where: { sessionId: sid },
        });
        bands.push(report?.readinessBand ?? null);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        bands.push(null);
      }
    }
    const counted = bands.filter((b): b is string => Boolean(b));
    const majority =
      counted.length === 0
        ? null
        : counted.sort(
            (a, b) =>
              counted.filter((x) => x === b).length -
              counted.filter((x) => x === a).length
          )[0];
    const unanimous = counted.length === runs && new Set(counted).size === 1;

    const anchorBand = anchors[fixture.id] ?? null;
    if (unanimous && majority && !anchorBand) {
      // D83 consensus auto-anchor: unanimous verdicts anchor themselves;
      // splits wait for the human (order + band adjudication).
      anchors[fixture.id] = majority;
      autoAnchored.push(fixture.id);
    } else if (!unanimous) {
      pendingAdjudication.push(fixture.id);
    }

    results.push({
      fixtureId: fixture.id,
      label: fixture.label,
      bands,
      band: majority,
      anchorBand,
      drift: Boolean(anchorBand && majority && anchorBand !== majority),
      error,
    });
  }

  if (autoAnchored.length > 0) {
    await setConfigJson(ANCHORS_KEY, anchors);
  }
  await cleanupEvalUserData(evalUser.id);

  const summary: EvalRunSummary = {
    runId: `evalrun_${Date.now()}`,
    at: new Date().toISOString(),
    results,
    pendingAdjudication,
    autoAnchored,
  };
  if (!options?.skipHistory) {
    const history = await getEvalRunHistory();
    history.unshift(summary);
    await setConfigJson(HISTORY_KEY, history.slice(0, HISTORY_CAP));
  }
  return summary;
}

export function summarizeRun(summary: EvalRunSummary) {
  const drifted = summary.results
    .filter((r) => r.drift)
    .map((r) => r.fixtureId);
  const failed = summary.results
    .filter((r) => r.band === null)
    .map((r) => r.fixtureId);
  return {
    runId: summary.runId,
    total: summary.results.length,
    drifted,
    failed,
    pendingAdjudication: summary.pendingAdjudication,
    releaseGate: drifted.length === 0 && failed.length === 0, // D83: gates releases, not commits
  };
}
