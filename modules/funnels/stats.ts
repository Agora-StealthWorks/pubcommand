/**
 * Funnel and text-letter aggregates, and the Brain notes built from them. Only
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
  stats: FunnelStats;
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
    "## Results so far (aggregates)",
    `- Visitors: ${input.stats.visitors}; waitlist views: ${input.stats.waitlistViews}; opt-ins: ${input.stats.optins}; CTA clicks: ${input.stats.ctaClicks}.`,
    ...input.stats.days.map((day, index) => {
      const label = input.days[index] ? `Day ${input.days[index]!.position}` : `Day ${index + 1}`;
      return `- ${label}: ${day.viewers} viewers, average watched ${day.avgWatch === null ? "n/a" : `${day.avgWatch}%`}, ${day.completed} finished, ${day.ctaClicks} CTA clicks.`;
    }),
    "",
    "Use this to plan the next launch: which topics held attention (watch %), and where people dropped off between days.",
  ];
  return { title: `${kind}: ${input.name}`, body: lines.join("\n") };
}

/** Plain text from sanitized HTML, for excerpts and Brain notes. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function excerpt(html: string, max = 180): string {
  const text = htmlToText(html).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}

export function postBrainNote(input: {
  siteName: string;
  title: string;
  publishLabel: string;
  bodyHtml: string;
  actionToTake: string | null;
  siteOptins: number;
  postViews: number;
}): { title: string; body: string } {
  const text = htmlToText(input.bodyHtml);
  const words = text ? text.split(/\s+/).length : 0;
  return {
    title: `Text letter: ${input.title}`,
    body: [
      `# Text letter: ${input.title}`,
      "",
      `Published on the ${input.siteName} text-letter site, ${input.publishLabel}. ${words} words.`,
      input.actionToTake ? `Action to take: ${input.actionToTake}` : "",
      "",
      "## Post",
      text.slice(0, 4000),
      "",
      "## Reach (aggregates)",
      `- Post page views: ${input.postViews}.`,
      `- Site subscribers (all time): ${input.siteOptins}.`,
    ]
      .filter((line, index, all) => line !== "" || all[index - 1] !== "")
      .join("\n"),
  };
}
