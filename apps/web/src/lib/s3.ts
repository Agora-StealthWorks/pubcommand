import { createHash, createHmac } from "node:crypto";
import type { S3Config } from "@pubcommand/core";

/**
 * Minimal S3 client (AWS Signature V4, path-style URLs) for the platform bucket
 * (S3_* variables, Railway bucket). Enough for small platform jobs: put, get,
 * delete. No SDK dependency.
 */

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/** The signed request for one object (exported for tests). */
export function signS3Request(config: S3Config, input: { method: "GET" | "PUT" | "DELETE" | "HEAD"; key: string; body?: Uint8Array; contentType?: string; now?: Date }) {
  const endpoint = new URL(config.endpoint);
  const path = `/${encodeKey(config.bucket)}/${encodeKey(input.key)}`;
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(input.body ?? new Uint8Array());
  const headers: Record<string, string> = { host: endpoint.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (input.contentType) headers["content-type"] = input.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [input.method, path, "", ...names.map((name) => `${name}:${headers[name]!.trim()}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { url: `${endpoint.origin}${path}`, headers };
}

/** Statuses the bucket returns for a passing hiccup (e.g. 408 RequestCanceled); worth trying again. */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const ATTEMPTS = 4;

async function send(config: S3Config, method: "GET" | "PUT" | "DELETE" | "HEAD", key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    // Sign each attempt afresh: the signature carries a timestamp.
    const signed = signS3Request(config, { method, key, body, contentType });
    const { host: _host, ...headers } = signed.headers;
    try {
      const response = await fetch(signed.url, {
        method,
        headers,
        ...(body ? { body: Buffer.from(body) } : {}),
        signal: AbortSignal.timeout(body && body.length > 5_000_000 ? 300_000 : 60_000),
      });
      if (!TRANSIENT.has(response.status) || attempt === ATTEMPTS) return response;
      await response.body?.cancel();
    } catch (error) {
      // Network drop or timeout: retry, and rethrow after the last attempt.
      lastError = error;
      if (attempt === ATTEMPTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

export async function s3Put(config: S3Config, key: string, body: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
  const response = await send(config, "PUT", key, body, contentType);
  if (!response.ok) throw new Error(`Bucket upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
}

/** The object's bytes, or null when it does not exist. */
export async function s3Get(config: S3Config, key: string): Promise<Uint8Array | null> {
  const response = await send(config, "GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Bucket read failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function s3Delete(config: S3Config, key: string): Promise<void> {
  const response = await send(config, "DELETE", key);
  if (!response.ok && response.status !== 404) throw new Error(`Bucket delete failed (${response.status})`);
}
