import crypto from "node:crypto";
import { db } from "@/lib/db";
import { extractTextFromPdf } from "@/lib/pdf-utils";
import { todayUtc } from "@/services/energy";
import { gatewayCall, hashContentForCache } from "@/services/gateway";
import { getConfig } from "@/services/levels";
import {
  deleteObject,
  putObject,
  type StorageAdapter,
} from "@/services/storage";

export const LINKEDIN_PDF_GUIDE_COPY =
  "On your LinkedIn profile, click the More button below your headline and choose Save to PDF, then upload that PDF here.";

export interface ParsedResumeSkill {
  name: string;
  claimedLevel?: number;
}

export interface ParsedResumeBlock {
  kind: "summary" | "experience" | "skill_group" | "education" | "custom";
  title: string;
  content: string;
}

export interface ParsedWorkExperience {
  employer: string;
  title: string;
  period: string;
  durationMonths?: number;
  kind?: "job" | "internship";
  description: string;
  skills?: string[];
}

export interface ParsedEducation {
  institution: string;
  degree: string;
  period?: string;
}

export interface ParsedResumeDocument {
  summary: string;
  skills: ParsedResumeSkill[];
  blocks: ParsedResumeBlock[];
  workExperiences: ParsedWorkExperience[];
  education: ParsedEducation[];
}

export interface TransientParseInput {
  userId: string | null;
  rateLimitId?: string;
  source?: "resume" | "linkedin";
  pdfBytes?: Uint8Array | Buffer;
  rawText?: string;
  keepUploadedPdf?: boolean;
  skipDailyCap?: boolean;
}

export interface TransientParseAdapters {
  storageAdapter?: StorageAdapter;
  gatewayFetch?: typeof fetch;
}

export interface TransientParseResult {
  source: "resume" | "linkedin";
  extractedText: string;
  contentHash: string;
  cached: boolean;
  storageKey: string | null;
  parsed: ParsedResumeDocument;
}

export async function consumeAttractorCap(
  bucketId: string,
  capField: "resume_scan" | "jd_scan" | "linkedin_review",
  fallbackCap: number
): Promise<{ count: number; cap: number }> {
  const caps = await getConfig<Record<string, number>>("attractor.caps", {
    resume_scan: 3,
    jd_scan: 5,
    linkedin_review: 1,
  });
  let cap = caps[capField] ?? fallbackCap;
  if (capField === "linkedin_review") {
    const liCfg = await getConfig<number | { perDay?: number }>(
      "linkedin.dailyCap",
      cap
    );
    if (typeof liCfg === "number") {
      cap = liCfg;
    } else if (
      liCfg &&
      typeof liCfg === "object" &&
      typeof liCfg.perDay === "number"
    ) {
      cap = liCfg.perDay;
    }
  }

  const bucketKey = `attractor:${capField}:${bucketId}`;
  const date = todayUtc();

  const existing = await db.rateLimitCounter.findUnique({
    where: { bucketKey_date: { bucketKey, date } },
  });
  if ((existing?.count ?? 0) >= cap) {
    throw new Error(
      `Daily ${capField.replace("_", " ")} cap (${cap}/day) reached. Try again tomorrow.`
    );
  }

  const updated = await db.rateLimitCounter.upsert({
    where: { bucketKey_date: { bucketKey, date } },
    update: { count: { increment: 1 } },
    create: { bucketKey, date, count: 1 },
  });

  return { count: updated.count, cap };
}

function heuristicFallbackParse(rawText: string): ParsedResumeDocument {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const summary = lines.slice(0, 3).join(" ");
  return {
    summary,
    skills: [],
    blocks: [
      {
        kind: "summary",
        title: "Summary",
        content: summary || rawText.slice(0, 300),
      },
    ],
    workExperiences: [],
    education: [],
  };
}

function normalizeParsedDocument(
  raw: string,
  extractedText: string
): ParsedResumeDocument {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<ParsedResumeDocument>;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      workExperiences: Array.isArray(parsed.workExperiences)
        ? parsed.workExperiences
        : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
    };
  } catch {
    return heuristicFallbackParse(extractedText);
  }
}

export async function parseResumeOrLinkedinTransient(
  input: TransientParseInput,
  adapters: TransientParseAdapters = {}
): Promise<TransientParseResult> {
  const source = input.source ?? "resume";
  const bucketId = input.rateLimitId ?? input.userId ?? "anonymous";

  if (!input.skipDailyCap) {
    await consumeAttractorCap(bucketId, "resume_scan", 3);
  }

  let extractedText = (input.rawText ?? "").trim();
  let storageKey: string | null = null;

  if (input.pdfBytes && input.pdfBytes.byteLength > 0) {
    const pdfDigest = crypto
      .createHash("sha256")
      .update(Buffer.from(input.pdfBytes))
      .digest("hex");
    storageKey = `uploads/${source}/${input.userId ?? "transient"}/${pdfDigest}.pdf`;

    await putObject(
      {
        key: storageKey,
        body: input.pdfBytes,
        contentType: "application/pdf",
      },
      adapters.storageAdapter
    );

    try {
      extractedText = await extractTextFromPdf(input.pdfBytes);
    } finally {
      // D55 case 1: No-profile or transient path deletes the temporary object immediately.
      if (!input.keepUploadedPdf || !input.userId) {
        await deleteObject(storageKey, adapters.storageAdapter);
        storageKey = null;
      }
    }
  }

  if (!extractedText) {
    throw new Error("Resume or LinkedIn text is required for parsing.");
  }

  const normalizedText = extractedText.replace(/\s+/g, " ").trim();
  const contentHash = crypto
    .createHash("sha256")
    .update(normalizedText, "utf8")
    .digest("hex");
  const cacheKey = hashContentForCache("resume_parse", normalizedText);

  const gwResult = await gatewayCall(
    {
      userId: input.userId ?? bucketId,
      feature: "resume_parse",
      cacheKey,
      skipEnergy: true,
      interactive: true,
      messages: [
        {
          role: "system",
          content:
            "Extract structured JSON from the provided resume or LinkedIn export text with keys: summary, skills ([{name, claimedLevel}]), blocks ([{kind, title, content}]), workExperiences ([{employer, title, period, durationMonths, kind, description, skills}]), education ([{institution, degree, period}]). Respond with JSON only.",
        },
        {
          role: "user",
          content: extractedText,
        },
      ],
    },
    adapters.gatewayFetch
  );

  if (gwResult.status !== "ok") {
    throw new Error(gwResult.message);
  }

  const parsed = normalizeParsedDocument(gwResult.content, extractedText);

  return {
    source,
    extractedText,
    contentHash,
    cached: Boolean(gwResult.cached),
    storageKey,
    parsed,
  };
}
