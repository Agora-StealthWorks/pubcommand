/**
 * Agent keys, ingest keys and webhook secrets. Server-only (node:crypto).
 * A key is shown once; only its SHA-256 is stored, so a database leak leaks no working key.
 * Secrets the server must read back (an ElevenLabs API key, a webhook signing secret) are
 * encrypted with AES-256-GCM under a key derived from AUTH_SECRET.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const AGENT_KEY_PREFIX = "psk_";
export const INGEST_KEY_PREFIX = "psi_";
const AGENT_KEY_FORMAT = /^psk_[A-Za-z0-9_-]{43}$/;
const INGEST_KEY_FORMAT = /^psi_[A-Za-z0-9_-]{43}$/;

export type MintedKey = { key: string; prefix: string; hash: string };

function mint(prefix: string): MintedKey {
  const key = `${prefix}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export const mintAgentKey = (): MintedKey => mint(AGENT_KEY_PREFIX);
export const mintIngestKey = (): MintedKey => mint(INGEST_KEY_PREFIX);

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Constant-time check of a presented key against a stored hash. */
export function keyMatches(key: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The key from "Authorization: Bearer psk_…" or "x-api-key", or null when absent or malformed. */
export function presentedKey(headers: { get(name: string): string | null }, kind: "agent" | "ingest" = "agent"): string | null {
  const auth = headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  const key = match?.[1] ?? headers.get("x-api-key")?.trim() ?? "";
  return (kind === "agent" ? AGENT_KEY_FORMAT : INGEST_KEY_FORMAT).test(key) ? key : null;
}

function aesKey(secret: string): Buffer {
  if (secret.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return createHash("sha256").update(`support-knowledge:${secret}`).digest();
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(secret), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["s1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "s1" || !iv || !tag || !data) throw new Error("Unreadable stored secret.");
  const decipher = createDecipheriv("aes-256-gcm", aesKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** "…abcd": enough to recognise a stored secret, never enough to use it. */
export function secretHint(value: string): string {
  const v = value.trim();
  return v.length <= 8 ? "…" : `…${v.slice(-4)}`;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * ElevenLabs signs post-call webhooks with header `ElevenLabs-Signature: t=<unix>,v0=<hex>`
 * where v0 = HMAC-SHA256(secret, "<t>.<raw body>"). Rejects stale timestamps (replay).
 */
export function verifyWebhookSignature(input: { header: string | null; body: string; secret: string; nowSeconds: number; toleranceSeconds?: number }): boolean {
  if (!input.header) return false;
  const parts = Object.fromEntries(
    input.header.split(",").map((part) => {
      const [k, ...v] = part.trim().split("=");
      return [k ?? "", v.join("=")];
    }),
  );
  const t = Number(parts.t);
  const v0 = parts.v0 ?? "";
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/i.test(v0)) return false;
  if (Math.abs(input.nowSeconds - t) > (input.toleranceSeconds ?? 30 * 60)) return false;
  const expected = createHmac("sha256", input.secret).update(`${t}.${input.body}`).digest();
  const given = Buffer.from(v0, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signWebhook(body: string, secret: string, t: number): string {
  return `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export const RATE_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT = 120;
export const MAX_RATE_LIMIT = 1_200;

export function clampRateLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATE_LIMIT;
  return Math.min(MAX_RATE_LIMIT, Math.max(1, Math.round(n)));
}

export function rateDecision(callsInWindow: number, limit: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const allowed = callsInWindow < limit;
  return { allowed, remaining: Math.max(0, limit - callsInWindow - (allowed ? 1 : 0)), retryAfterSeconds: allowed ? 0 : Math.ceil(RATE_WINDOW_MS / 1000) };
}
