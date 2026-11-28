/**
 * Funnel aggregates, and the Brain notes built from them. Only
 * counts and averages leave the database here: never an email, phone number or
 * visitor id.
 */
import { PROGRESSION_LABELS, type FunnelMode, type Progression } from "./state";

export type DayEventRow = { dayId: string | null; kind: string; visitorId: string };
export type WatchRow = { dayId: string; percent: number };

export type DayStats = { dayId: string; views: number; viewers: number; avgWatch: number | null; completed: number; ctaClicks: number };

export type FunnelStats = {
  waitlistViews: number;
  visitors: number;
  optins: number;
  ctaClicks: number;
  days: DayStats[];
};

/**
 * Roll raw events up per day. `completeAt` is the watched % that counts as
 * having finished a video (the funnel's watch threshold).
 */
export function aggregateFunnel(input: {
  dayIds: readonly string[];
  events: readonly DayEventRow[];
  watches: readonly WatchRow[];
  optins: number;
  completeAt: number;
}): FunnelStats {
  const visitors = new Set<string>();
  let waitlistViews = 0;
  let ctaClicks = 0;
  const views = new Map<string, number>();
  const viewers = new Map<string, Set<string>>();
  const clicks = new Map<string, number>();
  for (const event of input.events) {
    visitors.add(event.visitorId);
    if (event.kind === "view" && !event.dayId) waitlistViews += 1;
    if (event.kind === "view" && event.dayId) {
      views.set(event.dayId, (views.get(event.dayId) ?? 0) + 1);
      const set = viewers.get(event.dayId) ?? new Set<string>();
      set.add(event.visitorId);
      viewers.set(event.dayId, set);
    }
    if (event.kind === "cta") {
      ctaClicks += 1;
      if (event.dayId) clicks.set(event.dayId, (clicks.get(event.dayId) ?? 0) + 1);
    }
  }
  const days = input.dayIds.map((dayId) => {
    const watches = input.watches.filter((row) => row.dayId === dayId);
    const avg = watches.length ? Math.round(watches.reduce((sum, row) => sum + row.percent, 0) / watches.length) : null;
    return {
      dayId,
      views: views.get(dayId) ?? 0,
      viewers: viewers.get(dayId)?.size ?? 0,
      avgWatch: avg,
      completed: watches.filter((row) => row.percent >= input.completeAt).length,
      ctaClicks: clicks.get(dayId) ?? 0,
    };
  });
  return { waitlistViews, visitors: visitors.size, optins: input.optins, ctaClicks, days };
}

export function percent(part: number, whole: number): string {
  if (!whole) return "–";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export function funnelBrainNote(input: {
  name: string;
  brandName: string;
  mode: FunnelMode;
  progression: Progression;
  startLabel: string | null;
  days: { position: number; title: string; topics: string[]; isLive: boolean }[];
  /** Ignored: funnel traffic never teaches the Brain (same rule as the old app). Kept so callers compile. */
  stats?: FunnelStats;
  /** Microsites get a different headline and list their home page sections and extra pages. */
  siteType?: "launch" | "microsite";
  homeSections?: string[];
  pages?: string[];
}): { title: string; body: string } {
  const microsite = input.siteType === "microsite";
  const kind = microsite ? "Microsite" : "Launch funnel";
  const lines = [
    `# ${kind}: ${input.name}`,
    "",
    microsite
      ? `A microsite for ${input.brandName}: a home page built from blocks, with ${input.days.length} ${input.mode === "live" ? "live" : "pre-recorded"} module${input.days.length === 1 ? "" : "s"} around it.`
      : `A ${input.days.length}-day ${input.mode === "live" ? "live" : "evergreen (pre-recorded)"} video launch for ${input.brandName}.`,
    ...(microsite && input.homeSections?.length ? [`Home page sections: ${input.homeSections.join(", ")}.`] : []),
    ...(input.pages?.length ? [`Extra pages: ${input.pages.join(", ")}.`] : []),
    `Progression: ${PROGRESSION_LABELS[input.progression]}.${input.startLabel ? ` Starts ${input.startLabel}.` : ""}`,
    "",
    "## Agenda",
    ...input.days.map((day) => {
      const topics = day.topics.length ? `: ${day.topics.join("; ")}` : "";
      return `- Day ${day.position}${day.isLive && input.mode === "live" ? " (live)" : ""}: ${day.title || "Untitled"}${topics}`;
    }),
    "",
    "Structure only: visitor traffic and opt-ins are never sent to the Brain.",
  ];
  return { title: `${kind}: ${input.name}`, body: lines.join("\n") };
}

export type ReportEvent = { dayId: string | null; page: string | null; kind: string; target: string | null; device: string | null; visitorId: string; createdAt: Date };
export type ReportPage = { key: string; page: string; id: string | null; label: string };
export type PageRow = ReportPage & { views: number; uniques: number; pctOfUsers: number; devices: Record<string, number>; clicks: Record<string, number> };
export type ClickRow = { pageLabel: string; kind: string; target: string; clicks: number; uniques: number; ctr: number };

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * The stats report: per page (views, unique visitors, % of all visitors,
 * devices, clicks by kind), clicks per button / link, and views per day in the
 * org time zone. Older events without a page are filed by their day id.
 */
export function funnelReport(input: { events: readonly ReportEvent[]; pages: readonly ReportPage[]; timeZone: string }) {
  const pageOf = (event: ReportEvent) => event.page ?? (event.dayId ? "day" : "waitlist");
  const keyOf = (event: ReportEvent) => `${pageOf(event)}:${event.dayId ?? ""}`;
  const everyone = new Set<string>();
  const byKey = new Map<string, { views: number; uniques: Set<string>; devices: Map<string, Set<string>>; clicks: Map<string, number> }>();
  const clickRows = new Map<string, { key: string; kind: string; target: string; clicks: number; uniques: Set<string> }>();
  const devices = new Map<string, Set<string>>();
  const daily = new Map<string, { views: number; uniques: Set<string> }>();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (const event of input.events) {
    everyone.add(event.visitorId);
    const key = keyOf(event);
    const slot = byKey.get(key) ?? { views: 0, uniques: new Set(), devices: new Map(), clicks: new Map() };
    byKey.set(key, slot);
    const device = event.device ?? "unknown";
    if (!devices.has(device)) devices.set(device, new Set());
    devices.get(device)!.add(event.visitorId);
    if (event.kind === "view") {
      slot.views += 1;
      slot.uniques.add(event.visitorId);
      if (!slot.devices.has(device)) slot.devices.set(device, new Set());
      slot.devices.get(device)!.add(event.visitorId);
      const date = day.format(event.createdAt);
      const bucket = daily.get(date) ?? { views: 0, uniques: new Set() };
      bucket.views += 1;
      bucket.uniques.add(event.visitorId);
      daily.set(date, bucket);
    } else if (event.kind !== "watch") {
      slot.clicks.set(event.kind, (slot.clicks.get(event.kind) ?? 0) + 1);
      const target = (event.target ?? "").slice(0, 600);
      const rowKey = `${key}|${event.kind}|${target}`;
      const row = clickRows.get(rowKey) ?? { key, kind: event.kind, target, clicks: 0, uniques: new Set() };
      row.clicks += 1;
      row.uniques.add(event.visitorId);
      clickRows.set(rowKey, row);
    }
  }
  const visitors = everyone.size;
  const labels = new Map(input.pages.map((page) => [page.key, page.label]));
  const pages: PageRow[] = input.pages.map((page) => {
    const slot = byKey.get(page.key);
    const uniques = slot?.uniques.size ?? 0;
    return {
      ...page,
      views: slot?.views ?? 0,
      uniques,
      pctOfUsers: pct(uniques, visitors),
      devices: Object.fromEntries([...(slot?.devices ?? new Map<string, Set<string>>())].map(([name, set]) => [name, set.size])),
      clicks: Object.fromEntries(slot?.clicks ?? []),
    };
  });
  const clicks: ClickRow[] = [...clickRows.values()]
    .map((row) => {
      const viewers = byKey.get(row.key)?.uniques.size ?? 0;
      // Resource targets are "<index>|<label>|<url>": show the label and address.
      const target = row.kind === "resource" ? row.target.split("|").slice(1).join(" · ") : row.kind === "calendar" ? row.target.split("|").slice(1).join("|") || row.target : row.target;
      return { pageLabel: labels.get(row.key) ?? "Removed page", kind: row.kind, target, clicks: row.clicks, uniques: row.uniques.size, ctr: pct(row.uniques.size, viewers) };
    })
    .sort((a, b) => b.clicks - a.clicks);
  return {
    visitors,
    views: pages.reduce((sum, page) => sum + page.views, 0),
    pages,
    clicks,
    devices: Object.fromEntries([...devices].map(([name, set]) => [name, set.size])),
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, bucket]) => ({ date, views: bucket.views, uniques: bucket.uniques.size })),
  };
}

/** Click kinds that count as an offer / call-to-action click in the parameter breakdown. */
export const OFFER_CLICK_KINDS = ["cta", "deadline_bar", "close_button", "home_button", "offer"] as const;

export type BreakdownEvent = { kind: string; visitorId: string; createdAt: Date; params: unknown };
export type BreakdownOptin = { params: unknown };
export type BreakdownRow = { value: string; visitors: number; optins: number; views: number; offerClicks: number; clickers: number; clickRate: number };

/** The bucket for visitors and opt-ins without the parameter. */
export const NO_VALUE = "(none)";

function paramValue(params: unknown, key: string): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

/**
 * Stats per value of one tracked URL parameter. Each visitor falls in ONE
 * bucket: the value on their earliest event that has it (first touch) or their
 * latest (last touch), "(none)" when no event has it; all their views and
 * clicks count there, so the rows add up to the totals. Opt-ins are counted by
 * the value stored with the opt-in. Click rate = visitors with an offer / CTA
 * click ÷ visitors. Sorted by visitors, "(none)" last.
 */
export function paramBreakdown(input: { param: string; events: readonly BreakdownEvent[]; optins: readonly BreakdownOptin[]; attribution: "first" | "last" }): BreakdownRow[] {
  const offer = new Set<string>(OFFER_CLICK_KINDS);
  const perVisitor = new Map<string, { value: string | null; at: number; views: number; clicks: number }>();
  for (const event of input.events) {
    const slot = perVisitor.get(event.visitorId) ?? { value: null, at: 0, views: 0, clicks: 0 };
    perVisitor.set(event.visitorId, slot);
    if (event.kind === "view") slot.views += 1;
    else if (offer.has(event.kind)) slot.clicks += 1;
    const value = paramValue(event.params, input.param);
    if (value === null) continue;
    const at = event.createdAt.getTime();
    if (slot.value === null || (input.attribution === "first" ? at < slot.at : at >= slot.at)) {
      slot.value = value;
      slot.at = at;
    }
  }
  const rows = new Map<string, BreakdownRow>();
  const row = (value: string) => {
    const existing = rows.get(value);
    if (existing) return existing;
    const created = { value, visitors: 0, optins: 0, views: 0, offerClicks: 0, clickers: 0, clickRate: 0 };
    rows.set(value, created);
    return created;
  };
  for (const slot of perVisitor.values()) {
    const target = row(slot.value ?? NO_VALUE);
    target.visitors += 1;
    target.views += slot.views;
    target.offerClicks += slot.clicks;
    if (slot.clicks > 0) target.clickers += 1;
  }
  for (const optin of input.optins) row(paramValue(optin.params, input.param) ?? NO_VALUE).optins += 1;
  return [...rows.values()]
    .map((item) => ({ ...item, clickRate: pct(item.clickers, item.visitors) }))
    .sort((a, b) => (a.value === NO_VALUE ? 1 : b.value === NO_VALUE ? -1 : b.visitors - a.visitors || b.optins - a.optins || a.value.localeCompare(b.value)));
}
