import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  createInMemoryS3Fetch,
  createR2Adapter,
  deleteObject,
  getObject,
  getSignedDownloadUrl,
  putObject,
  runStorageProbe,
} from "@/services/storage";

describe("storage service over Cloudflare R2 (seam: storage contract + service layer)", () => {
  let admin: User;
  let regularUser: User;
  const marker = `t03_storage_${Date.now()}`;

  beforeAll(async () => {
    admin = await db.user.create({
      data: { clerkId: `${marker}_admin`, role: "ADMIN" },
    });
    regularUser = await db.user.create({
      data: { clerkId: `${marker}_user`, role: "USER" },
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
  });

  it("puts, gets, signs short-lived URLs, and deletes against an S3-compatible fake without leaking raw URLs", async () => {
    const fakeS3 = createInMemoryS3Fetch();
    const adapter = createR2Adapter(
      {
        endpoint: "https://acct123.r2.cloudflarestorage.com",
        bucket: "glados-private",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      fakeS3.fetch
    );

    const payload = new TextEncoder().encode("resume-pdf-bytes");
    const putRes = await putObject(
      {
        key: "resumes/user-1/sample.pdf",
        body: payload,
        contentType: "application/pdf",
      },
      adapter
    );

    // Put result never exposes a raw bucket URL
    expect(putRes).toEqual({
      key: "resumes/user-1/sample.pdf",
      size: payload.byteLength,
      contentType: "application/pdf",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect("url" in putRes).toBe(false);

    // Request headers sent to S3 endpoint use AWS4-HMAC-SHA256 auth
    expect(fakeS3.lastAuthHeader).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\//
    );

    // Get returns identical bytes and content type
    const fetched = await getObject("resumes/user-1/sample.pdf", adapter);
    expect(fetched).not.toBeNull();
    expect(new TextDecoder().decode(fetched!.body)).toBe("resume-pdf-bytes");
    expect(fetched!.contentType).toBe("application/pdf");

    // Signed URL is short-lived (clamped to <= 900s) and never exposes secret key
    const signedUrl = await getSignedDownloadUrl(
      "resumes/user-1/sample.pdf",
      300,
      adapter
    );
    const parsed = new URL(signedUrl);
    expect(parsed.origin).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(parsed.pathname).toBe("/glados-private/resumes/user-1/sample.pdf");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(signedUrl).not.toContain("wJalrXUtnFEMI");

    // Requesting an overly long expiry clamps to 900s (15 minutes max)
    const clampedUrl = new URL(
      await getSignedDownloadUrl("resumes/user-1/sample.pdf", 86_400, adapter)
    );
    expect(clampedUrl.searchParams.get("X-Amz-Expires")).toBe("900");

    // Delete removes the object; subsequent get returns null
    await deleteObject("resumes/user-1/sample.pdf", adapter);
    const afterDelete = await getObject("resumes/user-1/sample.pdf", adapter);
    expect(afterDelete).toBeNull();
  });

  it("enforces admin gating on the storage probe and executes upload -> fetch -> delete", async () => {
    const fakeS3 = createInMemoryS3Fetch();
    const adapter = createR2Adapter(
      {
        endpoint: "https://acct123.r2.cloudflarestorage.com",
        bucket: "glados-private",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      fakeS3.fetch
    );

    await expect(runStorageProbe(regularUser, adapter)).rejects.toThrow(
      /admin/i
    );

    const probe = await runStorageProbe(admin, adapter);
    expect(probe.ok).toBe(true);
    expect(probe.bytesVerified).toBeGreaterThan(0);
    expect(probe.deleted).toBe(true);
    expect(probe.signedUrlExpiresSeconds).toBeLessThanOrEqual(900);
  });

  it("extends the private-bucket contract to certificate PDFs (put/get/signed URL/delete)", async () => {
    const fakeS3 = createInMemoryS3Fetch();
    const adapter = createR2Adapter(
      {
        endpoint: "https://acct123.r2.cloudflarestorage.com",
        bucket: "glados-private",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      fakeS3.fetch
    );

    const certPayload = new TextEncoder().encode("certificate-pdf-bytes");
    const certKey = "certificates/user-1/coursera-cert.pdf";
    const putRes = await putObject(
      {
        key: certKey,
        body: certPayload,
        contentType: "application/pdf",
      },
      adapter
    );

    expect(putRes.key).toBe(certKey);
    expect(putRes.contentType).toBe("application/pdf");

    const fetched = await getObject(certKey, adapter);
    expect(fetched).not.toBeNull();
    expect(new TextDecoder().decode(fetched!.body)).toBe(
      "certificate-pdf-bytes"
    );

    const signedUrl = await getSignedDownloadUrl(certKey, 240, adapter);
    const parsed = new URL(signedUrl);
    expect(parsed.pathname).toBe(`/glados-private/${certKey}`);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("240");

    await deleteObject(certKey, adapter);
    expect(await getObject(certKey, adapter)).toBeNull();
  });
});
