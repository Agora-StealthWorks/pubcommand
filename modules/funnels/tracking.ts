/**
 * Tracked URL parameters (utm_source, utm_campaign, gclid, ...). PURE (no DB).
 *
 * An organization lists the query parameters it cares about once (Funnels →
 * Settings) and every funnel in the org records them: a visitor who lands on a
 * public page with any of them in the address keeps the values in their viewer
 * cookie, and every event and opt-in after that carries them. Attribution is
 * per visitor and per set: "first" keeps the first set of values a visitor
 * arrived with, "last" replaces it with the newest set.
 */

export const DEFAULT_TRACKED_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export const MAX_TRACKED_PARAMS = 20;
export const MAX_PARAM_VALUE = 200;
/** Budget for the params part of the viewer cookie (JSON characters), so the cookie stays small. */
export const MAX_COOKIE_PARAMS_JSON = 700;

export type Attribution = "first" | "last";
export const ATTRIBUTIONS: readonly Attribution[] = ["first", "last"];
export type TrackedParams = Record<string, string>;

const KEY = /^[a-z0-9_]{1,40}$/;

/** "UTM_Source " → "utm_source"; null when not a valid key (a-z, 0-9, _; 1–40 characters). */
export function normalizeParamKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return KEY.test(key) ? key : null;
}

/**
 * A clean tracked-parameter list: lowercase, valid keys only, no duplicates, at
 * most 20, in the order given. Accepts an array or text separated by commas,
 * spaces or new lines.
 */
export function normalizeTrackedParams(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const item of items) {
    const key = normalizeParamKey(item);
    if (key && !out.includes(key)) out.push(key);
    if (out.length >= MAX_TRACKED_PARAMS) break;
  }
  return out;
}

export function normalizeAttribution(raw: unknown): Attribution {
  return raw === "last" ? "last" : "first";
}

function cleanValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_PARAM_VALUE).trim();
  return value ? value : null;
}

type ParamSource = URLSearchParams | Record<string, unknown> | null | undefined;

/**
 * The tracked parameters present in a query (URLSearchParams or a plain record,
 * such as Next's searchParams). Keys match case-insensitively; values are
 * trimmed and cut to 200 characters; empty values are skipped. The first value
 * of a repeated key wins.
 */
export function pickTrackedParams(source: ParamSource, tracked: readonly string[]): TrackedParams {
  const out: TrackedParams = {};
  if (!source || !tracked.length) return out;
  const wanted = new Set(tracked);
  const entries: [string, unknown][] = source instanceof URLSearchParams ? [...source.entries()] : Object.entries(source).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]);
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeParamKey(rawKey);
    if (!key || !wanted.has(key) || key in out) continue;
    const value = cleanValue(rawValue);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** The tracked parameters in a full URL's query (e.g. the Referer of a page's sync call). */
export function paramsFromUrl(url: string | null | undefined, tracked: readonly string[]): TrackedParams {
  if (!url || !tracked.length) return {};
  try {
    return pickTrackedParams(new URL(url).searchParams, tracked);
  } catch {
    return {};
  }
}

export function hasParams(params: TrackedParams | null | undefined): params is TrackedParams {
  return Boolean(params && Object.keys(params).length);
}

/**
 * First touch keeps the set a visitor already has (if any); last touch takes
 * the newest non-empty set. Sets are never mixed, so one visitor's values
 * always come from one campaign link.
 */
export function mergeTouch(current: TrackedParams | null | undefined, incoming: TrackedParams | null | undefined, attribution: Attribution): TrackedParams | undefined {
  const had = hasParams(current) ? current : undefined;
  const got = hasParams(incoming) ? incoming : undefined;
  if (attribution === "first") return had ?? got;
  return got ?? had;
}

/**
 * Anything read back from a cookie or a JSON column, made safe: string values
 * only, valid keys, values cut to 200 characters, at most 20 keys. Undefined
 * when nothing is left.
 */
export function cleanStoredParams(raw: unknown): TrackedParams | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: TrackedParams = {};
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_TRACKED_PARAMS) break;
    const key = normalizeParamKey(rawKey);
    const value = cleanValue(rawValue);
    if (key && value !== null && !(key in out)) out[key] = value;
  }
  return hasParams(out) ? out : undefined;
}

/** The params kept in the viewer cookie: whole keys in order until the JSON budget is used up. */
export function compactForCookie(params: TrackedParams | null | undefined): TrackedParams | undefined {
  const clean = cleanStoredParams(params);
  if (!clean) return undefined;
  const out: TrackedParams = {};
  let size = 2;
  for (const [key, value] of Object.entries(clean)) {
    const extra = JSON.stringify(key).length + JSON.stringify(value).length + 2;
    if (size + extra > MAX_COOKIE_PARAMS_JSON) continue;
    out[key] = value;
    size += extra;
  }
  return hasParams(out) ? out : undefined;
}

/** Query keys that carry tracked values, for keeping them on an internal redirect (front door → module). */
export function trackedQuery(params: TrackedParams | null | undefined): string {
  if (!hasParams(params)) return "";
  return new URLSearchParams(params).toString();
}

/**
 * The params to record on an event or opt-in: the visitor's stored set merged
 * with what this request's page address carries (by attribution), limited to
 * the keys the org tracks today. Undefined when none.
 */
export function attributedParams(stored: TrackedParams | null | undefined, incoming: TrackedParams | null | undefined, tracked: readonly string[], attribution: Attribution): TrackedParams | undefined {
  const picked = pickTrackedParams(mergeTouch(stored, incoming, attribution) ?? {}, tracked);
  return hasParams(picked) ? picked : undefined;
}

/** CSV columns for stored params: the org's tracked keys first, then any other key a row carries (older settings). */
export function paramColumns(tracked: readonly string[], rows: readonly unknown[]): string[] {
  const columns = [...tracked];
  for (const row of rows) for (const key of Object.keys(cleanStoredParams(row) ?? {})) if (!columns.includes(key)) columns.push(key);
  return columns;
}

/** One row's values in `paramColumns` order ("" when missing). */
export function paramCells(columns: readonly string[], stored: unknown): string[] {
  const clean = cleanStoredParams(stored) ?? {};
  return columns.map((key) => clean[key] ?? "");
}
