import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { todayUtc } from "@/services/energy";
import {
  computeGapMap,
  resolveGapMapMode,
  type GapMapSkillItem,
  type TransientClaimInput,
} from "@/services/gap-map";
import {
  createJobDescription,
  extractJdRequirementsTransient,
  type ExtractedJdSkill,
} from "@/services/jd";
import { getConfig } from "@/services/levels";
import {
  consumeAttractorCap,
  parseResumeOrLinkedinTransient,
} from "@/services/resume-parse";
import type { StorageAdapter } from "@/services/storage";
import { resolveCanonicalSkillByNameOrAlias } from "@/services/work-experience";

// OQ7 Reminder: GLaDOS is an internal codename only (Valve trademark).
// The rename checklist in docs/DECISIONS.md OQ7 MUST fire before any public
// marketing of the /scanner attractor surface. In-repo codename is fine for
// the D7 stage 1 friend cohort.

export function hashClientIp(rawIp: string): string {
  const pepper = process.env.IP_HASH_PEPPER || env.ipHashPepper;
  return crypto
    .createHmac("sha256", pepper)
    .update(rawIp.trim(), "utf8")
    .digest("hex");
}

export async function consumeAnonymousScannerCap(
  rawIp: string
): Promise<{ count: number; cap: number }> {
  const rawCap = await getConfig<number | { perDay?: number }>(
    "scanner.anonymousDailyCap",
    2
  );
  const cap = typeof rawCap === "number" ? rawCap : (rawCap?.perDay ?? 2);

  const ipHash = hashClientIp(rawIp);
  const bucketKey = `anon_ip:${ipHash}`;
  const date = todayUtc();

  const existing = await db.rateLimitCounter.findUnique({
    where: { bucketKey_date: { bucketKey, date } },
  });
  if ((existing?.count ?? 0) >= cap) {
    throw new Error(
      `Daily anonymous scanner cap (${cap}/day) reached. Join the waitlist or redeem an invite code to unlock full account limits.`
    );
  }

  const updated = await db.rateLimitCounter.upsert({
    where: { bucketKey_date: { bucketKey, date } },
    update: { count: { increment: 1 } },
    create: { bucketKey, date, count: 1 },
  });

  return { count: updated.count, cap };
}

export interface ScannerInput {
  userId: string | null;
  rawIp: string;
  sessionToken: string;
  jdText: string;
  resumeText?: string;
  resumePdfBytes?: Uint8Array | Buffer;
}

export type ScannerResult =
  | {
      kind: "anonymous";
      sessionToken: string;
      jdTitle: string;
      fitPercent: number;
      topGaps: GapMapSkillItem[];
      totalGapCount: number;
      fullItems: null;
      cta: {
        waitlistHref: string;
        redeemHref: string;
      };
    }
  | {
      kind: "authenticated";
      jdId: string;
      jdTitle: string;
      fitPercent: number;
      topGaps: GapMapSkillItem[];
      fullItems: GapMapSkillItem[];
    };

export async function runPublicOrFreeScan(
  input: ScannerInput,
  adapters: {
    gatewayFetch?: typeof fetch;
    storageAdapter?: StorageAdapter;
  } = {}
): Promise<ScannerResult> {
  const transientClaims: TransientClaimInput[] = [];

  if (!input.userId) {
    // 1. Anonymous path: hashed-IP daily cap, resume-mode only, TTL side table, gated result
    await consumeAnonymousScannerCap(input.rawIp);

    const jdExtracted = await extractJdRequirementsTransient(input.jdText, {
      userId: null,
      rateLimitId: "anonymous",
      skipDailyCap: true,
      gatewayFetch: adapters.gatewayFetch,
    });

    if (
      (input.resumeText && input.resumeText.trim().length > 0) ||
      (input.resumePdfBytes && input.resumePdfBytes.byteLength > 0)
    ) {
      const parsedResume = await parseResumeOrLinkedinTransient(
        {
          userId: null,
          rateLimitId: "anonymous",
          rawText: input.resumeText,
          pdfBytes: input.resumePdfBytes,
          skipDailyCap: true,
        },
        {
          gatewayFetch: adapters.gatewayFetch,
          storageAdapter: adapters.storageAdapter,
        }
      );

      for (const s of parsedResume.parsed.skills ?? []) {
        const skillId = await resolveCanonicalSkillByNameOrAlias(s.name);
        if (skillId) {
          transientClaims.push({
            skillId,
            claimedLevel: s.claimedLevel ?? 2,
          });
        }
      }
    }

    const gap = await computeGapMap({
      mode: "resume",
      userId: null,
      requirements: jdExtracted.requiredSkills.map((r) => ({
        skillId: r.skillId,
        expectedLevel: r.expectedLevel,
      })),
      transientClaims,
    });

    const rawTtl = await getConfig<number | { days?: number }>(
      "scanner.anonymousTtlDays",
      30
    );
    const ttlDays = typeof rawTtl === "number" ? rawTtl : (rawTtl?.days ?? 30);
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

    await db.anonymousScan.upsert({
      where: { sessionToken: input.sessionToken },
      update: {
        jdTitle: jdExtracted.title,
        jdText: input.jdText.trim(),
        resumeText: input.resumeText?.trim() || null,
        fitScore: gap.fitPercent,
        topGaps: gap.topGaps as unknown as Prisma.InputJsonValue,
        fullResult: {
          requirements: jdExtracted.requiredSkills,
          gap,
        } as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
      create: {
        sessionToken: input.sessionToken,
        jdTitle: jdExtracted.title,
        jdText: input.jdText.trim(),
        resumeText: input.resumeText?.trim() || null,
        fitScore: gap.fitPercent,
        topGaps: gap.topGaps as unknown as Prisma.InputJsonValue,
        fullResult: {
          requirements: jdExtracted.requiredSkills,
          gap,
        } as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });

    return {
      kind: "anonymous",
      sessionToken: input.sessionToken,
      jdTitle: jdExtracted.title,
      fitPercent: gap.fitPercent,
      topGaps: gap.topGaps.slice(0, 3),
      totalGapCount: gap.items.filter((i) => i.credit < 1).length,
      fullItems: null,
      cta: {
        waitlistHref: "/waitlist",
        redeemHref: "/",
      },
    };
  }

  // 2. Signed-in free account path: D28 fixed caps (scanner 3/day, JD scan 5/day), 0 energy bars
  await consumeAttractorCap(input.userId, "jd_scan", 5);

  if (
    (input.resumeText && input.resumeText.trim().length > 0) ||
    (input.resumePdfBytes && input.resumePdfBytes.byteLength > 0)
  ) {
    const parsedResume = await parseResumeOrLinkedinTransient(
      {
        userId: input.userId,
        rawText: input.resumeText,
        pdfBytes: input.resumePdfBytes,
        skipDailyCap: false,
      },
      {
        gatewayFetch: adapters.gatewayFetch,
        storageAdapter: adapters.storageAdapter,
      }
    );

    for (const s of parsedResume.parsed.skills ?? []) {
      const skillId = await resolveCanonicalSkillByNameOrAlias(s.name);
      if (skillId) {
        transientClaims.push({
          skillId,
          claimedLevel: s.claimedLevel ?? 2,
        });
      }
    }
  }

  const jd = await createJobDescription(
    input.userId,
    { rawText: input.jdText },
    { skipDailyCap: true, gatewayFetch: adapters.gatewayFetch }
  );

  const reqs = (jd.requiredSkills as unknown as ExtractedJdSkill[]) ?? [];
  const modeInfo = await resolveGapMapMode(input.userId);
  const useMode = transientClaims.length > 0 ? "resume" : modeInfo.mode;

  const gap = await computeGapMap({
    mode: useMode,
    userId: input.userId,
    requirements: reqs.map((r) => ({
      skillId: r.skillId,
      expectedLevel: r.expectedLevel,
    })),
    transientClaims: transientClaims.length > 0 ? transientClaims : undefined,
  });

  return {
    kind: "authenticated",
    jdId: jd.id,
    jdTitle: jd.title,
    fitPercent: gap.fitPercent,
    topGaps: gap.topGaps,
    fullItems: gap.items,
  };
}

export async function claimAnonymousScanOnSignup(
  userId: string,
  sessionToken: string
): Promise<{
  claimed: boolean;
  reason?: "missing" | "already_claimed" | "expired";
  jdId?: string;
  fitPercent?: number;
}> {
  if (!sessionToken) {
    return { claimed: false, reason: "missing" };
  }

  const scan = await db.anonymousScan.findUnique({
    where: { sessionToken },
  });
  if (!scan) {
    return { claimed: false, reason: "missing" };
  }
  if (scan.claimedByUserId && scan.claimedByUserId !== userId) {
    return { claimed: false, reason: "already_claimed" };
  }
  if (scan.expiresAt.getTime() <= Date.now()) {
    return { claimed: false, reason: "expired" };
  }

  const fullPayload = scan.fullResult as {
    requirements?: ExtractedJdSkill[];
  } | null;
  const reqs = fullPayload?.requirements ?? [];

  const createdJd = await db.jobDescription.create({
    data: {
      userId,
      title: scan.jdTitle,
      company: null,
      rawText: scan.jdText,
      contentHash: crypto
        .createHash("sha256")
        .update(scan.jdText, "utf8")
        .digest("hex"),
      requiredSkills: reqs as unknown as Prisma.InputJsonValue,
    },
  });

  await db.anonymousScan.update({
    where: { id: scan.id },
    data: {
      claimedByUserId: userId,
      claimedAt: new Date(),
    },
  });

  return {
    claimed: true,
    jdId: createdJd.id,
    fitPercent: scan.fitScore,
  };
}
