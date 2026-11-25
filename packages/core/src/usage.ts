/**
 * App usage helpers (pure): idle sign-out, page areas, and the text snapshot of
 * what someone created. The database side lives in apps/web/src/features/usage.
 */

/** Sign people out after 12 hours without activity unless a console admin set another value. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 12 * 60;
export const MIN_IDLE_TIMEOUT_MINUTES = 15;
export const MAX_IDLE_TIMEOUT_MINUTES = 30 * 24 * 60;

/** Choices offered in the console (minutes). */
export const IDLE_TIMEOUT_CHOICES: readonly { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
  { minutes: 720, label: "12 hours (default)" },
  { minutes: 1440, label: "24 hours" },
  { minutes: 4320, label: "3 days" },
  { minutes: 10080, label: "7 days" },
  { minutes: 43200, label: "30 days" },
];

/** A session's last activity is written at most this often (and on every active heartbeat after it). */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export function idleTimeoutMinutes(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  return Math.min(Math.max(Math.round(value), MIN_IDLE_TIMEOUT_MINUTES), MAX_IDLE_TIMEOUT_MINUTES);
}

export function idleTimeoutLabel(value: number | null | undefined): string {
  const minutes = idleTimeoutMinutes(value);
  const choice = IDLE_TIMEOUT_CHOICES.find((item) => item.minutes === minutes);
  if (choice) return choice.label.replace(" (default)", "");
  if (minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Parses the console's idle-timeout field: "" or "default" = null (12 hours). */
export function parseIdleTimeoutChoice(raw: string): { ok: true; minutes: number | null } | { ok: false; reason: string } {
  const value = raw.trim();
  if (value === "" || value === "default") return { ok: true, minutes: null };
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < MIN_IDLE_TIMEOUT_MINUTES || minutes > MAX_IDLE_TIMEOUT_MINUTES) {
    return { ok: false, reason: `Choose between ${MIN_IDLE_TIMEOUT_MINUTES} minutes and 30 days.` };
  }
  return { ok: true, minutes: minutes === DEFAULT_IDLE_TIMEOUT_MINUTES ? null : minutes };
}

/** True when a session has been idle for longer than the person's timeout. */
export function sessionIdleExpired(lastActiveAt: Date, timeoutMinutes: number | null | undefined, now: Date = new Date()): boolean {
  return now.getTime() - lastActiveAt.getTime() > idleTimeoutMinutes(timeoutMinutes) * 60_000;
}

export function sessionNeedsTouch(lastActiveAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastActiveAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+|[0-9a-z]{20,})$/i;

/**
 * The app and page area of an in-app path: "/forms/2b1c…/edit" → { app: "forms", area: "/forms/:id/edit" }.
 * Ids become ":id", only the first four segments are kept, and "/" is the dashboard.
 */
export function usageArea(pathname: string): { app: string; area: string } {
  const path = (pathname.split(/[?#]/)[0] ?? "/").toLowerCase();
  const segments = path
    .split("/")
    .filter(Boolean)
    .slice(0, 4)
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment.replace(/[^a-z0-9._-]/g, "").slice(0, 40) || ":x"));
  if (segments.length === 0) return { app: "dashboard", area: "/" };
  return { app: segments[0]!, area: `/${segments.join("/")}`.slice(0, 160) };
}

/** "forms.form.created" → { app: "forms", verb: "created" }. */
export function activityParts(action: string): { app: string; verb: string } {
  const parts = action.split(".").filter(Boolean);
  return { app: parts[0] ?? "other", verb: parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? "changed") };
}

/** "promo_package_component" → "promo package component". */
export function targetLabel(targetType: string): string {
  return targetType.replace(/_/g, " ").trim() || "item";
}

/** One readable line for the activity feed. */
export function activitySummary(input: { action: string; targetType: string; title?: string | null }): string {
  const { verb } = activityParts(input.action);
  const what = targetLabel(input.targetType);
  const name = input.title?.trim() ? ` "${input.title.trim().slice(0, 140)}"` : "";
  return `${verb.replace(/_/g, " ")} ${what}${name}`;
}

// ── Content snapshots ─────────────────────────────────────────────────────

/** Field names never copied: secrets, contact details and plumbing. */
const SKIP_KEY =
  /(^id$|Id$|_id$|hash|token|secret|cipher|password|apikey|api_key|key$|email|phone|^ip$|address|cookie|session|credential|oauth|webhook|signature|mime|checksum|^data$|bytes|^slug$|createdAt|updatedAt|deletedAt|At$|color|font|css|^style|^theme|position|order$|^sort|^size$|width|height|url$|^url|href|src$|path$)/i;

/** Field names that usually hold the copy people write, shown first. */
const TITLE_KEY = /^(title|name|headline|subject|subjectLine|label|heading)$/i;

const MAX_FIELD = 1_200;

export function plainText(value: string): string {
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function looksLikeCopy(text: string): boolean {
  if (text.length < 2) return false;
  if (/^[0-9a-f-]{20,}$/i.test(text)) return false;
  if (/^(https?:|data:|\/)/i.test(text)) return false;
  if (/^[A-Z0-9_]+$/.test(text) && text.length < 20) return false; // enum values (DRAFT, ACTIVE)
  return /[a-z]/i.test(text);
}

function collect(value: unknown, key: string, out: string[], depth: number): void {
  if (out.join("\n").length > 6_000 || depth > 6) return;
  if (value == null) return;
  if (typeof value === "string") {
    const text = plainText(value);
    if (looksLikeCopy(text)) out.push(key ? `${key}: ${text.slice(0, MAX_FIELD)}` : text.slice(0, MAX_FIELD));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) collect(item, key, out, depth + 1);
    return;
  }
  if (typeof value === "object" && !(value instanceof Date) && !(value instanceof Uint8Array)) {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEY.test(childKey)) continue;
      collect(child, childKey, out, depth + 1);
    }
  }
}

/**
 * A plain-text snapshot of a record's copy: titles first, then other text fields and the
 * text inside JSON (form fields, blocks, sections). Secrets, contact details, ids, URLs and
 * styling are skipped. Returns the best title and the capped text.
 */
export function contentSnapshot(record: Record<string, unknown>, options: { maxLength?: number } = {}): { title: string | null; content: string | null } {
  const max = options.maxLength ?? 4_000;
  let title: string | null = null;
  const lines: string[] = [];
  const entries = Object.entries(record).filter(([key]) => !SKIP_KEY.test(key) || TITLE_KEY.test(key));
  for (const [key, value] of entries) {
    if (!TITLE_KEY.test(key) || typeof value !== "string") continue;
    const text = plainText(value);
    if (!looksLikeCopy(text)) continue;
    title ??= text.slice(0, 200);
    lines.push(`${key}: ${text.slice(0, 300)}`);
  }
  for (const [key, value] of entries) {
    if (TITLE_KEY.test(key) && typeof value === "string") continue;
    collect(value, key, lines, 0);
  }
  const seen = new Set<string>();
  const unique = lines.filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
  const content = unique.join("\n").slice(0, max).trim();
  return { title, content: content || null };
}

/** Actions with nothing worth copying (or that would copy something private). */
export const SNAPSHOT_SKIP_TARGETS: ReadonlySet<string> = new Set([
  "user",
  "role",
  "membership",
  "exclusion",
  "ai_agent",
  "ai_agent_token",
  "chart_api_key",
  "intel_gmail_account",
  "calendar_airtable_connection",
  "support_connection",
  "web_member",
  "web_member_token",
  "web_signup",
  "email_sender",
  "custom_domain",
  "domain_purchase",
  "form_response",
  "funnel_optin",
  "funnel_sms_optin",
  "text_optin",
  "org_email_settings",
]);

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.round(hours / 24)}d ${hours % 24}h`;
}
