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
  stats: FunnelStats;
}): { title: string; body: string } {
  const lines = [
    `# Launch funnel: ${input.name}`,
    "",
    `A ${input.days.length}-day ${input.mode === "live" ? "live" : "evergreen (pre-recorded)"} video launch for ${input.brandName}.`,
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
  return { title: `Launch funnel: ${input.name}`, body: lines.join("\n") };
}
