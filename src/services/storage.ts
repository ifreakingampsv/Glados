import crypto from "node:crypto";
import type { User } from "@prisma/client";
import { assertAdmin } from "@/lib/auth";
import { env } from "@/lib/env";

// D64: ONE thin service-layer module owns all object storage over a private
// Cloudflare R2 bucket. Never expose public buckets or unsigned raw URLs.

export const MAX_SIGNED_URL_EXPIRES_SECONDS = 900; // 15 minutes max

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array | Buffer | string;
  contentType?: string;
}

export interface PutObjectResult {
  key: string;
  size: number;
  contentType: string;
  sha256: string;
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

export interface StorageAdapter {
  put(input: PutObjectInput): Promise<PutObjectResult>;
  get(key: string): Promise<StoredObject | null>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  del(key: string): Promise<void>;
}

function sha256Hex(data: Uint8Array | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalUri(bucket: string, key: string): string {
  const segments = [bucket, ...key.split("/").filter(Boolean)];
  return "/" + segments.map(encodeRfc3986).join("/");
}

function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = "s3"
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function toBytes(body: Uint8Array | Buffer | string): Uint8Array {
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

export function createR2Adapter(
  config: R2Config,
  fetchImpl: typeof fetch = fetch
): StorageAdapter {
  const region = config.region ?? "auto";
  const baseEndpoint = config.endpoint.replace(/\/+$/, "");
  const endpointUrl = new URL(baseEndpoint);

  function signHeaders(
    method: string,
    path: string,
    payloadHash: string,
    extraHeaders: Record<string, string> = {},
    now: Date = new Date()
  ): Record<string, string> {
    const { amzDate, dateStamp } = toAmzDate(now);
    const headers: Record<string, string> = {
      host: endpointUrl.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };
    const sortedKeys = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders = sortedKeys
      .map((k) => `${k}:${headers[k].trim()}\n`)
      .join("");
    const signedHeaders = sortedKeys.join(";");
    const canonicalRequest = [
      method,
      path,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = deriveSigningKey(
      config.secretAccessKey,
      dateStamp,
      region
    );
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(stringToSign, "utf8")
      .digest("hex");

    return {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  return {
    async put(input: PutObjectInput): Promise<PutObjectResult> {
      const bytes = toBytes(input.body);
      const contentType = input.contentType ?? "application/octet-stream";
      const payloadHash = sha256Hex(bytes);
      const path = canonicalUri(config.bucket, input.key);
      const headers = signHeaders("PUT", path, payloadHash, {
        "content-type": contentType,
      });
      const res = await fetchImpl(`${baseEndpoint}${path}`, {
        method: "PUT",
        headers,
        body: Buffer.from(bytes),
      });
      if (!res.ok) {
        throw new Error(`R2 PUT failed (${res.status}): ${await res.text()}`);
      }
      return {
        key: input.key,
        size: bytes.byteLength,
        contentType,
        sha256: payloadHash,
      };
    },

    async get(key: string): Promise<StoredObject | null> {
      const path = canonicalUri(config.bucket, key);
      const emptyHash = sha256Hex("");
      const headers = signHeaders("GET", path, emptyHash);
      const res = await fetchImpl(`${baseEndpoint}${path}`, {
        method: "GET",
        headers,
      });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`R2 GET failed (${res.status}): ${await res.text()}`);
      }
      const ab = await res.arrayBuffer();
      return {
        body: new Uint8Array(ab),
        contentType:
          res.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
      const clampedExpires = Math.max(
        1,
        Math.min(MAX_SIGNED_URL_EXPIRES_SECONDS, Math.floor(expiresInSeconds))
      );
      const now = new Date();
      const { amzDate, dateStamp } = toAmzDate(now);
      const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
      const path = canonicalUri(config.bucket, key);

      const queryParams: Array<[string, string]> = [
        ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
        ["X-Amz-Credential", `${config.accessKeyId}/${credentialScope}`],
        ["X-Amz-Date", amzDate],
        ["X-Amz-Expires", String(clampedExpires)],
        ["X-Amz-SignedHeaders", "host"],
      ];
      queryParams.sort(([a], [b]) => a.localeCompare(b));
      const canonicalQuery = queryParams
        .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
        .join("&");

      const canonicalRequest = [
        "GET",
        path,
        canonicalQuery,
        `host:${endpointUrl.host}\n`,
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n");

      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join("\n");

      const signingKey = deriveSigningKey(
        config.secretAccessKey,
        dateStamp,
        region
      );
      const signature = crypto
        .createHmac("sha256", signingKey)
        .update(stringToSign, "utf8")
        .digest("hex");

      return `${baseEndpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
    },

    async del(key: string): Promise<void> {
      const path = canonicalUri(config.bucket, key);
      const emptyHash = sha256Hex("");
      const headers = signHeaders("DELETE", path, emptyHash);
      const res = await fetchImpl(`${baseEndpoint}${path}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(
          `R2 DELETE failed (${res.status}): ${await res.text()}`
        );
      }
    },
  };
}

// S3-compatible in-memory HTTP fake for contract testing and local dev fallback.
export function createInMemoryS3Fetch() {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  let lastAuthHeader: string | null = null;

  const fakeFetch: typeof fetch = async (input, init) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(urlStr);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    if (auth) lastAuthHeader = auth;

    if (!auth || !auth.startsWith("AWS4-HMAC-SHA256 ")) {
      return new Response("Forbidden: missing AWS4 signature", { status: 403 });
    }

    const key = url.pathname;
    if (method === "PUT") {
      const rawBody = init?.body;
      let bytes = new Uint8Array(0);
      if (rawBody instanceof Uint8Array) {
        bytes = new Uint8Array(rawBody);
      } else if (typeof rawBody === "string") {
        bytes = new TextEncoder().encode(rawBody);
      } else if (rawBody instanceof ArrayBuffer) {
        bytes = new Uint8Array(rawBody);
      }
      const contentType =
        headers.get("content-type") ?? "application/octet-stream";
      objects.set(key, { body: bytes, contentType });
      return new Response("", { status: 200 });
    }

    if (method === "GET") {
      const found = objects.get(key);
      if (!found) {
        return new Response("NoSuchKey", { status: 404 });
      }
      return new Response(Buffer.from(found.body), {
        status: 200,
        headers: { "content-type": found.contentType },
      });
    }

    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }

    return new Response("Method Not Allowed", { status: 405 });
  };

  return {
    fetch: fakeFetch,
    get lastAuthHeader() {
      return lastAuthHeader;
    },
    objects,
  };
}

const globalForStorage = globalThis as unknown as {
  defaultStorageAdapter?: StorageAdapter;
};

function getDefaultAdapter(): StorageAdapter {
  if (globalForStorage.defaultStorageAdapter) {
    return globalForStorage.defaultStorageAdapter;
  }
  if (
    env.r2Endpoint &&
    env.r2Bucket &&
    env.r2AccessKeyId &&
    env.r2SecretAccessKey
  ) {
    globalForStorage.defaultStorageAdapter = createR2Adapter({
      endpoint: env.r2Endpoint,
      bucket: env.r2Bucket,
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    });
    return globalForStorage.defaultStorageAdapter;
  }
  // Local dev / test fallback when R2 credentials are not set in env
  const localFake = createInMemoryS3Fetch();
  globalForStorage.defaultStorageAdapter = createR2Adapter(
    {
      endpoint: "https://local-r2.internal",
      bucket: "glados-local-private",
      accessKeyId: "LOCALDEVKEY",
      secretAccessKey: "LOCALDEVSECRET",
    },
    localFake.fetch
  );
  return globalForStorage.defaultStorageAdapter;
}

export async function putObject(
  input: PutObjectInput,
  adapter: StorageAdapter = getDefaultAdapter()
): Promise<PutObjectResult> {
  return adapter.put(input);
}

export async function getObject(
  key: string,
  adapter: StorageAdapter = getDefaultAdapter()
): Promise<StoredObject | null> {
  return adapter.get(key);
}

export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
  adapter: StorageAdapter = getDefaultAdapter()
): Promise<string> {
  return adapter.getSignedUrl(key, expiresInSeconds);
}

export async function deleteObject(
  key: string,
  adapter: StorageAdapter = getDefaultAdapter()
): Promise<void> {
  return adapter.del(key);
}

export async function runStorageProbe(
  admin: User,
  adapter: StorageAdapter = getDefaultAdapter()
) {
  assertAdmin(admin);
  const probeKey = `probes/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`;
  const expectedText = `glados-storage-probe-${Date.now()}`;

  await putObject(
    { key: probeKey, body: expectedText, contentType: "text/plain" },
    adapter
  );
  const fetched = await getObject(probeKey, adapter);
  if (!fetched) {
    throw new Error(
      "Storage probe failed: uploaded object was not found on GET"
    );
  }
  const actualText = new TextDecoder().decode(fetched.body);
  if (actualText !== expectedText) {
    throw new Error(
      "Storage probe failed: fetched bytes did not match uploaded payload"
    );
  }

  const signedUrl = await getSignedDownloadUrl(probeKey, 120, adapter);
  const parsedUrl = new URL(signedUrl);
  const expiresSeconds = Number(
    parsedUrl.searchParams.get("X-Amz-Expires") ?? "0"
  );

  await deleteObject(probeKey, adapter);
  const afterDelete = await getObject(probeKey, adapter);

  return {
    ok: afterDelete === null,
    key: probeKey,
    bytesVerified: fetched.body.byteLength,
    signedUrlExpiresSeconds: expiresSeconds,
    deleted: afterDelete === null,
  };
}
