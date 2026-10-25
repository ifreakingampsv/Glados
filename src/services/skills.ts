import { db, type UserSkill } from "@/lib/db";
import type { Source } from "@/lib/auth";
import { appendEvent } from "@/services/events";
import { resolveSkillId } from "@/lib/skill-resolution";

// ---------- normalization (D33a) ----------

// Common lookalikes that NFKD does NOT fold to ASCII (Cyrillic а ≠ Latin a
// under decomposition, so it would be stripped rather than folded).
const HOMOGLYPHS: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ѕ: "s",
  ј: "j",
  ԁ: "d",
  ɡ: "g",
  ѵ: "v",
  ա: "a",
};

// Lowercase, strip punctuation (tech chars +# kept), fold homoglyphs:
// "react" typed with a Cyrillic с must resolve like the real thing.
export function normalizeTag(input: string): string {
  const folded = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/./g, (ch) => HOMOGLYPHS[ch] ?? ch);
  return folded.replace(/[^a-z0-9+#]/gi, "").toLowerCase();
}

// Damerau-style edit distance (OSA): an adjacent transposition ("koltin" →
// "kotlin") costs 1, not 2 — required for the D24 typo auto-accept to work.
export function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, (_, j) => j)
  );
  for (let i = 1; i <= a.length; i++) dp[i][0] = i;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1] &&
        a[i - 1] !== a[i - 2]
      ) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

// ---------- resolution ladder (D24 as amended by D33a) ----------

export const FUZZY_MAX_DISTANCE = 3;
export const AUTO_ACCEPT_MIN_LENGTH = 4;

export interface ResolutionChoice {
  id: string;
  name: string;
  kind: "canonical" | "alias" | "candidate";
}

export type Resolution =
  | { status: "resolved"; skillId: string; name: string }
  | { status: "confirm"; choices: ResolutionChoice[]; tag: string }
  | { status: "candidate"; skillId: string; name: string; created: boolean };

type PoolEntry = ResolutionChoice;

async function resolutionPool() {
  const [skills, aliases] = await Promise.all([
    db.skill.findMany({ where: { status: { in: ["ACTIVE", "CANDIDATE"] } } }),
    db.skillAlias.findMany(),
  ]);
  const pool: PoolEntry[] = skills.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.status === "CANDIDATE" ? "candidate" : "canonical",
  }));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  for (const alias of aliases) {
    const target = skillById.get(alias.skillId);
    if (target && target.status === "ACTIVE") {
      pool.push({ id: alias.skillId, name: alias.alias, kind: "alias" });
    }
  }
  return pool;
}

export async function resolveTag(input: string): Promise<Resolution> {
  const tag = normalizeTag(input);
  if (!tag) throw new Error("empty tag");

  const canonical = await db.skill.findFirst({
    where: { name: tag, status: "ACTIVE" },
  });
  if (canonical)
    return { status: "resolved", skillId: canonical.id, name: canonical.name };

  const alias = await db.skillAlias.findUnique({ where: { alias: tag } });
  if (alias) {
    const target = await db.skill.findUnique({ where: { id: alias.skillId } });
    if (target && target.status === "ACTIVE") {
      return { status: "resolved", skillId: target.id, name: target.name };
    }
  }

  const candidate = await db.skill.findFirst({
    where: { name: tag, status: "CANDIDATE" },
  });
  if (candidate) {
    return {
      status: "candidate",
      skillId: candidate.id,
      name: candidate.name,
      created: false,
    };
  }

  const pool = await resolutionPool();
  const matches = pool
    .map((entry) => ({ entry, distance: editDistance(tag, entry.name) }))
    .filter((m) => m.distance <= FUZZY_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance);

  if (matches.length === 0) {
    const created = await db.skill.create({
      data: { name: tag, display: input.trim(), status: "CANDIDATE" },
    });
    return {
      status: "candidate",
      skillId: created.id,
      name: created.name,
      created: true,
    };
  }

  // D33a: auto-accept distance ≤1 ONLY for normalized strings ≥4 chars —
  // "ts" must never silently become "js".
  const nearest = matches[0];
  if (nearest.distance <= 1 && tag.length >= AUTO_ACCEPT_MIN_LENGTH) {
    return {
      status: "resolved",
      skillId: nearest.entry.id,
      name: nearest.entry.name,
    };
  }

  return {
    status: "confirm",
    tag,
    choices: matches.slice(0, 5).map((m) => m.entry),
  };
}

// ---------- strict resolution (D96a: S3a enrich-time tagging) ----------

// Read-only variant of the ladder: an unmatched tag NEVER creates a candidate
// (a cron cannot click confirm chips, and the night job must not flood the
// admin promotion queue), and candidates never auto-tag a repo. The night
// pipeline accepts ONLY "resolved" outcomes and counts everything else into
// the top-unmatched readout.
export type StrictResolution =
  | { status: "resolved"; skillId: string; name: string }
  | { status: "unresolved" };

export async function resolveTagStrict(
  input: string
): Promise<StrictResolution> {
  const tag = normalizeTag(input);
  if (!tag) return { status: "unresolved" };

  const canonical = await db.skill.findFirst({
    where: { name: tag, status: "ACTIVE" },
  });
  if (canonical)
    return { status: "resolved", skillId: canonical.id, name: canonical.name };

  const alias = await db.skillAlias.findUnique({ where: { alias: tag } });
  if (alias) {
    const target = await db.skill.findUnique({ where: { id: alias.skillId } });
    if (target && target.status === "ACTIVE") {
      return { status: "resolved", skillId: target.id, name: target.name };
    }
  }

  const pool = await resolutionPool();
  const matches = pool
    .filter((entry) => entry.kind !== "candidate")
    .map((entry) => ({ entry, distance: editDistance(tag, entry.name) }))
    .filter((m) => m.distance <= FUZZY_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance);
  if (matches.length === 0) return { status: "unresolved" };

  // D33a auto-accept zone only — the 2–3 confirm zone and candidates stay
  // unresolved at enrich time.
  const nearest = matches[0];
  if (nearest.distance <= 1 && tag.length >= AUTO_ACCEPT_MIN_LENGTH) {
    return {
      status: "resolved",
      skillId: nearest.entry.id,
      name: nearest.entry.name,
    };
  }
  return { status: "unresolved" };
}

// ---------- tagging ----------

export interface TagOptions {
  confirmedSkillId?: string; // user picked from the confirm chip
  claimedLevel?: number; // self-rating 1–5, stored separately (D24)
  source?: Source; // auth-channel derived (D35); web actions default
}

export async function tagSkill(
  userId: string,
  input: string,
  options: TagOptions = {}
): Promise<UserSkill> {
  let skillId: string;
  if (options.confirmedSkillId) {
    skillId = options.confirmedSkillId;
  } else {
    const resolution = await resolveTag(input);
    if (resolution.status === "confirm") {
      throw new Error("confirmation required: ambiguous tag");
    }
    skillId = resolution.skillId;
  }
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill || skill.status === "RETIRED")
    throw new Error("skill not taggable");

  let claimedLevel: number | undefined;
  if (options.claimedLevel !== undefined) {
    if (
      !Number.isInteger(options.claimedLevel) ||
      options.claimedLevel < 1 ||
      options.claimedLevel > 5
    ) {
      throw new Error("claimed level must be an integer 1–5");
    }
    claimedLevel = options.claimedLevel;
  }

  const userSkill = await db.userSkill.upsert({
    where: { userId_skillId: { userId, skillId } },
    update: claimedLevel !== undefined ? { claimedLevel } : {},
    create: { userId, skillId, claimedLevel: claimedLevel ?? null },
  });

  // History lives in the log (D25 division); claims carry zero points.
  await appendEvent({
    userId,
    source: options.source ?? "web",
    type: "skill_tagged",
    skills: [skill.id],
    payload: {
      firstTag: userSkill.createdAt.getTime() === userSkill.updatedAt.getTime(),
    },
  });
  return userSkill;
}

export async function createCandidateFromTag(userId: string, input: string) {
  await tagSkill(userId, input, {}); // throws if a confirm is pending — explicit "create new" only
  const tag = normalizeTag(input);
  const existing = await db.skill.findFirst({ where: { name: tag } });
  if (existing) {
    if (existing.status === "RETIRED") throw new Error("skill name retired");
    return existing;
  }
  return db.skill.create({
    data: { name: tag, display: input.trim(), status: "CANDIDATE" },
  });
}

// ---------- read-side resolution (D33b: merges never orphan rows) ----------

export { resolveSkillId } from "@/lib/skill-resolution";

export function listUserSkills(userId: string) {
  return db.userSkill.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

// Read-side join for history/briefing: event rows reference skill IDs that may
// have been merged away; resolve through aliasOf to the canonical display.
export async function resolveEventSkillDisplays(
  eventSkills: string[]
): Promise<string[]> {
  const resolved: string[] = [];
  for (const id of eventSkills) {
    try {
      const canonicalId = await resolveSkillId(id);
      const skill = await db.skill.findUnique({ where: { id: canonicalId } });
      resolved.push(skill?.display ?? canonicalId);
    } catch {
      resolved.push(id);
    }
  }
  return resolved;
}
