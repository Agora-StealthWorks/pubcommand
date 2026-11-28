/**
 * Link lists (a module's resources, the waitlist's pre-event homework): each a
 * button or a text link, optionally in a new tab. PURE.
 */
import { formatZoned } from "./time";

/** style "locked": a teaser (e.g. "Download transcript") with a lock icon; it links to the offer (#offer or a URL). */
export type LinkItem = { label: string; url: string; style: "button" | "link" | "locked"; newTab: boolean };

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text.slice(0, 1000) : null;
  } catch {
    return null;
  }
}

/** Validated links from stored JSON. Older rows ({label, url}) are buttons that open in a new tab. */
export function linkItems(value: unknown, max = 20): LinkItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}))
    .map((raw) => {
      const style = raw.style === "link" ? ("link" as const) : raw.style === "locked" ? ("locked" as const) : ("button" as const);
      const url = style === "locked" && typeof raw.url === "string" && raw.url.trim() === "#offer" ? "#offer" : httpUrl(raw.url);
      const label = typeof raw.label === "string" ? raw.label.replace(/\s+/g, " ").trim().slice(0, 200) : "";
      return url ? { label: label || url, url, style, newTab: url === "#offer" ? false : raw.newTab !== false } : null;
    })
    .filter((item): item is LinkItem => item !== null)
    .slice(0, max);
}

/** Read the builder's link rows (label_N, url_N, style_N, newTab_N for N = 0…). */
export function linkItemsFromForm(get: (name: string) => string | null, prefix: string, max = 20): LinkItem[] {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < max; index += 1) {
    const url = get(`${prefix}_url_${index}`);
    if (url === null) continue;
    const style = get(`${prefix}_style_${index}`);
    rows.push({ label: get(`${prefix}_label_${index}`) ?? "", url, style: style === "link" || style === "locked" ? style : "button", newTab: get(`${prefix}_newTab_${index}`) === "on" });
  }
  return linkItems(rows, max);
}

/** "8:00 PM ET" (the time part of formatZoned). */
export function formatTimeOnly(date: Date, timeZone: string): string {
  const full = formatZoned(date, timeZone);
  const at = full.lastIndexOf(" at ");
  return at >= 0 ? full.slice(at + 4) : full;
}

/** "Friday, November 6, 2026" in the zone. */
export function formatZonedDateLong(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
}
