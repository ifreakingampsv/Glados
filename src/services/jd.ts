import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { gatewayCall, hashContentForCache } from "@/services/gateway";
import { getConfig } from "@/services/levels";
import { consumeAttractorCap } from "@/services/resume-parse";
import { resolveCanonicalSkillByNameOrAlias } from "@/services/work-experience";

export interface ExtractedJdSkill {
  skillId: string;
  skillName: string;
  skillDisplay: string;
  expectedLevel: number;
  category?: string;
}

export interface JdExtractionResult {
  title: string;
  company: string | null;
  contentHash: string;
  cached: boolean;
  requiredSkills: ExtractedJdSkill[];
}

interface RawGatewayJdPayload {
  title?: string;
  company?: string | null;
  requirements?: Array<{
    name?: string;
    expectedLevel?: number;
    category?: string;
  }>;
}

async function resolveJdRequirementSkills(
  rawRequirements: NonNullable<RawGatewayJdPayload["requirements"]>,
  rawText: string
): Promise<ExtractedJdSkill[]> {
  const bySkillId = new Map<string, ExtractedJdSkill>();

  for (const req of rawRequirements) {
    if (!req.name) continue;
    const skillId = await resolveCanonicalSkillByNameOrAlias(req.name);
    if (!skillId) continue;
    const skillRow = await db.skill.findUnique({ where: { id: skillId } });
    if (!skillRow || skillRow.status === "RETIRED") continue;

    const expectedLevel = Math.min(
      5,
      Math.max(1, Math.round(req.expectedLevel ?? 3))
    );
    const existing = bySkillId.get(skillRow.id);
    if (!existing || expectedLevel > existing.expectedLevel) {
      bySkillId.set(skillRow.id, {
        skillId: skillRow.id,
        skillName: skillRow.name,
        skillDisplay: skillRow.display,
        expectedLevel,
        category: req.category,
      });
    }
  }

  // Fallback deterministic scan over active canonical skills if gateway returned 0 resolvable items
  if (bySkillId.size === 0) {
    const lower = rawText.toLowerCase();
    const activeSkills = await db.skill.findMany({
      where: { status: "ACTIVE" },
    });
    for (const s of activeSkills) {
      if (
        lower.includes(s.name.toLowerCase()) ||
        lower.includes(s.display.toLowerCase())
      ) {
        bySkillId.set(s.id, {
          skillId: s.id,
          skillName: s.name,
          skillDisplay: s.display,
          expectedLevel: 3,
        });
      }
    }
  }

  return Array.from(bySkillId.values());
}

export async function extractJdRequirementsTransient(
  rawText: string,
  options: {
    userId?: string | null;
    rateLimitId?: string;
    skipDailyCap?: boolean;
    gatewayFetch?: typeof fetch;
  } = {}
): Promise<JdExtractionResult> {
  const cleanedText = rawText.trim();
  if (!cleanedText) {
    throw new Error("Job description text is required.");
  }

  const bucketId = options.rateLimitId ?? options.userId ?? "anonymous";
  if (!options.skipDailyCap) {
    await consumeAttractorCap(bucketId, "jd_scan", 5);
  }

  const normalized = cleanedText.replace(/\s+/g, " ").trim();
  const contentHash = crypto
    .createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex");
  const cacheKey = hashContentForCache("jd_extract", normalized);

  const gwRes = await gatewayCall(
    {
      userId: options.userId ?? bucketId,
      feature: "jd_extract",
      cacheKey,
      skipEnergy: true,
      interactive: true,
      messages: [
        {
          role: "system",
          content:
            "Extract job description requirements as JSON with keys: title, company, requirements ([{name, expectedLevel (1-5), category}]). Expand broad skill categories into specific canonical technologies where appropriate. Respond with JSON only.",
        },
        {
          role: "user",
          content: cleanedText,
        },
      ],
    },
    options.gatewayFetch
  );

  if (gwRes.status !== "ok") {
    throw new Error(gwRes.message);
  }

  let parsedPayload: RawGatewayJdPayload = {};
  try {
    const jsonStr = gwRes.content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    parsedPayload = JSON.parse(jsonStr) as RawGatewayJdPayload;
  } catch {
    parsedPayload = {};
  }

  const requiredSkills = await resolveJdRequirementSkills(
    parsedPayload.requirements ?? [],
    cleanedText
  );

  return {
    title: parsedPayload.title?.trim() || "Target Role",
    company: parsedPayload.company?.trim() || null,
    contentHash,
    cached: Boolean(gwRes.cached),
    requiredSkills,
  };
}

export async function getJdSoftCap(): Promise<number> {
  const raw = await getConfig<number | { maxPerUser?: number }>(
    "jd.softCap",
    20
  );
  if (typeof raw === "number") return raw;
  return raw?.maxPerUser ?? 20;
}

export async function createJobDescription(
  userId: string,
  input: {
    title?: string;
    company?: string;
    rawText: string;
  },
  options: {
    skipDailyCap?: boolean;
    gatewayFetch?: typeof fetch;
  } = {}
) {
  const extracted = await extractJdRequirementsTransient(input.rawText, {
    userId,
    skipDailyCap: options.skipDailyCap,
    gatewayFetch: options.gatewayFetch,
  });

  const softCap = await getJdSoftCap();

  const created = await db.jobDescription.create({
    data: {
      userId,
      title: input.title?.trim() || extracted.title,
      company: input.company?.trim() || extracted.company,
      rawText: input.rawText.trim(),
      contentHash: extracted.contentHash,
      requiredSkills:
        extracted.requiredSkills as unknown as Prisma.InputJsonValue,
    },
  });

  // FIFO prune oldest JDs when user exceeds softCap (D61)
  const allForUser = await db.jobDescription.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });

  if (allForUser.length > softCap) {
    const toDeleteIds = allForUser.slice(softCap).map((r) => r.id);
    await db.jobDescription.deleteMany({
      where: { id: { in: toDeleteIds }, userId },
    });
  }

  return created;
}

export function listJobDescriptions(userId: string) {
  return db.jobDescription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getJobDescription(userId: string, jdId: string) {
  const row = await db.jobDescription.findFirst({
    where: { id: jdId, userId },
  });
  if (!row) throw new Error("job description not found");
  return row;
}

export async function deleteJobDescription(userId: string, jdId: string) {
  const row = await getJobDescription(userId, jdId);
  await db.jobDescription.delete({ where: { id: row.id } });
}

export function getTotalJobDescriptionCount(): Promise<number> {
  return db.jobDescription.count();
}
