/**
 * Bot API keys and file tokens. A key is shown once; only its SHA-256 is stored, so a database leak does
 * not leak working keys. Server-only (node:crypto); not exported from index.ts, which the editor imports.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_SCOPES = {
  "charts.render": "Make charts (POST /api/v1/charts) and read them back",
  "charts.bulk": "Run bulk batches (POST /api/v1/charts/bulk)",
  "charts.templates": "List templates (GET /api/v1/charts/templates)",
  "charts.search": "Search tickers (GET /api/v1/charts/tickers)",
} as const;
export type ApiScope = keyof typeof API_SCOPES;
export const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[];

export const KEY_PREFIX = "pcc_";
const KEY_BODY = /^pcc_[A-Za-z0-9_-]{43}$/;

export const RATE_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT = 60;
export const MAX_RATE_LIMIT = 600;

export type GeneratedKey = { key: string; prefix: string; hash: string };

/** A new key: "pcc_" + 32 random bytes (256 bits) in base64url. */
export function generateApiKey(): GeneratedKey {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function isApiKeyFormat(key: string): boolean {
  return KEY_BODY.test(key);
}

/** Constant-time check of a presented key against a stored hash. */
export function keyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The key from "Authorization: Bearer <key>" (or "x-api-key"), or null when absent or malformed. */
export function bearerKey(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  const key = match?.[1] ?? headers.get("x-api-key")?.trim() ?? "";
  return isApiKeyFormat(key) ? key : null;
}

/** Keep only known scopes, in canonical order, without duplicates. */
export function normalizeScopes(input: readonly unknown[]): ApiScope[] {
  const wanted = new Set(input.filter((value): value is string => typeof value === "string"));
  return ALL_SCOPES.filter((scope) => wanted.has(scope));
}

export function hasScope(scopes: readonly string[], needed: ApiScope): boolean {
  return scopes.includes(needed);
}

export function clampRateLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RATE_LIMIT;
  return Math.min(MAX_RATE_LIMIT, Math.max(1, Math.round(n)));
}

/** Rolling-window decision from the number of calls already made in the last RATE_WINDOW_MS. */
export function rateDecision(callsInWindow: number, limit: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const allowed = callsInWindow < limit;
  return { allowed, remaining: Math.max(0, limit - callsInWindow - (allowed ? 1 : 0)), retryAfterSeconds: allowed ? 0 : Math.ceil(RATE_WINDOW_MS / 1000) };
}

/** 18 random bytes (144 bits) in base64url: the credential in a public file link. */
export function generateFileToken(): string {
  return randomBytes(18).toString("base64url");
}

export function isFileToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{24}$/.test(value);
}
