import { createHmac, timingSafeEqual } from "node:crypto";
import { currentRequest } from "./request";

/**
 * Signed preview links. A Preview button shows drafts and unpublished pages,
 * which normally needs a signed-in member. On a custom domain the sign-in
 * cookie (set for the PubCommand host) is never sent, so preview links carry
 * `pv=<token>`: an HMAC (AUTH_SECRET) of the organization, the one thing it
 * previews (e.g. `miniblog:<site id>`) and an expiry. It grants viewing only,
 * for that one page, until it expires; it cannot sign anyone in.
 */

export const PREVIEW_PARAM = "pv";
const TTL_SECONDS = 7 * 24 * 3600;

function secret(): string | null {
  return process.env.AUTH_SECRET || null;
}

function sign(organizationId: string, scope: string, expires: number, key: string): string {
  return createHmac("sha256", key).update(`preview:${organizationId}:${scope}:${expires}`).digest("base64url").slice(0, 32);
}

/** A token for previewing `scope` (e.g. `miniblog:<id>`) of this organization. Null without AUTH_SECRET. */
export function previewToken(organizationId: string, scope: string, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  // Rounded to the hour so a page shows the same link on every reload within the hour.
  const expires = Math.ceil((now / 1000 + TTL_SECONDS) / 3600) * 3600;
  return `${expires.toString(36)}.${sign(organizationId, scope, expires, key)}`;
}

export function previewTokenValid(token: string | null | undefined, organizationId: string, scope: string, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token || token.length > 80) return false;
  const [expText = "", signature = ""] = token.split(".");
  const expires = parseInt(expText, 36);
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(sign(organizationId, scope, expires, key));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The preview token the current request came with, if any (unchecked). */
export async function currentPreviewToken(): Promise<string | null> {
  const { search } = await currentRequest();
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(PREVIEW_PARAM);
}

/** Does the current request carry a valid preview token for `scope`? */
export async function requestHasPreviewToken(organizationId: string, scope: string): Promise<boolean> {
  return previewTokenValid(await currentPreviewToken(), organizationId, scope);
}

/** `url` with `preview=1` and a signed token for `scope` added. */
export function withPreview(url: string, organizationId: string, scope: string, extra: Record<string, string> = {}): string {
  const token = previewToken(organizationId, scope);
  const [base = "", query = ""] = url.split(/\?(.*)/s);
  const params = new URLSearchParams(query);
  params.set("preview", "1");
  if (token) params.set(PREVIEW_PARAM, token);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${base}?${params.toString()}`;
}
