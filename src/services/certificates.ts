import crypto from "node:crypto";
import { db, type Certificate, type EventLog, type Skill } from "@/lib/db";
import { extractTextFromPdf } from "@/lib/pdf-utils";
import { appendEvent } from "@/services/events";
import { gatewayCall, hashContentForCache } from "@/services/gateway";
import { getConfig } from "@/services/levels";
import {
  DEFAULT_CERT_PROVIDERS,
  type CertProviderConfig,
} from "@/services/seed-config";
import {
  getSignedDownloadUrl,
  putObject,
  type StorageAdapter,
} from "@/services/storage";

export const CERTIFICATE_QUIZ_NUDGE =
  "Stored as a claim. Verify with a 6-question check to convert it into calibrated evidence.";

export interface PdfCertificateMetadata {
  rawText: string;
  courseNameHint: string | null;
  issuedOnHint: Date | null;
}

export interface ProposedCertificateMapping {
  courseName: string;
  issuedOnHint: Date | null;
  providerSlug: string;
  providerAllowed: boolean;
  patternMatches: boolean;
  suggestedSkills: Array<{
    id: string;
    name: string;
    display: string;
  }>;
}

export interface SubmitCertificateResult {
  certificate: Certificate;
  tier: "verified" | "claim";
  verified: boolean;
  nameWarning: string | null;
  quizNudge: string | null;
  event: EventLog | null;
}

export async function getCertProviders(): Promise<CertProviderConfig[]> {
  return getConfig<CertProviderConfig[]>(
    "certs.providers",
    DEFAULT_CERT_PROVIDERS
  );
}

export async function matchCertProvider(
  providerSlug: string,
  verifyUrl?: string | null
): Promise<{
  providerConfig: CertProviderConfig | null;
  providerAllowed: boolean;
  patternMatches: boolean;
}> {
  const providers = await getCertProviders();
  const normalizedSlug = providerSlug.trim().toLowerCase();
  const providerConfig =
    providers.find(
      (p) =>
        p.slug.toLowerCase() === normalizedSlug ||
        p.name.toLowerCase() === normalizedSlug
    ) ?? null;

  if (!providerConfig) {
    return {
      providerConfig: null,
      providerAllowed: false,
      patternMatches: false,
    };
  }

  if (!verifyUrl || !verifyUrl.trim()) {
    return {
      providerConfig,
      providerAllowed: true,
      patternMatches: false,
    };
  }

  try {
    const regex = new RegExp(providerConfig.verifyPattern, "i");
    return {
      providerConfig,
      providerAllowed: true,
      patternMatches: regex.test(verifyUrl.trim()),
    };
  } catch {
    return {
      providerConfig,
      providerAllowed: true,
      patternMatches: false,
    };
  }
}

function parseDateFromText(text: string): Date | null {
  // Match ISO YYYY-MM-DD
  const isoMatch = text.match(
    /\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/
  );
  if (isoMatch) {
    const d = new Date(`${isoMatch[0]}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Match "Month DD, YYYY"
  const monthMatch = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2}|19\d{2})\b/i
  );
  if (monthMatch) {
    const d = new Date(`${monthMatch[0]} UTC`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

export async function extractCertificatePdfMetadata(
  pdfBytes: Uint8Array | Buffer
): Promise<PdfCertificateMetadata> {
  const rawText = await extractTextFromPdf(pdfBytes);
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let courseNameHint: string | null = null;
  for (const line of lines) {
    const coursePrefix = line.match(
      /^(?:Course|Certificate\s+of\s+Completion|Specialization|Program)\s*[:\-]\s*(.+)$/i
    );
    if (coursePrefix && coursePrefix[1].trim().length >= 3) {
      courseNameHint = coursePrefix[1].trim();
      break;
    }
  }
  if (!courseNameHint && lines.length > 0) {
    const candidate = lines.find(
      (l) =>
        l.length >= 5 &&
        !/^(certificate|verified|issued|completed|coursera|edx|udacity)/i.test(
          l
        )
    );
    courseNameHint = candidate ?? lines[0];
  }

  const issuedOnHint = parseDateFromText(rawText);

  return {
    rawText,
    courseNameHint,
    issuedOnHint,
  };
}

export async function proposeCertificateSkillMapping(
  input: {
    userId: string;
    provider: string;
    courseName?: string;
    verifyUrl?: string;
    pdfBytes?: Uint8Array | Buffer;
  },
  fetchImpl: typeof fetch = fetch
): Promise<ProposedCertificateMapping> {
  let resolvedCourseName = input.courseName?.trim() ?? "";
  let issuedOnHint: Date | null = null;

  if (input.pdfBytes && input.pdfBytes.byteLength > 0) {
    try {
      const meta = await extractCertificatePdfMetadata(input.pdfBytes);
      if (!resolvedCourseName && meta.courseNameHint) {
        resolvedCourseName = meta.courseNameHint;
      }
      issuedOnHint = meta.issuedOnHint;
    } catch {
      // PDF extraction is best-effort
    }
  }

  if (!resolvedCourseName) {
    throw new Error("Course name is required to map certificate skills");
  }

  const { providerConfig, providerAllowed, patternMatches } =
    await matchCertProvider(input.provider, input.verifyUrl);

  const canonicalSkills = await db.skill.findMany({
    where: {
      status: "ACTIVE",
      parentId: { not: null },
    },
    include: { aliases: true },
    orderBy: { name: "asc" },
  });

  const skillCatalogList = canonicalSkills
    .map((s) => `${s.name} (${s.display})`)
    .join(", ");

  // D75 / D78f: One cached platform-route gateway call per course
  const cacheKey = hashContentForCache(
    "cert_course_map",
    resolvedCourseName.trim().toLowerCase()
  );
  const gw = await gatewayCall(
    {
      userId: input.userId,
      feature: "cert_course_map",
      forcePlatform: true,
      skipEnergy: true,
      cacheKey,
      messages: [
        {
          role: "system",
          content:
            'You map a course title to canonical software engineering skills from the provided catalog. Return strict JSON: {"skills": ["skill-slug"]}.',
        },
        {
          role: "user",
          content: [
            `Course name: ${resolvedCourseName}`,
            `Available canonical leaf skills: ${skillCatalogList}`,
            "Return JSON with 1 to 5 matching skill slugs from the catalog.",
          ].join("\n"),
        },
      ],
    },
    fetchImpl
  );

  const matchedIds = new Set<string>();
  const matchedSkills: Array<{ id: string; name: string; display: string }> =
    [];

  const addSkill = (s: Skill) => {
    if (!matchedIds.has(s.id)) {
      matchedIds.add(s.id);
      matchedSkills.push({ id: s.id, name: s.name, display: s.display });
    }
  };

  if (gw.status === "ok") {
    try {
      const cleaned = gw.content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned) as { skills?: unknown } | unknown[];
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { skills?: unknown }).skills)
          ? ((parsed as { skills: unknown[] }).skills ?? [])
          : [];
      for (const raw of list) {
        const token = String(raw).trim().toLowerCase();
        const found = canonicalSkills.find(
          (s) =>
            s.name.toLowerCase() === token ||
            s.display.toLowerCase() === token ||
            s.id === raw ||
            s.aliases.some((a) => a.alias.toLowerCase() === token)
        );
        if (found) addSkill(found);
      }
    } catch {
      // Fallback to keyword matching below
    }
  }

  // Deterministic keyword fallback against courseName
  if (matchedSkills.length === 0) {
    const lowerCourse = resolvedCourseName.toLowerCase();
    for (const s of canonicalSkills) {
      if (
        lowerCourse.includes(s.name.toLowerCase()) ||
        lowerCourse.includes(s.display.toLowerCase())
      ) {
        addSkill(s);
      }
    }
  }

  return {
    courseName: resolvedCourseName,
    issuedOnHint,
    providerSlug: providerConfig?.slug ?? input.provider.trim().toLowerCase(),
    providerAllowed,
    patternMatches,
    suggestedSkills: matchedSkills,
  };
}

function checkSoftNameMatch(
  pageHtml: string,
  candidateNames: string[]
): { matched: boolean; warning: string | null } {
  const cleanCandidates = candidateNames
    .map((n) => n.trim())
    .filter((n) => n.length >= 2);

  if (cleanCandidates.length === 0) {
    return { matched: true, warning: null };
  }

  const lowerHtml = pageHtml.toLowerCase();
  for (const name of cleanCandidates) {
    const tokens = name
      .toLowerCase()
      .split(/[\s._+-]+/)
      .filter((t) => t.length >= 2);
    if (tokens.length > 0 && tokens.every((t) => lowerHtml.includes(t))) {
      return { matched: true, warning: null };
    }
  }

  return {
    matched: false,
    warning: `Name mismatch warning: could not find "${cleanCandidates[0]}" on the public verification page. Your certificate was still verified, but please confirm the URL belongs to you.`,
  };
}

async function resolveVerifiedSkills(skillInputs: string[]): Promise<Skill[]> {
  if (skillInputs.length === 0) {
    throw new Error("At least one confirmed skill is required");
  }
  const normalized = skillInputs.map((s) => s.trim().toLowerCase());
  const skills = await db.skill.findMany({
    where: {
      OR: [
        { id: { in: skillInputs } },
        { name: { in: normalized } },
        { aliases: { some: { alias: { in: normalized } } } },
      ],
      status: "ACTIVE",
    },
  });
  if (skills.length === 0) {
    throw new Error("No valid canonical skills found for certificate");
  }
  return skills;
}

async function recordCertificateClaims(
  userId: string,
  skills: Skill[]
): Promise<void> {
  for (const skill of skills) {
    const existing = await db.userSkill.findUnique({
      where: { userId_skillId: { userId, skillId: skill.id } },
    });
    if (!existing) {
      await db.userSkill.create({
        data: {
          userId,
          skillId: skill.id,
          level: 0,
          score: 0,
          claimedLevel: 2,
          claimOrigins: ["certificate"],
        },
      });
    } else {
      const origins = existing.claimOrigins.includes("certificate")
        ? existing.claimOrigins
        : [...existing.claimOrigins, "certificate"];
      await db.userSkill.update({
        where: { id: existing.id },
        data: {
          claimedLevel: Math.max(existing.claimedLevel ?? 0, 2),
          claimOrigins: origins,
        },
      });
    }
  }
}

export async function submitCertificate(
  input: {
    userId: string;
    provider: string;
    verifyUrl?: string;
    courseName?: string;
    issuedOn?: Date | string;
    confirmedSkills: string[];
    expectedHolderName?: string;
    pdfBytes?: Uint8Array | Buffer;
    now?: Date;
  },
  options?: {
    verifyFetch?: typeof fetch;
    storageAdapter?: StorageAdapter;
  }
): Promise<SubmitCertificateResult> {
  const now = input.now ?? new Date();
  const verifyFetch = options?.verifyFetch ?? fetch;

  const user = await db.user.findUniqueOrThrow({
    where: { id: input.userId },
  });

  const skills = await resolveVerifiedSkills(input.confirmedSkills);
  const skillIds = skills.map((s) => s.id);

  let resolvedCourseName = input.courseName?.trim() ?? "";
  let pdfIssuedOnHint: Date | null = null;
  let storageKey: string | null = null;

  if (input.pdfBytes && input.pdfBytes.byteLength > 0) {
    const key = `certificates/${input.userId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
    await putObject(
      {
        key,
        body: input.pdfBytes,
        contentType: "application/pdf",
      },
      options?.storageAdapter
    );
    storageKey = key;

    try {
      const meta = await extractCertificatePdfMetadata(input.pdfBytes);
      if (!resolvedCourseName && meta.courseNameHint) {
        resolvedCourseName = meta.courseNameHint;
      }
      pdfIssuedOnHint = meta.issuedOnHint;
    } catch {
      // ignore extraction error if caller supplied courseName
    }
  }

  if (!resolvedCourseName) {
    resolvedCourseName = `${input.provider} Certificate`;
  }

  let parsedUserIssuedOn: Date | null = null;
  if (input.issuedOn instanceof Date) {
    parsedUserIssuedOn = input.issuedOn;
  } else if (typeof input.issuedOn === "string" && input.issuedOn.trim()) {
    const d = new Date(input.issuedOn);
    if (!Number.isNaN(d.getTime())) {
      parsedUserIssuedOn = d;
    }
  }

  const { providerConfig, providerAllowed, patternMatches } =
    await matchCertProvider(input.provider, input.verifyUrl);

  const normalizedVerifyUrl = input.verifyUrl?.trim() ?? "";

  // Check if an already-verified certificate with the exact verifyUrl exists for this user (row-level cache)
  if (providerAllowed && patternMatches && normalizedVerifyUrl) {
    const existingVerified = await db.certificate.findFirst({
      where: {
        userId: input.userId,
        verifyUrl: normalizedVerifyUrl,
        verifiedAt: { not: null },
      },
    });
    if (existingVerified && existingVerified.verifiedAt) {
      const existingEvent = await db.eventLog.findFirst({
        where: {
          userId: input.userId,
          type: "certificate_added",
        },
        orderBy: { createdAt: "desc" },
      });
      return {
        certificate: existingVerified,
        tier: "verified",
        verified: true,
        nameWarning: null,
        quizNudge: null,
        event: existingEvent,
      };
    }
  }

  let verifiedAt: Date | null = null;
  let pageIssuedOn: Date | null = null;
  let nameWarning: string | null = null;

  if (providerAllowed && patternMatches && normalizedVerifyUrl) {
    try {
      const res = await verifyFetch(normalizedVerifyUrl, {
        method: "GET",
        headers: {
          "User-Agent": "GLaDOS-Certificate-Verifier/1.0",
        },
      });
      if (res.status === 200) {
        const html = await res.text();
        verifiedAt = now;
        pageIssuedOn = parseDateFromText(html);

        const candidateNames: string[] = [];
        if (input.expectedHolderName?.trim()) {
          candidateNames.push(input.expectedHolderName.trim());
        }
        if (user.email) {
          const localPart = user.email.split("@")[0]?.replace(/[+._-].*$/, "");
          if (localPart && localPart.length >= 3) {
            candidateNames.push(localPart);
          }
        }

        const nameCheck = checkSoftNameMatch(html, candidateNames);
        nameWarning = nameCheck.warning;
      }
    } catch {
      // Network/fetch failure -> unverified & resubmittable
      verifiedAt = null;
    }
  }

  // D57/D75: Issue date from verify page when present, user-entered or PDF-extracted otherwise
  const finalIssuedOn =
    pageIssuedOn ?? parsedUserIssuedOn ?? pdfIssuedOnHint ?? now;

  const certificate = await db.certificate.create({
    data: {
      userId: input.userId,
      provider: providerConfig?.slug ?? input.provider.trim().toLowerCase(),
      verifyUrl: normalizedVerifyUrl,
      verifiedAt,
      courseName: resolvedCourseName,
      issuedOn: finalIssuedOn,
      skills: skillIds,
      storageKey,
    },
  });

  if (verifiedAt) {
    const event = await appendEvent({
      userId: input.userId,
      source: "web",
      type: "certificate_added",
      skills: skillIds,
      occurredAt: finalIssuedOn,
      now,
      payload: {
        certificateId: certificate.id,
        provider: certificate.provider,
        verifyUrl: certificate.verifyUrl,
        courseName: certificate.courseName,
        issuedOn: finalIssuedOn.toISOString(),
        nameWarning,
      },
    });

    return {
      certificate,
      tier: "verified",
      verified: true,
      nameWarning,
      quizNudge: null,
      event,
    };
  }

  // Off-list provider or failed verification -> store as claim tier + 1-line quiz nudge
  await recordCertificateClaims(input.userId, skills);

  return {
    certificate,
    tier: "claim",
    verified: false,
    nameWarning: null,
    quizNudge: CERTIFICATE_QUIZ_NUDGE,
    event: null,
  };
}

export async function retryCertificateVerification(
  input: {
    certificateId: string;
    userId: string;
    expectedHolderName?: string;
    now?: Date;
  },
  verifyFetch: typeof fetch = fetch
): Promise<SubmitCertificateResult> {
  const now = input.now ?? new Date();
  const cert = await db.certificate.findFirst({
    where: { id: input.certificateId, userId: input.userId },
  });
  if (!cert) {
    throw new Error("Certificate not found");
  }

  // Row-level cache: if already verified, do not re-fetch
  if (cert.verifiedAt) {
    const existingEvent = await db.eventLog.findFirst({
      where: {
        userId: input.userId,
        type: "certificate_added",
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      certificate: cert,
      tier: "verified",
      verified: true,
      nameWarning: null,
      quizNudge: null,
      event: existingEvent,
    };
  }

  const { providerAllowed, patternMatches } = await matchCertProvider(
    cert.provider,
    cert.verifyUrl
  );
  if (!providerAllowed || !patternMatches || !cert.verifyUrl) {
    return {
      certificate: cert,
      tier: "claim",
      verified: false,
      nameWarning: null,
      quizNudge: CERTIFICATE_QUIZ_NUDGE,
      event: null,
    };
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId } });

  let verifiedAt: Date | null = null;
  let pageIssuedOn: Date | null = null;
  let nameWarning: string | null = null;

  try {
    const res = await verifyFetch(cert.verifyUrl, {
      method: "GET",
      headers: {
        "User-Agent": "GLaDOS-Certificate-Verifier/1.0",
      },
    });
    if (res.status === 200) {
      const html = await res.text();
      verifiedAt = now;
      pageIssuedOn = parseDateFromText(html);

      const candidateNames: string[] = [];
      if (input.expectedHolderName?.trim()) {
        candidateNames.push(input.expectedHolderName.trim());
      }
      if (user.email) {
        const localPart = user.email.split("@")[0]?.replace(/[+._-].*$/, "");
        if (localPart && localPart.length >= 3) {
          candidateNames.push(localPart);
        }
      }
      const nameCheck = checkSoftNameMatch(html, candidateNames);
      nameWarning = nameCheck.warning;
    }
  } catch {
    verifiedAt = null;
  }

  if (!verifiedAt) {
    return {
      certificate: cert,
      tier: "claim",
      verified: false,
      nameWarning: null,
      quizNudge: CERTIFICATE_QUIZ_NUDGE,
      event: null,
    };
  }

  const finalIssuedOn = pageIssuedOn ?? cert.issuedOn;
  const updated = await db.certificate.update({
    where: { id: cert.id },
    data: {
      verifiedAt,
      issuedOn: finalIssuedOn,
    },
  });

  const event = await appendEvent({
    userId: input.userId,
    source: "web",
    type: "certificate_added",
    skills: updated.skills,
    occurredAt: finalIssuedOn,
    now,
    payload: {
      certificateId: updated.id,
      provider: updated.provider,
      verifyUrl: updated.verifyUrl,
      courseName: updated.courseName,
      issuedOn: finalIssuedOn.toISOString(),
      nameWarning,
    },
  });

  return {
    certificate: updated,
    tier: "verified",
    verified: true,
    nameWarning,
    quizNudge: null,
    event,
  };
}

export async function getCertificateSignedUrl(
  input: {
    certificateId: string;
    userId: string;
    expiresInSeconds?: number;
  },
  storageAdapter?: StorageAdapter
): Promise<string> {
  const cert = await db.certificate.findFirst({
    where: { id: input.certificateId, userId: input.userId },
  });
  if (!cert || !cert.storageKey) {
    throw new Error("Certificate PDF not found");
  }
  return getSignedDownloadUrl(
    cert.storageKey,
    input.expiresInSeconds ?? 300,
    storageAdapter
  );
}

export async function listUserCertificates(
  userId: string
): Promise<Certificate[]> {
  return db.certificate.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
