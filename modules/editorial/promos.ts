/**
 * The Calendar's own promos (calendar_promos). Pure rules: field lists, the launch event a
 * promo makes, and the activity entries a save writes. No database access here.
 */
import { isDay } from "./dates";

export const PROMO_TYPES = ["Front-end", "Mid-tier", "Back-end", "Renewal"] as const;
export const PROMO_FORMATS = ["VSL", "Live webinar (hotlist build)", "Open house", "VSL + watch party", "Live demo / pitch deck", "Text", "Other"] as const;

/** Stages where a promo is not (or no longer) a real, scheduled launch. */
const NOT_SCHEDULED = ["idea", "tabled", "cancelled", "canceled", "complete"];

/** A promo gets a launch event only when it is real and scheduled and has a date. */
export function promoIsSchedulable(stage: string | null | undefined): boolean {
  return !NOT_SCHEDULED.includes((stage ?? "").trim().toLowerCase());
}

/** The calendar date for a promo's launch event: its launch date, else its targeted date. */
export function launchDay(p: { launchDate: string | null; targetedDate: string | null }): string | null {
  return (isDay(p.launchDate) ? p.launchDate : null) ?? (isDay(p.targetedDate) ? p.targetedDate : null);
}

/** Event format for a promo format, so the launch event reads right on the calendar. */
export function launchFormat(format: string | null | undefined): string | null {
  const f = (format ?? "").toLowerCase();
  if (f.includes("open house")) return "Open house";
  if (f.includes("watch")) return "Watch party";
  if (f.includes("demo") || f.includes("pitch")) return "Demo";
  if (f.includes("webinar") || f.includes("hotlist")) return "Webinar";
  if (f.includes("vsl")) return "Video drop";
  return null;
}

export type LaunchPlan =
  | { action: "none" }
  | { action: "create"; name: string; eventDate: string; format: string | null; offer: string | null; hosts: string[] }
  | { action: "update"; name: string; eventDate: string };

/**
 * What to do with a promo's launch event after a save. A launch event is created once (never
 * re-created after someone deletes it); while it exists, its name and date follow the promo.
 */
export function planLaunchEvent(
  p: { name: string; stage: string; format: string | null; product: string | null; gurus: string[]; launchDate: string | null; targetedDate: string | null; launchEventCreated: boolean },
  existingEvent: { live: boolean } | null,
): LaunchPlan {
  const day = launchDay(p);
  if (!day) return { action: "none" };
  if (!p.launchEventCreated) {
    if (!promoIsSchedulable(p.stage)) return { action: "none" };
    return { action: "create", name: p.name, eventDate: day, format: launchFormat(p.format), offer: p.product, hosts: p.gurus.slice(0, 10) };
  }
  if (existingEvent?.live) return { action: "update", name: p.name, eventDate: day };
  return { action: "none" };
}

export type PromoSnapshot = {
  name: string;
  stage: string;
  promoType: string | null;
  format: string | null;
  product: string | null;
  writers: string[];
  gurus: string[];
  launchDate: string | null;
  launchEstimated: boolean;
  targetedDate: string | null;
};

export type ActivityEntry = { kind: "stage" | "launchDate" | "targetedDate" | "field"; field: string; fromValue: string | null; toValue: string | null };

const TRACKED: { key: keyof PromoSnapshot; label: string; kind: ActivityEntry["kind"] }[] = [
  { key: "stage", label: "Stage", kind: "stage" },
  { key: "launchDate", label: "Launch date", kind: "launchDate" },
  { key: "targetedDate", label: "Targeted date", kind: "targetedDate" },
  { key: "name", label: "Name", kind: "field" },
  { key: "promoType", label: "Type", kind: "field" },
  { key: "format", label: "Format", kind: "field" },
  { key: "product", label: "Publication", kind: "field" },
  { key: "writers", label: "Copywriters", kind: "field" },
  { key: "gurus", label: "Editors", kind: "field" },
];

function show(value: PromoSnapshot[keyof PromoSnapshot]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value == null || typeof value === "boolean") return "";
  return String(value);
}

/** Activity entries for the tracked fields that changed between two snapshots. */
export function promoChanges(before: PromoSnapshot, after: PromoSnapshot): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const t of TRACKED) {
    const from = show(before[t.key]);
    const to = show(after[t.key]);
    if (from !== to) out.push({ kind: t.kind, field: t.label, fromValue: from || null, toValue: to || null });
  }
  return out;
}

/** Names typed as "a, b" or one per line → a clean, de-duplicated list. */
export function nameList(raw: string, max = 10): string[] {
  return [...new Set(raw.split(/[,\n]/).map((v) => v.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean))].slice(0, max);
}
