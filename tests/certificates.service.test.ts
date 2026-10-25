import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildSimplePdfBuffer } from "@/lib/pdf-utils";
import {
  getCertificateSignedUrl,
  getCertProviders,
  matchCertProvider,
  proposeCertificateSkillMapping,
  retryCertificateVerification,
  submitCertificate,
} from "@/services/certificates";
import { addCredential } from "@/services/credentials";
import { recomputeUserSkill } from "@/services/levels";
import { seedConfig, seedRoutes } from "@/services/seed-config";
import { seedCanonicalSkills } from "@/services/seed-skills";
import {
  createInMemoryS3Fetch,
  createR2Adapter,
  getObject,
} from "@/services/storage";

const TEST_PREFIX = "test-certs-";
const createdUserIds: string[] = [];

async function makeUser(suffix: string, emailLocal = "ada.lovelace") {
  const id = `${TEST_PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createdUserIds.push(id);
  return db.user.create({
    data: {
      id,
      clerkId: `clerk_${id}`,
      email: `${emailLocal}+${suffix}@example.test`,
      role: "USER",
    },
  });
}

beforeAll(async () => {
  process.env.PLATFORM_GOOGLE_API_KEY = "test-platform-google-key";
  process.env.CREDENTIALS_KEK =
    process.env.CREDENTIALS_KEK ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  await seedCanonicalSkills();
  await seedConfig();
  await seedRoutes();
});

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({
      where: { id: { in: [...createdUserIds] } },
    });
    createdUserIds.length = 0;
  }
});

describe("certificates service (Ticket 05)", () => {
  it("loads ~10 verifiable providers from certs.providers config and validates example URLs against verifyPattern", async () => {
    const providers = await getCertProviders();
    expect(providers.length).toBeGreaterThanOrEqual(10);

    for (const p of providers) {
      expect(p.slug).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.verifyPattern).toBeTruthy();
      expect(p.exampleUrl).toBeTruthy();

      const matched = await matchCertProvider(p.slug, p.exampleUrl);
      expect(matched.providerAllowed).toBe(true);
      expect(matched.patternMatches).toBe(true);
    }

    // Off-list provider (AWS / Microsoft / LinkedIn Learning) -> providerAllowed = false
    const awsMatch = await matchCertProvider(
      "aws",
      "https://aws.amazon.com/verification/123"
    );
    expect(awsMatch.providerAllowed).toBe(false);
    expect(awsMatch.patternMatches).toBe(false);
  });

  it("maps course to skills via one D4-cached platform-route gateway call without writing DB state until user confirms", async () => {
    const user = await makeUser("course-map");
    await addCredential(user.id, "google", "byo-secret-google-key");

    let gatewayCalls = 0;
    const capturedAuthHeaders: string[] = [];
    const stubGatewayFetch: typeof fetch = async (_url, init) => {
      gatewayCalls += 1;
      const headers = new Headers(init?.headers);
      capturedAuthHeaders.push(headers.get("authorization") ?? "");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  skills: ["python", "postgresql"],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 60, completion_tokens: 25 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const uniqueCourse = `Applied Data Engineering with Python ${Date.now()}`;
    const proposal1 = await proposeCertificateSkillMapping(
      {
        userId: user.id,
        provider: "coursera",
        courseName: uniqueCourse,
        verifyUrl:
          "https://www.coursera.org/account/accomplishments/verify/PYDATA999",
      },
      stubGatewayFetch
    );

    expect(gatewayCalls).toBe(1);
    // Must use PLATFORM key, never the user's BYO key ([D78f])
    expect(capturedAuthHeaders[0]).toContain("test-platform-google-key");
    expect(capturedAuthHeaders[0]).not.toContain("byo-secret-google-key");
    expect(proposal1.suggestedSkills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["python", "postgresql"])
    );

    // Second call for the same course hits D4 cache (zero additional gateway calls)
    const proposal2 = await proposeCertificateSkillMapping(
      {
        userId: user.id,
        provider: "coursera",
        courseName: uniqueCourse,
        verifyUrl:
          "https://www.coursera.org/account/accomplishments/verify/PYDATA999",
      },
      stubGatewayFetch
    );
    expect(gatewayCalls).toBe(1);
    expect(proposal2.suggestedSkills.map((s) => s.name)).toEqual(
      proposal1.suggestedSkills.map((s) => s.name)
    );

    // Construction/selection split: nothing written to certificates or event_log yet
    const certsBeforeConfirm = await db.certificate.count({
      where: { userId: user.id },
    });
    const eventsBeforeConfirm = await db.eventLog.count({
      where: { userId: user.id },
    });
    expect(certsBeforeConfirm).toBe(0);
    expect(eventsBeforeConfirm).toBe(0);
  });

  it("verifies allowlisted URL once, caches on certificate row, softly warns on name mismatch without gating, and handles fetch failure + retry", async () => {
    const user = await makeUser("verify-flow", "ada.lovelace");
    const pythonSkill = await db.skill.findUniqueOrThrow({
      where: { name: "python" },
    });

    // 1. Soft name mismatch: page has HTTP 200 + issue date, but different name -> still verified with visible warning!
    let fetchCount = 0;
    const mismatchFetch: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(
        `<html><body><h1>Certificate of Completion</h1><p>Awarded to Grace Hopper</p><p>Issued on 2026-01-15</p></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const verifyUrl1 =
      "https://www.coursera.org/account/accomplishments/verify/CERTMISMATCH1";
    const res1 = await submitCertificate(
      {
        userId: user.id,
        provider: "coursera",
        verifyUrl: verifyUrl1,
        courseName: "Python Systems",
        confirmedSkills: [pythonSkill.id],
        expectedHolderName: "Ada Lovelace",
        now: new Date("2026-02-01T00:00:00.000Z"),
      },
      { verifyFetch: mismatchFetch }
    );

    expect(res1.verified).toBe(true);
    expect(res1.tier).toBe("verified");
    expect(res1.nameWarning).toMatch(/Name mismatch warning/i);
    expect(res1.event).not.toBeNull();
    expect(res1.event?.type).toBe("certificate_added");
    // Issue date parsed from verify page (2026-01-15)
    expect(res1.event?.occurredAt.toISOString()).toBe(
      "2026-01-15T00:00:00.000Z"
    );
    expect(fetchCount).toBe(1);

    // Calling retryCertificateVerification or re-submitting same verified URL uses row cache (no second fetch!)
    const cachedRes = await retryCertificateVerification(
      {
        certificateId: res1.certificate.id,
        userId: user.id,
      },
      mismatchFetch
    );
    expect(cachedRes.verified).toBe(true);
    expect(fetchCount).toBe(1);

    // 2. Fetch failure -> stores unverified claim with quiz nudge, then retry succeeds
    let shouldFail = true;
    const flakyFetch: typeof fetch = async () => {
      if (shouldFail) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response(
        `<html><body><p>Verified for Ada Lovelace on 2026-01-20</p></body></html>`,
        { status: 200 }
      );
    };

    const verifyUrl2 =
      "https://www.coursera.org/account/accomplishments/verify/CERTFLAKY2";
    const failedSub = await submitCertificate(
      {
        userId: user.id,
        provider: "coursera",
        verifyUrl: verifyUrl2,
        courseName: "Advanced PostgreSQL",
        confirmedSkills: ["postgres"],
        expectedHolderName: "Ada Lovelace",
      },
      { verifyFetch: flakyFetch }
    );
    expect(failedSub.verified).toBe(false);
    expect(failedSub.tier).toBe("claim");
    expect(failedSub.quizNudge).toMatch(/6-question/i);
    expect(failedSub.event).toBeNull();

    // Retry when page comes back up -> transitions to verified and writes certificate_added event
    shouldFail = false;
    const retried = await retryCertificateVerification(
      {
        certificateId: failedSub.certificate.id,
        userId: user.id,
        expectedHolderName: "Ada Lovelace",
      },
      flakyFetch
    );
    expect(retried.verified).toBe(true);
    expect(retried.tier).toBe("verified");
    expect(retried.nameWarning).toBeNull();
    expect(retried.event?.type).toBe("certificate_added");
  });

  it("stores off-list provider certificates as claim-tier with quiz nudge, supports optional PDF storage + text extraction, and decays 2-year-old certificates toward zero", async () => {
    const user = await makeUser("decay-and-pdf");
    const fakeS3 = createInMemoryS3Fetch();
    const adapter = createR2Adapter(
      {
        endpoint: "https://r2.test.internal",
        bucket: "glados-private-certs",
        accessKeyId: "TESTKEY",
        secretAccessKey: "TESTSECRET",
      },
      fakeS3.fetch
    );

    const pdfBuf = buildSimplePdfBuffer([
      "Course: Distributed Go Microservices",
      "Awarded to Ada Lovelace",
      "Issued on 2024-01-01",
    ]);

    // 1. Off-list provider (AWS) -> claim tier + quiz nudge, zero evidence points
    const offList = await submitCertificate(
      {
        userId: user.id,
        provider: "aws",
        verifyUrl: "https://aws.amazon.com/certification/verify/123",
        confirmedSkills: ["docker"],
        pdfBytes: pdfBuf,
      },
      { storageAdapter: adapter }
    );
    expect(offList.verified).toBe(false);
    expect(offList.tier).toBe("claim");
    expect(offList.quizNudge).toMatch(/6-question/i);
    // Course name extracted from PDF since none was passed!
    expect(offList.certificate.courseName).toBe("Distributed Go Microservices");
    expect(offList.certificate.storageKey).toBeTruthy();

    // Verify storage contract: object stored in private bucket + signed URL works
    const storedObj = await getObject(offList.certificate.storageKey!, adapter);
    expect(storedObj).not.toBeNull();
    expect(storedObj?.contentType).toBe("application/pdf");

    const signedUrl = await getCertificateSignedUrl(
      {
        certificateId: offList.certificate.id,
        userId: user.id,
        expiresInSeconds: 180,
      },
      adapter
    );
    expect(signedUrl).toContain("X-Amz-Signature=");
    expect(signedUrl).toContain("X-Amz-Expires=180");

    const dockerSkill = await db.skill.findUniqueOrThrow({
      where: { name: "docker" },
    });
    const dockerUs = await db.userSkill.findUniqueOrThrow({
      where: { userId_skillId: { userId: user.id, skillId: dockerSkill.id } },
    });
    expect(dockerUs.score).toBe(0);
    expect(dockerUs.level).toBe(0);
    expect(dockerUs.claimOrigins).toContain("certificate");

    // 2. 2-year-old verified certificate (issued 2024-01-01, evaluated 2026-01-01 = 731 days = >8 half-lives)
    const verifyFetch200: typeof fetch = async () =>
      new Response(
        `<html><body><p>Ada Lovelace completed Distributed Go Microservices</p></body></html>`,
        { status: 200 }
      );

    const now2026 = new Date("2026-01-01T00:00:00.000Z");
    const oldCert = await submitCertificate(
      {
        userId: user.id,
        provider: "edx",
        verifyUrl:
          "https://courses.edx.org/certificates/0123456789abcdef0123456789abcdef",
        confirmedSkills: ["go"],
        pdfBytes: pdfBuf,
        expectedHolderName: "Ada Lovelace",
        now: now2026,
      },
      { verifyFetch: verifyFetch200, storageAdapter: adapter }
    );

    expect(oldCert.verified).toBe(true);
    // IssuedOn extracted from PDF (2024-01-01)
    expect(oldCert.certificate.issuedOn.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z"
    );

    const goSkill = await db.skill.findUniqueOrThrow({
      where: { name: "go" },
    });
    const goUs = await recomputeUserSkill(user.id, goSkill.id, now2026);
    // Base points = 5, decayed over ~731 days (90-day half-life: 5 * 0.5^(731/90) ≈ 0.018 < 0.05)
    expect(goUs.score).toBeGreaterThan(0);
    expect(goUs.score).toBeLessThan(0.05);
    expect(goUs.level).toBe(0);
  });
});
