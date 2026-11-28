/**
 * Per-browser launch-funnel state, kept in ONE signed cookie per funnel. The
 * public side has no sign-in, so this is all we know about a viewer:
 *   v  random visitor id (stats only; never linked to an email)
 *   s  per-viewer clock start (ms)
 *   w  highest watched percent per day id
 *   k  day ids unlocked with their URL key
 *   p  tracked URL parameters (org Funnels settings), first or last touch; optional
 *
 * HMAC-SHA256 signed so nobody can hand-edit their way past a lock. (Someone can
 * still replay the sync endpoint; this is a marketing funnel, not DRM.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ViewerFacts } from "./state";
import { cleanStoredParams, compactForCookie, mergeTouch, type Attribution, type TrackedParams } from "./tracking";

/** `params` is optional so cookies written before tracked parameters existed still decode. */
export type ViewerCookie = ViewerFacts & { visitorId: string; params?: TrackedParams };

export const VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
const MAX_DAYS = 60;

export function viewerCookieName(funnelId: string): string {
  return `pcf_${funnelId.replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;
}

/**
 * The signing key. FUNNELS_COOKIE_SECRET when set, otherwise a key derived from
 * AUTH_SECRET (never AUTH_SECRET itself, so a leaked funnel key signs nothing else).
 */
export function viewerSecret(env: { FUNNELS_COOKIE_SECRET?: string; AUTH_SECRET?: string }): string | null {
  if (env.FUNNELS_COOKIE_SECRET && env.FUNNELS_COOKIE_SECRET.length >= 16) return env.FUNNELS_COOKIE_SECRET;
  if (!env.AUTH_SECRET) return null;
  return createHmac("sha256", env.AUTH_SECRET).update("pubcommand:funnels:viewer-cookie:v1").digest("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function emptyViewerCookie(visitorId: string): ViewerCookie {
  return { visitorId, watched: {}, keys: [] };
}

function clampPercent(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

/** Normalize anything parsed from a cookie (or built in code) into a safe shape. */
export function normalizeViewer(raw: unknown): ViewerCookie | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const visitorId = typeof source.v === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(source.v) ? source.v : null;
  if (!visitorId) return null;
  const watched: Record<string, number> = {};
  if (source.w && typeof source.w === "object" && !Array.isArray(source.w)) {
    for (const [dayId, value] of Object.entries(source.w as Record<string, unknown>).slice(0, MAX_DAYS)) {
      const percent = clampPercent(value);
      if (percent !== null && /^[0-9a-f-]{36}$/i.test(dayId)) watched[dayId] = percent;
    }
  }
  const keys = Array.isArray(source.k) ? source.k.filter((item): item is string => typeof item === "string" && /^[0-9a-f-]{36}$/i.test(item)).slice(0, MAX_DAYS) : [];
  const start = typeof source.s === "number" && Number.isFinite(source.s) && source.s > 0 ? Math.round(source.s) : undefined;
  const params = cleanStoredParams(source.p);
  return { visitorId, start, watched, keys: [...new Set(keys)], ...(params ? { params } : {}) };
}

export function encodeViewer(viewer: ViewerCookie, secret: string): string {
  const params = compactForCookie(viewer.params);
  const compact = { v: viewer.visitorId, s: viewer.start, w: viewer.watched, k: viewer.keys, ...(params ? { p: params } : {}) };
  const payload = Buffer.from(JSON.stringify(compact)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Null when missing, malformed or tampered with. */
export function decodeViewer(value: string | null | undefined, secret: string | null): ViewerCookie | null {
  if (!value || !secret) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return normalizeViewer(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** Watched percent only ever goes up. */
export function recordWatch(viewer: ViewerCookie, dayId: string, percent: number): ViewerCookie {
  const value = clampPercent(percent) ?? 0;
  const current = viewer.watched[dayId] ?? 0;
  if (value <= current) return viewer;
  return { ...viewer, watched: { ...viewer.watched, [dayId]: value } };
}

export function rememberKey(viewer: ViewerCookie, dayId: string): ViewerCookie {
  if (viewer.keys.includes(dayId)) return viewer;
  return { ...viewer, keys: [...viewer.keys, dayId].slice(-MAX_DAYS) };
}

/** Starts the per-viewer clock on the first visit; later visits keep the first start. */
export function ensureStart(viewer: ViewerCookie, now: Date): ViewerCookie {
  return viewer.start ? viewer : { ...viewer, start: now.getTime() };
}

/** Keeps the tracked parameters a visitor arrived with (first touch) or the newest set (last touch). */
export function rememberParams(viewer: ViewerCookie, incoming: TrackedParams | null | undefined, attribution: Attribution): ViewerCookie {
  const next = compactForCookie(mergeTouch(viewer.params, incoming, attribution));
  if (JSON.stringify(next ?? null) === JSON.stringify(viewer.params ?? null)) return viewer;
  const rest: ViewerCookie = { visitorId: viewer.visitorId, watched: viewer.watched, keys: viewer.keys, ...(viewer.start ? { start: viewer.start } : {}) };
  return next ? { ...rest, params: next } : rest;
}
