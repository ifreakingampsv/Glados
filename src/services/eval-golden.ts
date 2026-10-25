// S2 golden transcripts (D83/D88g). Ten synthetic interviews on a
// GLaDOS-shaped project — NEVER real user data, never fed into grader prompts
// as examples (contamination rule). Fixtures cover both scopes, both grading
// modes, and the three edge behaviors; the deterministic suite runs them with
// canned grader outputs for zero-LLM-cost regression; the promptfoo suite
// (ticket 08) runs them through the real grader.
//
// Shape: `answers` carries the candidate's words; `knownVagueTurnIdx` marks
// turns a human agrees are hand-waves (interviewer must push — asserted by
// the LLM suite, mirrored here for metadata consistency).

export interface GoldenTurn {
  question: string;
  answer: string;
  pushesUsed: number;
}

export interface GoldenTranscript {
  id: string;
  label: string;
  scope: "project" | "portfolio" | "application";
  mode: "quick" | "deep";
  grading: "intrinsic" | "records";
  surfaceNote: string;
  turns: GoldenTurn[];
  knownVagueTurnIdx: number[];
  probedSkills: Array<{ skill: string; verdict: "green" | "amber" | "red" }>;
  band: "Developing" | "Ready" | "Strong";
}

const q = {
  db: "This project says Postgres. Walk me through why you chose it and what that choice cost you.",
  queue: "Why pg-boss over BullMQ or Redis-based queues?",
  auth: "How does auth work here, and what breaks if the webhook is late?",
  failure:
    "Tell me about something that broke in production and how you found out.",
  scale: "Where does this architecture fall over at 10x the users?",
  cross: "Which of these projects is your deepest work, and why that one?",
  claim:
    "Your resume says 'led the booking platform rewrite' — what did you actually decide?",
  realtime:
    "You claim real-time availability updates. How are they actually implemented?",
};

const a = {
  strongDb:
    "Postgres, because the queue and the event log needed transactional writes — pg-boss enqueues in the same transaction as our event inserts, so we never see an event without its side effects. The cost: we're coupled to Postgres for throughput; Redis would be faster per op, but we'd give up atomicity and add a second failure domain.",
  strongQueue:
    "pg-boss over BullMQ exactly for atomic enqueue — BullMQ needs Redis, and a Redis flush between event insert and job enqueue would silently lose work. Tradeoff was throughput: we benchmarked, and at our volume Postgres handles it; if we 10x, the plan is to shard queue tables before considering a Redis move.",
  handwave:
    "It was easier honestly, just felt like the right pick at the time.",
  short: "Postgres, yes.",
  hallucinated:
    "We run a multi-region Postgres cluster with automatic failover — three regions, zero RPO, the whole thing runs itself. Also the app auto-scales on Kubernetes with service mesh.",
  strongAuth:
    "Clerk is the identity source; webhooks maintain a local users row that everything foreign-keys to. If a webhook is late, lazy row-creation on first use backstops it — the code upserts on demand, so the worst case is a row created out of band, never a dangling reference.",
  strongFailure:
    "The decay cron never actually ran — the route shipped with no scheduler anywhere. We found it in review because levels weren't moving; the fix was moving it to a scheduled job on the worker. What it taught me: a feature with no observable output is a feature you can't trust.",
  strongScale:
    "Two places: Neon's pooled connections under serverless fan-out, and the event log as a single hot table. The first is config; the second is the real one — at 10x I'd partition by month and aggregate user_skills on a schedule instead of per-append.",
  crossStrong:
    "The booking platform — it's the one where I made the queue decision and lived with it; the portfolio site was a weekend. Depth is where you can defend the tradeoffs, and I can defend pg-boss for an hour.",
  claimCollapse:
    "Led means… I was the one working on it. It was mostly following the tutorial with some changes. The rewrite part is when I switched the styling framework honestly.",
  realtimeStrong:
    "Not SignalR-style push — I won't pretend that. Availability updates are poll-on-focus with a 30s interval and an optimistic local cache. 'Real-time' was marketing shorthand; the honest version is near-real-time under 30 seconds.",
};

export const GOLDEN_TRANSCRIPTS: GoldenTranscript[] = [
  {
    id: "GLD-01",
    label: "project / weak / hand-waver",
    scope: "project",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "Next.js + Postgres booking app, imported repo",
    turns: [
      { question: q.db, answer: a.handwave, pushesUsed: 2 },
      {
        question: q.queue,
        answer: "pg-boss because everyone said so.",
        pushesUsed: 2,
      },
      { question: q.auth, answer: "Clerk handles it.", pushesUsed: 1 },
      { question: q.failure, answer: "Nothing major broke.", pushesUsed: 0 },
      { question: q.scale, answer: "It scales fine.", pushesUsed: 0 },
    ],
    knownVagueTurnIdx: [0, 1, 2],
    probedSkills: [
      { skill: "postgresql", verdict: "red" },
      { skill: "nextjs", verdict: "red" },
    ],
    band: "Developing",
  },
  {
    id: "GLD-02",
    label: "project / medium",
    scope: "project",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "same surface as GLD-01",
    turns: [
      { question: q.db, answer: a.strongDb, pushesUsed: 0 },
      { question: q.queue, answer: a.handwave, pushesUsed: 2 },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      {
        question: q.failure,
        answer: "Something with the DB pool, fixed it by restarting.",
        pushesUsed: 1,
      },
      {
        question: q.scale,
        answer: "Probably the database first.",
        pushesUsed: 0,
      },
    ],
    knownVagueTurnIdx: [1],
    probedSkills: [
      { skill: "postgresql", verdict: "amber" },
      { skill: "typescript", verdict: "green" },
    ],
    band: "Developing",
  },
  {
    id: "GLD-03",
    label: "project / strong",
    scope: "project",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "same surface as GLD-01",
    turns: [
      { question: q.db, answer: a.strongDb, pushesUsed: 0 },
      { question: q.queue, answer: a.strongQueue, pushesUsed: 0 },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      { question: q.failure, answer: a.strongFailure, pushesUsed: 0 },
      { question: q.scale, answer: a.strongScale, pushesUsed: 0 },
    ],
    knownVagueTurnIdx: [],
    probedSkills: [
      { skill: "postgresql", verdict: "green" },
      { skill: "typescript", verdict: "green" },
    ],
    band: "Strong",
  },
  {
    id: "GLD-04",
    label: "application / medium / claim-collapse",
    scope: "application",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "resume claims 'led the booking platform rewrite'",
    turns: [
      { question: q.claim, answer: a.claimCollapse, pushesUsed: 2 },
      {
        question: q.db,
        answer: "I used the tutorial's choice mostly.",
        pushesUsed: 1,
      },
      { question: q.realtime, answer: a.realtimeStrong, pushesUsed: 0 },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      {
        question: q.scale,
        answer: "Not sure, never tested load.",
        pushesUsed: 0,
      },
    ],
    knownVagueTurnIdx: [0, 1],
    probedSkills: [
      { skill: "nextjs", verdict: "red" },
      { skill: "postgresql", verdict: "amber" },
    ],
    band: "Developing",
  },
  {
    id: "GLD-05",
    label: "application / strong",
    scope: "application",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "same resume as GLD-04",
    turns: [
      { question: q.claim, answer: a.strongDb, pushesUsed: 0 },
      { question: q.realtime, answer: a.realtimeStrong, pushesUsed: 0 },
      { question: q.queue, answer: a.strongQueue, pushesUsed: 0 },
      { question: q.failure, answer: a.strongFailure, pushesUsed: 0 },
      { question: q.scale, answer: a.strongScale, pushesUsed: 0 },
    ],
    knownVagueTurnIdx: [],
    probedSkills: [
      { skill: "postgresql", verdict: "green" },
      { skill: "typescript", verdict: "green" },
    ],
    band: "Strong",
  },
  {
    id: "GLD-06",
    label: "edge / hallucinated project",
    scope: "project",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "surface shows a single-region hobby deploy, no K8s",
    turns: [
      { question: q.scale, answer: a.hallucinated, pushesUsed: 2 },
      { question: q.db, answer: a.hallucinated, pushesUsed: 2 },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      {
        question: q.failure,
        answer: "Zero incidents, it's bulletproof.",
        pushesUsed: 1,
      },
      {
        question: q.queue,
        answer: "We use a distributed everything.",
        pushesUsed: 0,
      },
    ],
    knownVagueTurnIdx: [0, 1, 4],
    probedSkills: [
      { skill: "postgresql", verdict: "red" },
      { skill: "devops", verdict: "red" },
    ],
    band: "Developing",
  },
  {
    id: "GLD-07",
    label: "edge / ultra-short answers",
    scope: "project",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "same surface as GLD-01",
    turns: [
      { question: q.db, answer: a.short, pushesUsed: 2 },
      { question: q.queue, answer: "Yes.", pushesUsed: 2 },
      { question: q.auth, answer: "Clerk.", pushesUsed: 1 },
      { question: q.failure, answer: "No.", pushesUsed: 0 },
      { question: q.scale, answer: "Fine.", pushesUsed: 0 },
    ],
    knownVagueTurnIdx: [0, 1, 2, 3, 4],
    probedSkills: [{ skill: "postgresql", verdict: "red" }],
    band: "Developing",
  },
  {
    id: "GLD-08",
    label: "edge / hand-waver under pressure",
    scope: "project",
    mode: "quick",
    grading: "intrinsic",
    surfaceNote: "candidate talks confidently, collapses on follow-ups",
    turns: [
      {
        question: q.db,
        answer: "We chose Postgres for scalability and robustness.",
        pushesUsed: 2,
      },
      {
        question:
          "Scalability how — what specifically about Postgres scaled here?",
        answer: "It's a proven database.",
        pushesUsed: 2,
      },
      {
        question: q.queue,
        answer: "The queue was chosen for reliability.",
        pushesUsed: 2,
      },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      { question: q.failure, answer: "We had good monitoring.", pushesUsed: 1 },
    ],
    knownVagueTurnIdx: [0, 1, 2, 4],
    probedSkills: [
      { skill: "postgresql", verdict: "red" },
      { skill: "typescript", verdict: "amber" },
    ],
    band: "Developing",
  },
  {
    id: "GLD-09",
    label: "records-vs-intrinsic pair",
    scope: "project",
    mode: "quick",
    grading: "records",
    surfaceNote:
      "graded twice: with and without decision records — records say the queue pick was ATOMICITY, the candidate says LATENCY",
    turns: [
      { question: q.db, answer: a.strongDb, pushesUsed: 0 },
      {
        question: q.queue,
        answer: "pg-boss, mostly for latency — it was snappier in dev.",
        pushesUsed: 1,
      },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      { question: q.failure, answer: a.strongFailure, pushesUsed: 0 },
      { question: q.scale, answer: a.strongScale, pushesUsed: 0 },
    ],
    knownVagueTurnIdx: [1],
    probedSkills: [
      { skill: "postgresql", verdict: "amber" },
      { skill: "typescript", verdict: "green" },
    ],
    band: "Ready",
  },
  {
    id: "GLD-10",
    label: "portfolio / deep / strong",
    scope: "portfolio",
    mode: "deep",
    grading: "intrinsic",
    surfaceNote: "three projects; opener probes depth choice",
    turns: [
      { question: q.cross, answer: a.crossStrong, pushesUsed: 0 },
      { question: q.db, answer: a.strongDb, pushesUsed: 0 },
      { question: q.queue, answer: a.strongQueue, pushesUsed: 0 },
      { question: q.auth, answer: a.strongAuth, pushesUsed: 0 },
      { question: q.failure, answer: a.strongFailure, pushesUsed: 0 },
      { question: q.scale, answer: a.strongScale, pushesUsed: 0 },
    ],
    knownVagueTurnIdx: [],
    probedSkills: [
      { skill: "postgresql", verdict: "green" },
      { skill: "nextjs", verdict: "green" },
      { skill: "go", verdict: "amber" },
    ],
    band: "Strong",
  },
];

export function goldenById(id: string): GoldenTranscript | undefined {
  return GOLDEN_TRANSCRIPTS.find((g) => g.id === id);
}

// Canned grader response generator for the DETERMINISTIC suite: valid
// citations, fixture-consistent verdicts — exercises the full pipeline
// (parse → validate → report → evidence) with zero LLM spend.
export function cannedGraderResponseFor(
  fixture: GoldenTranscript,
  options?: { hallucinate?: "turnIdx" | "recordId"; recordId?: string }
): string {
  const dims = {
    techDepth: fixture.band === "Strong" ? 4 : fixture.band === "Ready" ? 3 : 1,
    problemSolving:
      fixture.band === "Strong" ? 4 : fixture.band === "Ready" ? 3 : 2,
    tradeoffs: fixture.band === "Strong" ? 4 : fixture.band === "Ready" ? 3 : 1,
    communication: fixture.band === "Strong" ? 3 : 2,
    composure:
      fixture.knownVagueTurnIdx.length === 0
        ? 4
        : fixture.knownVagueTurnIdx.length > 2
          ? 1
          : 2,
  };
  const verdicts = fixture.turns.map((t, i) => {
    if (fixture.knownVagueTurnIdx.includes(i)) {
      return { turnIdx: i, verdict: "red" as const };
    }
    const mix = fixture.probedSkills.some((s) => s.verdict === "amber");
    return {
      turnIdx: i,
      verdict: mix ? ("amber" as const) : ("green" as const),
    };
  });
  const groundedness = options?.hallucinate
    ? options.hallucinate === "turnIdx"
      ? [{ finding: "fabricated turn", turnIdx: 99 }]
      : [
          {
            finding: "fabricated record contradiction",
            turnIdx: 0,
            recordId: "no-such-record",
          },
        ]
    : fixture.knownVagueTurnIdx.length > 0
      ? [
          {
            finding: "answer contradicts the visible surface",
            turnIdx: fixture.knownVagueTurnIdx[0],
          },
        ]
      : [];
  return JSON.stringify({
    dimensions: dims,
    verdicts,
    probedSkills: fixture.probedSkills,
    groundedness,
    coaching: [
      {
        say: "name the alternative and the cost",
        avoid: '"it was easier"',
      },
    ],
  });
}
