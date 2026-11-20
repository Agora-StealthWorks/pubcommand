import { googleCalendarUrl, liveSessionEvent, parseReminders, type CalendarEvent, type InviteSettings } from "../../../../../modules/funnels/calendar";
import { isHttpUrl } from "../../../../../modules/funnels/checks";
import { dayLabel, type DayRow, type FunnelRow } from "./data";
import type { LoadedFunnel } from "./public";

/** Live sessions still to come on the automatic schedule, soonest first. */
export function upcomingSessions(loaded: Pick<LoadedFunnel, "funnel" | "days" | "now">): DayRow[] {
  if (loaded.funnel.mode !== "live") return [];
  return loaded.days
    .filter((day) => day.isLive && day.liveOverride === "auto" && day.liveStartAt && day.liveStartAt > loaded.now)
    .sort((a, b) => a.liveStartAt!.getTime() - b.liveStartAt!.getTime());
}

export function inviteSettings(funnel: FunnelRow, days: DayRow[]): InviteSettings {
  return {
    titleTemplate: funnel.calInviteTitle,
    descTemplate: funnel.calInviteDesc,
    reminders: parseReminders(funnel.calReminders),
    agenda: days.filter((day) => day.isLive).map((day) => ({ label: dayLabel(day), title: day.title, topics: day.topics, liveStartAt: day.liveStartAt })),
  };
}

/** The invite for one session, with the funnel's invite settings. */
export function sessionEvent(loaded: Pick<LoadedFunnel, "funnel" | "days" | "timeZone">, day: DayRow, origin: string): CalendarEvent | null {
  const { funnel } = loaded;
  return liveSessionEvent({
    funnelId: funnel.id,
    funnelName: funnel.name,
    day: { ...day, label: dayLabel(day), liveUrl: isHttpUrl(day.liveUrl) ? day.liveUrl : null },
    roomUrl: isHttpUrl(funnel.livestreamUrl) ? funnel.livestreamUrl : null,
    pageUrl: `${origin}/l/${funnel.slug}/day-${day.position}`,
    timeZone: loaded.timeZone,
    invite: inviteSettings(funnel, loaded.days),
  });
}

/**
 * Add to calendar, for a live session that has not started yet (never while it
 * is live or afterwards). `day` null = the waitlist, which adds the first
 * session (or every remaining one with the series scope).
 *   url mode: one button to the day's calendar link, else the funnel's.
 *   builtin:  a menu with Google Calendar and an .ics file (Apple, Outlook).
 */
export function SessionCalendar({
  loaded,
  day,
  base,
  origin,
  tone = "light",
  compact = false,
}: {
  loaded: LoadedFunnel;
  day: DayRow | null;
  base: string;
  origin: string;
  tone?: "light" | "dark";
  compact?: boolean;
}) {
  const { funnel } = loaded;
  if (funnel.mode !== "live" || !funnel.calendarEnabled) return null;
  const upcoming = upcomingSessions(loaded);
  const target = day ? upcoming.find((item) => item.id === day.id) : upcoming[0];
  if (!target) return null;
  const text = funnel.calendarButtonText.trim() || "Add to calendar";
  const style = tone === "dark" ? { borderColor: "#ffffff", color: "#ffffff" } : undefined;
  const size = compact ? "min-h-9 px-3 text-xs" : "text-sm";
  if (funnel.calendarMode === "url") {
    const href = [target.calendarUrl, funnel.calendarUrl].find((value) => isHttpUrl(value));
    if (!href) return null;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" data-track="calendar" data-track-day={target.id} data-track-target={`${target.id}|${text}`} className={`pcf-btn-quiet ${size}`} style={style}>
        📅 {text}
      </a>
    );
  }
  const series = funnel.calInviteScope === "series";
  const events = (series ? upcoming : [target]).map((item) => ({ day: item, event: sessionEvent(loaded, item, origin) })).filter((entry) => entry.event);
  if (!events.length) return null;
  const icsBase = `${base || `/l/${funnel.slug}`}/ics`;
  const icsHref = series ? `${icsBase}?series=1` : `${icsBase}?day=${target.id}`;
  return (
    <details className="pcf-cal relative inline-block text-left">
      <summary className={`pcf-btn-quiet cursor-pointer list-none ${size}`} style={style} data-track="calendar" data-track-day={target.id} data-track-target={`${target.id}|${text}`}>
        📅 {text}
      </summary>
      <div className="absolute left-1/2 z-20 mt-2 w-64 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg border border-black/10 bg-white p-2 text-sm text-[#111827] shadow-lg">
        {events.map(({ day: item, event }) => (
          <a key={item.id} href={googleCalendarUrl(event!, loaded.timeZone)} target="_blank" rel="noopener noreferrer" className="block rounded px-3 py-2 hover:bg-black/5">
            Google Calendar{events.length > 1 ? ` · ${dayLabel(item)}` : ""}
          </a>
        ))}
        <a href={icsHref} download className="block rounded px-3 py-2 hover:bg-black/5">
          Apple / Outlook (.ics){series && events.length > 1 ? " · all sessions" : ""}
        </a>
      </div>
    </details>
  );
}
