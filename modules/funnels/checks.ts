/**
 * Publish checks, slugs and small validators shared by the builder and the
 * server actions. Errors block publishing; warnings are shown but allowed.
 */
import type { CloseMode, FunnelMode, Progression, SiteType, TimingMode } from "./state";
import { parseVideo } from "./video";

export function normalizeSlug(input: string, max = 60): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug);
}

export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isHexColor(value: string | null | undefined): boolean {
  return Boolean(value) && /^#[0-9a-f]{6}$/i.test(value!.trim());
}

export function safeColor(value: string | null | undefined, fallback: string): string {
  return isHexColor(value) ? value!.trim().toLowerCase() : fallback;
}

/** Readable text colour on a background colour. */
export function contrastText(hex: string): string {
  const value = safeColor(hex, "#111827").slice(1);
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!) > 0.45 ? "#0b1220" : "#ffffff";
}

export type FunnelCheckInput = {
  name: string;
  slug: string;
  mode: FunnelMode;
  timing: TimingMode;
  startAt: Date | null;
  endAt: Date | null;
  closeAfterHours: number | null;
  closeMode: CloseMode;
  closeRedirectUrl: string | null;
  progression: Progression;
  /** Scheduled / watch %: email links (?k=) can also force-unlock modules. */
  keyForceUnlock?: boolean;
  buildMode: "as_you_go" | "prebuilt";
  livestreamUrl: string | null;
  privacyUrl: string | null;
  optinMode: "none" | "email" | "form";
  optinFormSlug: string | null;
  days: {
    position: number;
    title: string;
    videoProvider: string | null;
    videoId: string | null;
    isLive: boolean;
    liveStartAt: Date | null;
    liveUrl: string | null;
    unlockKey: string;
    /** Optional (older callers): text modules, CTA and calendar checks. */
    navLabel?: string | null;
    kind?: string;
    hasBody?: boolean;
    liveEndAt?: Date | null;
    liveOverride?: string;
    calendarUrl?: string | null;
    ctaReveal?: string;
    ctaText?: string;
    ctaUrl?: string;
    ctaAt?: Date | null;
  }[];
  /** Add to calendar (live funnels). */
  calendar?: { enabled: boolean; mode: string; url: string | null };
  /** Microsite checks. Optional so older callers keep working (defaults: launch, no extras). */
  siteType?: SiteType;
  homeBlockCount?: number;
  navItems?: { kind: string; label: string; title: string; slug: string; url: string; optinMode: string; optinFormSlug: string | null }[];
  deadlineBar?: { enabled: boolean; target: string; at: Date | null };
};

export type CheckResult = { errors: string[]; warnings: string[] };

export function checkFunnel(input: FunnelCheckInput): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.name.trim()) errors.push("Give the funnel a name.");
  if (!isValidSlug(input.slug)) errors.push("The link name must be lowercase letters, numbers and dashes.");
  const microsite = input.siteType === "microsite";
  if (input.days.length === 0 && !microsite) errors.push("Add at least one day.");
  if (input.days.length === 0 && microsite) warnings.push("This microsite has no modules yet, so there is no video navigation.");
  if (microsite && !input.homeBlockCount) warnings.push("The microsite's home page has no blocks yet (Home page tab), so visitors see an empty page.");
  const fixedClock = input.mode === "live" || input.timing === "fixed";
  if (fixedClock && !input.startAt) errors.push("Set the start date and time.");
  if (fixedClock && input.closeMode !== "never" && !input.endAt) warnings.push("No close date is set, so the funnel stays open until you close it.");
  if (fixedClock && input.startAt && input.endAt && input.endAt <= input.startAt) errors.push("The close date must be after the start date.");
  if (!fixedClock && input.closeMode !== "never" && !input.closeAfterHours) warnings.push("Per-viewer funnels close only when “close after” hours are set.");
  if (input.closeMode === "redirect" && !isHttpUrl(input.closeRedirectUrl)) errors.push("Closing by redirect needs a web address to send people to.");
  if (!isHttpUrl(input.privacyUrl)) errors.push("Add a privacy-policy link (Design → Footer). Every public page shows it.");
  if (input.optinMode === "form" && !input.optinFormSlug) errors.push("Pick the form to show on the waitlist, or switch the opt-in off.");
  const positions = new Set<number>();
  const calendarByUrl = input.mode === "live" && input.calendar?.enabled && input.calendar.mode === "url" && !isHttpUrl(input.calendar.url);
  const missingCalendar: string[] = [];
  for (const day of input.days) {
    const label = day.navLabel?.trim() || `Day ${day.position}`;
    if (positions.has(day.position)) errors.push(`Two days share position ${day.position}.`);
    positions.add(day.position);
    const liveDay = input.mode === "live" && day.isLive;
    const text = day.kind === "text" && !liveDay;
    const hasVideo = Boolean(day.videoId && parseVideo(day.videoId, day.videoProvider));
    const hasContent = text ? Boolean(day.hasBody) : hasVideo;
    if (!day.title.trim()) warnings.push(`${label} has no title.`);
    if (!text && day.videoId && !hasVideo) errors.push(`${label}: the video is not a Wistia, YouTube or Vidalytics video.`);
    if (liveDay) {
      if (!day.liveStartAt && (day.liveOverride ?? "auto") === "auto") errors.push(`${label}: set the live session's start time.`);
      if (!isHttpUrl(day.liveUrl) && !isHttpUrl(input.livestreamUrl)) errors.push(`${label}: add a livestream room link (on the day or for the whole funnel).`);
      if (day.liveStartAt && day.liveEndAt && day.liveEndAt <= day.liveStartAt) warnings.push(`${label}: the live end time is before the start, so it is treated as a 3-hour session. Fix the end time.`);
      if (calendarByUrl && !isHttpUrl(day.calendarUrl)) missingCalendar.push(label);
    } else if (!hasContent) {
      const what = text ? "content" : "video";
      if (input.buildMode === "prebuilt") errors.push(`${label} has no ${what} (pre-built funnels need every module before publishing).`);
      else warnings.push(`${label} has no ${what} yet, so it shows “coming soon”.`);
    }
    const reveal = day.ctaReveal ?? "none";
    if (reveal !== "none" && (!(day.ctaText ?? "").trim() || !(day.ctaUrl ?? "").trim())) errors.push(`${label}: the call-to-action button needs both text and a link.`);
    if (reveal === "datetime" && !day.ctaAt) errors.push(`${label}: set the time the call-to-action appears.`);
    if (reveal === "video_time" && text) warnings.push(`${label}: text modules have no video, so a call to action timed to the video never appears.`);
    else if (reveal === "video_time" && !hasVideo && !liveDay) warnings.push(`${label}: the call to action is timed to the video, but there is no video yet.`);
    if (input.progression === "url_key" && day.position > 1 && !day.unlockKey.trim()) errors.push(`${label}: it needs an unlock key.`);
    else if (input.keyForceUnlock && (input.progression === "scheduled" || input.progression === "watch_percent") && day.position > 1 && !liveDay && !day.unlockKey.trim()) warnings.push(`${label}: it has no link key, so email links cannot force-unlock it.`);
  }
  if (missingCalendar.length) warnings.push(`Add to calendar uses a calendar link, but none is set for: ${missingCalendar.join(", ")}. No button shows there.`);
  const pageSlugs = new Set<string>();
  for (const item of input.navItems ?? []) {
    const label = item.label.trim() || item.title.trim() || (item.kind === "link" ? "A link" : item.kind === "placeholder" ? "A placeholder" : "A page");
    if (item.kind === "page") {
      if (!isValidSlug(item.slug)) errors.push(`${label}: give the page a link name (lowercase letters, numbers and dashes).`);
      else if (pageSlugs.has(item.slug)) errors.push(`Two pages share the link name “${item.slug}”.`);
      pageSlugs.add(item.slug);
      if (item.optinMode === "form" && !item.optinFormSlug) errors.push(`${label}: pick the form to show under the page, or switch its opt-in off.`);
    }
    if (item.kind === "link" && !isHttpUrl(item.url)) errors.push(`${label}: the link needs a web address (https://…).`);
  }
  if (input.deadlineBar?.enabled) {
    if (input.deadlineBar.target === "custom" && !input.deadlineBar.at) errors.push("The deadline bar counts down to a set time, but no time is set.");
    if (input.deadlineBar.target === "end" && fixedClock && !input.endAt) warnings.push("The deadline bar counts down to the close, but no close date is set, so it never shows.");
    if (input.deadlineBar.target === "end" && !fixedClock && !input.closeAfterHours) warnings.push("The deadline bar counts down to each viewer's close, but “close after” hours are not set, so it never shows.");
  }
  return { errors, warnings };
}

/** A random URL key: 10 lowercase letters and digits. */
export function newUnlockKey(random: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let key = "";
  for (let index = 0; index < 10; index += 1) key += alphabet[Math.floor(random() * alphabet.length)];
  return key;
}

/** One CSV cell: quoted, and with spreadsheet formulas neutralized. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  // Plain numbers (including E.164 phones like +15551234567) are not formulas.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type ResourceLink = { label: string; url: string };

/** Parse "Label | https://…" lines into resource links. Bad lines are dropped. */
export function parseResources(text: string): ResourceLink[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, url] = line.includes("|") ? line.split("|").map((part) => part.trim()) : ["", line];
      return { label: (label || url || "").slice(0, 120), url: (url ?? "").slice(0, 500) };
    })
    .filter((link) => isHttpUrl(link.url))
    .slice(0, 12);
}

export function resourcesText(links: unknown): string {
  if (!Array.isArray(links)) return "";
  return links
    .map((link) => (link && typeof link === "object" ? `${(link as ResourceLink).label} | ${(link as ResourceLink).url}` : ""))
    .filter(Boolean)
    .join("\n");
}
