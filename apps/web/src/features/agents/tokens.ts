/**
 * Agent credentials. Server-only (node:crypto). A token is shown once; only its SHA-256 is stored.
 *   pca_…  API key (no expiry, until revoked): for agents configured with a header, e.g. Grok or OpenAI API calls.
 *   pcat_… OAuth access token (1 hour): issued to an MCP connector after its owner signs in and approves.
 *   pcar_… OAuth refresh token (60 days, rotated on every use).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenKind = "key" | "access" | "refresh";

const PREFIX: Record<TokenKind, string> = { key: "pca_", access: "pcat_", refresh: "pcar_" };

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
export const OAUTH_CODE_TTL_SECONDS = 10 * 60;

/** Calls allowed per agent per rolling minute. */
export const AGENT_RATE_LIMIT = 120;
export const RATE_WINDOW_MS = 60_000;

export type GeneratedToken = { token: string; prefix: string; hash: string };

export function generateToken(kind: TokenKind): GeneratedToken {
  const token = `${PREFIX[kind]}${randomBytes(32).toString("base64url")}`;
  return { token, prefix: token.slice(0, PREFIX[kind].length + 6), hash: hashToken(token) };
}

/** A random opaque value (OAuth codes and client ids). */
export function randomValue(prefix = ""): string {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Which kind a presented token claims to be, from its prefix. */
export function tokenKind(token: string): TokenKind | null {
  if (/^pcat_[A-Za-z0-9_-]{43}$/.test(token)) return "access";
  if (/^pcar_[A-Za-z0-9_-]{43}$/.test(token)) return "refresh";
  if (/^pca_[A-Za-z0-9_-]{43}$/.test(token)) return "key";
  return null;
}

/** The token from "Authorization: Bearer <token>" (or a bare "Authorization: pca_…", as some API clients send it), or null. */
export function bearerToken(headers: { get(name: string): string | null }): string | null {
  const value = (headers.get("authorization") ?? "").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  if (match) return match[1] ?? null;
  return /^pca_\S+$/.test(value) ? value : null;
}

/** PKCE (RFC 7636, S256 only): does the verifier match the challenge stored with the code? */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * Desktop editors that sign in to MCP servers through their own app link (RFC 8252 private-use
 * URI schemes). Cursor uses cursor://anysphere.cursor-mcp/oauth/callback on some installs
 * (others use http://localhost:8787/callback); VS Code and Windsurf do the same with theirs.
 */
const NATIVE_APP_SCHEMES = new Set(["cursor:", "vscode:", "vscode-insiders:", "windsurf:"]);

/**
 * Redirect addresses a connector may register: https anywhere, http only on loopback (desktop
 * apps), or a known editor's app link. No fragments. Claude uses
 * https://claude.ai/api/mcp/auth_callback, ChatGPT https://chatgpt.com/connector_platform_oauth_redirect.
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return NATIVE_APP_SCHEMES.has(url.protocol);
}

/** Sliding-window rate decision, given calls in the last minute. */
export function rateAllowed(recentCalls: number, limit = AGENT_RATE_LIMIT): boolean {
  return recentCalls < limit;
}
