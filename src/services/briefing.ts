import { db } from "@/lib/db";
import { getConfig } from "@/services/levels";
import { gatewayCall, hashContentForCache } from "@/services/gateway";

// S2 weekly briefing (D50/D85/D88i). Deterministic numbers from plain SQL;
// ONE AI paragraph that wordsmiths, never computes; one CTA from a
// deterministic ladder; writes NOTHING to the spine.

export const BRIEFING_QUEUE = "briefing_weekly";
export const BRIEFING_CRON = "0 9 * * 1"; // Mondays 09:00 UTC

const WEEK_MS = 7 * 86_400_000;
const BRIEFING_UNSUB_KEY = "briefing.unsubscribed";
const BRIEFING_NOTE_FEATURE = "briefing_note";

export interface BriefingBlocks {
  hasActivity: boolean;
  eventsThisWeek: Array<{ label: string; detail: string }>;
  pointsDelta: number;
  levelMoves: Array<{ skill: string; delta: number }>;
  dimensionTrend: Array<{ dimension: string; scores: number[] }>;
  energy: { balance: number; bankDecaying: boolean; earnedThisWeek: boolean };
}

export interface BriefingCta {
  key: string;
  label: string;
}

export interface Briefing {
  userId: string;
  email: string | null;
  blocks: BriefingBlocks;
  cta: BriefingCta | null;
  coachNote: string | null;
}

function isoWeek(now: Date): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const EVENT_LABELS: Record<string, string> = {
  interview_completed: "Mock interview",
  quiz_completed: "Calibration quiz",
  repo_imported: "Repo import",
  certificate_added: "Certificate",
  work_experience_confirmed: "Work experience",
  post_drafted: "LinkedIn draft",
};

export async function computeBriefingBlocks(
  userId: string,
  now: Date = new Date()
): Promise<BriefingBlocks> {
  const since = new Date(now.getTime() - WEEK_MS);

  const [events, energyAccount, reports] = await Promise.all([
    db.eventLog.findMany({
      where: { userId, occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: 50,
    }),
    db.energyAccount.findUnique({ where: { userId } }),
    db.interviewReport.findMany({
      where: { session: { userId }, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        techDepth: true,
        problemSolving: true,
        tradeoffs: true,
        communication: true,
        composure: true,
      },
    }),
  ]);

  const eventsThisWeek = events
    .filter((e) => EVENT_LABELS[e.type])
    .map((e) => ({
      label: EVENT_LABELS[e.type],
      detail: `${e.type} · ${e.points >= 0 ? "+" : ""}${e.points} pts`,
    }));

  const pointsDelta = events.reduce((sum, e) => sum + e.points, 0);

  const bySkill = new Map<string, number>();
  for (const e of events) {
    for (const skillId of e.skills) {
      bySkill.set(skillId, (bySkill.get(skillId) ?? 0) + e.points);
    }
  }
  const skillNames = await db.skill.findMany({
    where: { id: { in: [...bySkill.keys()] } },
    select: { id: true, display: true },
  });
  const nameById = new Map(skillNames.map((s) => [s.id, s.display]));
  const levelMoves = [...bySkill.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([skillId, delta]) => ({
      skill: nameById.get(skillId) ?? skillId,
      delta,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const dimensionTrend: BriefingBlocks["dimensionTrend"] = [];
  if (reports.length > 0) {
    type ReportRow = (typeof reports)[number];
    const dims: Array<[string, keyof ReportRow]> = [
      ["Technical depth", "techDepth"],
      ["Problem solving", "problemSolving"],
      ["Tradeoffs", "tradeoffs"],
      ["Communication", "communication"],
      ["Composure", "composure"],
    ];
    for (const [label, key] of dims) {
      const scores = reports
        .map((r) => r[key])
        .filter((v): v is number => v !== null);
      if (scores.length > 0) dimensionTrend.push({ dimension: label, scores });
    }
  }

  const earnedThisWeek = Boolean(
    energyAccount?.lastEarnedAt &&
    now.getTime() - energyAccount.lastEarnedAt.getTime() < WEEK_MS
  );
  // D36: away ≥2 weeks and banked value decays by design
  const bankDecaying = Boolean(
    energyAccount &&
    energyAccount.balance > 0 &&
    energyAccount.lastGrantDate &&
    now.getTime() - new Date(energyAccount.lastGrantDate).getTime() >
      14 * 86_400_000
  );

  return {
    hasActivity: events.some((e) => e.points > 0),
    eventsThisWeek,
    pointsDelta,
    levelMoves,
    dimensionTrend,
    energy: {
      balance: energyAccount?.balance ?? 0,
      bankDecaying,
      earnedThisWeek,
    },
  };
}

// D85 one-action ladder — deterministic, rules pick; the note only dresses it.
export async function computeBriefingCta(
  userId: string,
  blocks: BriefingBlocks
): Promise<BriefingCta | null> {
  const active = await db.interviewSession.findFirst({
    where: { userId, status: "active" },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    return {
      key: "resume_interview",
      label: "Resume your unfinished interview",
    };
  }
  const lastReport = await db.interviewReport.findFirst({
    where: { session: { userId } },
    orderBy: { createdAt: "desc" },
  });
  if (lastReport) {
    const dims: Array<[string, number | null]> = [
      ["technical depth", lastReport.techDepth],
      ["problem solving", lastReport.problemSolving],
      ["tradeoffs", lastReport.tradeoffs],
      ["communication", lastReport.communication],
      ["composure", lastReport.composure],
    ];
    const scored = dims.filter((d): d is [string, number] => d[1] !== null);
    if (scored.length > 0) {
      scored.sort((a, b) => a[1] - b[1]);
      return {
        key: "practice_dimension",
        label: `Practice ${scored[0][0]} — your lowest dimension — in a quick interview`,
      };
    }
  }
  if (blocks.energy.bankDecaying) {
    return {
      key: "spend_bank",
      label: "Your energy bank is decaying — spend a bar this week",
    };
  }
  const claimedSkill = await db.userSkill.findFirst({
    where: { userId },
    orderBy: { lastEvidencedAt: "asc" },
  });
  if (claimedSkill) {
    return {
      key: "verify_skill",
      label: "Verify a skill with a 5-minute calibration quiz",
    };
  }
  return null;
}

// ONE ≤200-token paragraph. Wordsmiths, never computes: its only inputs are
// the pre-computed blocks; it renders beneath the deterministic numbers, so a
// bad note is awkward, never wrong (D30 family). Cached per user-week (D4).
export async function generateCoachNote(
  userId: string,
  blocks: BriefingBlocks,
  cta: BriefingCta | null,
  now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<string | null> {
  const cacheKey = hashContentForCache(
    "briefing_note",
    JSON.stringify({ userId, week: isoWeek(now) })
  );
  const gw = await gatewayCall(
    {
      userId,
      feature: BRIEFING_NOTE_FEATURE,
      cacheKey,
      skipEnergy: true,
      interactive: true,
      timeoutMs: 60_000,
      messages: [
        {
          role: "system",
          content:
            "You write ONE coach's paragraph (2-3 sentences, ≤60 words) for a job-seeker's weekly briefing. Use ONLY the supplied facts. NEVER introduce a number, skill name, or claim that is not in the facts. Warm, direct, no hype. End by pointing at the single suggested action.",
        },
        {
          role: "user",
          content: JSON.stringify({
            facts: {
              pointsDelta: blocks.pointsDelta,
              levelMoves: blocks.levelMoves.slice(0, 3),
              dimensionTrend: blocks.dimensionTrend.map((d) => ({
                dimension: d.dimension,
                scores: d.scores,
              })),
              energyBalance: blocks.energy.balance,
              earnedThisWeek: blocks.energy.earnedThisWeek,
            },
            suggestedAction: cta?.label ?? null,
          }),
        },
      ],
    },
    fetchImpl
  );
  if (gw.status !== "ok") return null;
  return gw.content.trim().slice(0, 600);
}

export async function isUnsubscribed(userId: string): Promise<boolean> {
  const pref = await db.preference.findUnique({
    where: { userId_key: { userId, key: BRIEFING_UNSUB_KEY } },
  });
  return pref?.value === "true";
}

export async function setUnsubscribed(userId: string, value: boolean) {
  await db.preference.upsert({
    where: { userId_key: { userId, key: BRIEFING_UNSUB_KEY } },
    update: { value: String(value) },
    create: { userId, key: BRIEFING_UNSUB_KEY, value: String(value) },
  });
}

// Resend via plain fetch — no SDK dependency (same API contract). Tests (and
// key-less environments) inject fetchImpl.
export async function sendBriefingEmail(
  to: string,
  subject: string,
  html: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; skipped?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey && !fetchImpl) return { ok: false, skipped: "no RESEND_API_KEY" };
  const impl = fetchImpl ?? fetch;
  const res = await impl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey ?? "test"}`,
    },
    body: JSON.stringify({
      from: process.env.BRIEFING_FROM_EMAIL ?? "briefing@resend.dev",
      to,
      subject,
      html,
    }),
  });
  return { ok: res.ok };
}

function briefingEmailHtml(briefing: Briefing): string {
  const b = briefing.blocks;
  const lines: string[] = [];
  lines.push(
    `<p><strong>This week:</strong> ${b.pointsDelta >= 0 ? "+" : ""}${b.pointsDelta} evidence points.</p>`
  );
  if (b.levelMoves.length > 0) {
    lines.push(
      `<p>${b.levelMoves
        .map((m) => `${m.skill} ${m.delta >= 0 ? "+" : ""}${m.delta}`)
        .join(" · ")}</p>`
    );
  }
  if (b.dimensionTrend.length > 0) {
    const t = b.dimensionTrend[0];
    lines.push(
      `<p>${t.dimension} across your interviews: ${t.scores.join(" → ")}.</p>`
    );
  }
  if (briefing.cta) {
    lines.push(
      `<p><strong>One thing this week:</strong> ${briefing.cta.label}.</p>`
    );
  }
  lines.push(
    `<p><a href="${process.env.APP_URL ?? "https://glados.example"}/this-week">Open your briefing</a></p>`
  );
  lines.push(
    `<p><small><a href="${process.env.APP_URL ?? "https://glados.example"}/this-week?unsubscribe=1">Unsubscribe</a></small></p>`
  );
  return lines.join("\n");
}

export async function buildBriefing(
  userId: string,
  now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<Briefing | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const blocks = await computeBriefingBlocks(userId, now);
  const cta = await computeBriefingCta(userId, blocks);
  const coachNote = await generateCoachNote(
    userId,
    blocks,
    cta,
    now,
    fetchImpl
  ).catch(() => null);
  return { userId, email: user.email, blocks, cta, coachNote };
}

// D85 skip rules: silent on empty weeks, EXCEPT the bank-decay win-back.
export function shouldSendBriefing(
  briefing: Briefing,
  unsubscribed: boolean
): boolean {
  if (unsubscribed) return false;
  if (!briefing.email) return false;
  if (briefing.blocks.energy.bankDecaying) return true;
  return briefing.blocks.hasActivity;
}

export async function runWeeklyBriefing(
  now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<{ sent: number; skipped: number }> {
  const users = await db.user.findMany({
    where: { email: { not: null } },
    select: { id: true },
    take: 500,
  });
  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    const briefing = await buildBriefing(u.id, now, fetchImpl);
    if (!briefing) {
      skipped += 1;
      continue;
    }
    const unsubscribed = await isUnsubscribed(u.id);
    if (!shouldSendBriefing(briefing, unsubscribed)) {
      skipped += 1;
      continue;
    }
    const res = await sendBriefingEmail(
      briefing.email!,
      "Your week in review",
      briefingEmailHtml(briefing),
      fetchImpl
    );
    if (res.ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}
