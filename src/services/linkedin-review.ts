import { db } from "@/lib/db";
import { gatewayCall, hashContentForCache } from "@/services/gateway";
import {
  consumeAttractorCap,
  LINKEDIN_PDF_GUIDE_COPY,
  parseResumeOrLinkedinTransient,
  type ParsedResumeDocument,
  type TransientParseAdapters,
} from "@/services/resume-parse";

export { LINKEDIN_PDF_GUIDE_COPY };

export interface LinkedinReviewRecommendations {
  headlineScore: number;
  summaryFeedback: string;
  add: string[];
  post: string[];
  visibility: string[];
}

export interface LinkedinReviewInput {
  userId: string;
  targetRoles: string | string[];
  pdfBytes?: Uint8Array | Buffer;
  rawText?: string;
  parsedProfile?: ParsedResumeDocument;
}

export interface LinkedinReviewResult {
  parsed: ParsedResumeDocument;
  targetRoles: string[];
  cacheKey: string;
  cached: boolean;
  recommendations: LinkedinReviewRecommendations;
}

function isUrlInput(raw?: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^(www\.)?linkedin\.com\/in\/\S+$/i.test(trimmed)) return true;
  return false;
}

function normalizeTargetRoles(roles: string | string[]): string[] {
  const list = Array.isArray(roles) ? roles : roles.split(",");
  const cleaned = list.map((r) => r.trim()).filter((r) => r.length > 0);
  return cleaned.length > 0 ? cleaned : ["Software Engineer"];
}

function normalizeReviewOutput(
  rawContent: string,
  parsed: ParsedResumeDocument,
  targetRoles: string[]
): LinkedinReviewRecommendations {
  try {
    const cleaned = rawContent
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const obj = JSON.parse(cleaned) as Partial<LinkedinReviewRecommendations>;
    return {
      headlineScore:
        typeof obj.headlineScore === "number"
          ? Math.max(0, Math.min(100, Math.round(obj.headlineScore)))
          : 75,
      summaryFeedback:
        typeof obj.summaryFeedback === "string" && obj.summaryFeedback.trim()
          ? obj.summaryFeedback.trim()
          : `Profile reviewed against ${targetRoles.join(", ")}.`,
      add: Array.isArray(obj.add) ? obj.add.map(String) : [],
      post: Array.isArray(obj.post) ? obj.post.map(String) : [],
      visibility: Array.isArray(obj.visibility)
        ? obj.visibility.map(String)
        : [],
    };
  } catch {
    const topSkills =
      parsed.skills
        .slice(0, 3)
        .map((s) => s.name)
        .join(", ") || "core technical skills";
    const roleLabel = targetRoles.join(" / ");
    return {
      headlineScore: 72,
      summaryFeedback: `Your profile highlights ${topSkills}. Tighten headline keywords and impact metrics for ${roleLabel}.`,
      add: [
        `Add measurable outcomes and system scale to your experience entries targeting ${roleLabel}.`,
        `Feature top repositories or concrete artifacts demonstrating ${topSkills}.`,
      ],
      post: [
        `Publish a short architecture breakdown on a problem you solved with ${topSkills}.`,
        `Share a post on lessons learned building production features relevant to ${roleLabel}.`,
      ],
      visibility: [
        `Include exact role title keywords (${roleLabel}) in your LinkedIn headline for recruiter search filters.`,
        "Pin your strongest project or technical write-up in your Featured section.",
      ],
    };
  }
}

export async function reviewLinkedinProfile(
  input: LinkedinReviewInput,
  adapters: TransientParseAdapters = {}
): Promise<LinkedinReviewResult> {
  if (isUrlInput(input.rawText)) {
    throw new Error(
      "URL scraping is not supported. Upload your LinkedIn Save-to-PDF export or paste your profile text."
    );
  }

  const targetRoles = normalizeTargetRoles(input.targetRoles);

  let parsed = input.parsedProfile;
  if (!parsed) {
    const parseResult = await parseResumeOrLinkedinTransient(
      {
        userId: input.userId,
        source: "linkedin",
        pdfBytes: input.pdfBytes,
        rawText: input.rawText,
        skipDailyCap: true,
      },
      adapters
    );
    parsed = parseResult.parsed;
  }

  const canonicalPayload = JSON.stringify({
    parsed,
    targetRoles: [...targetRoles].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    ),
  });
  const cacheKey = hashContentForCache("linkedin_review", canonicalPayload);

  // Check D4 cache before consuming the 1/day attractor cap so repeat reviews
  // with unchanged profile + target role return cached advice at zero cost.
  const existingCache = await db.gatewayCache.findUnique({
    where: { cacheKey },
  });

  if (!existingCache) {
    await consumeAttractorCap(input.userId, "linkedin_review", 1);
  }

  const gwResult = await gatewayCall(
    {
      userId: input.userId,
      feature: "linkedin_review",
      cacheKey,
      skipEnergy: true,
      interactive: true,
      messages: [
        {
          role: "system",
          content:
            "You are a technical recruiter and engineering hiring manager. Review the parsed LinkedIn profile against the user's target roles. Return JSON only with keys: headlineScore (0-100), summaryFeedback (string), add (string[] - concrete profile additions), post (string[] - technical post topics for S1.5 commit-to-post drafts), visibility (string[] - recruiter searchability and positioning advice).",
        },
        {
          role: "user",
          content: JSON.stringify({
            targetRoles,
            profile: parsed,
          }),
        },
      ],
    },
    adapters.gatewayFetch
  );

  if (gwResult.status !== "ok") {
    throw new Error(gwResult.message);
  }

  const recommendations = normalizeReviewOutput(
    gwResult.content,
    parsed,
    targetRoles
  );

  return {
    parsed,
    targetRoles,
    cacheKey,
    cached: Boolean(gwResult.cached),
    recommendations,
  };
}
