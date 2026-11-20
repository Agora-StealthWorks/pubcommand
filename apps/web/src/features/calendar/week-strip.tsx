import Link from "next/link";
import { eventTypeColor, type WeekDay } from "../../../../../modules/editorial/week";

export type StripEvent = { id: string; name: string; eventDate: string | null; eventEnd: string | null; eventType: string | null; format: string | null };

function Pencil({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} title="Edit" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white text-muted hover:bg-canvas hover:text-ink">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M13.6 2.6a2 2 0 0 1 2.8 2.8l-9.5 9.5-3.6.8.8-3.6 9.5-9.5Z" />
      </svg>
    </Link>
  );
}

export { Pencil as EditPencil };

/**
 * Monday–Friday strip of every event happening in a week. It ignores the list filters below.
 * Week navigation is plain links (?week=N), so it works without JavaScript.
 */
export function WeekStrip({
  strip,
  offset,
  hrefFor,
  canWrite,
}: {
  strip: { days: WeekDay<StripEvent>[]; range: string; total: number; title: string };
  offset: number;
  hrefFor: (week: number) => string;
  canWrite: boolean;
}) {
  const nav = "inline-flex h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas";
  return (
    <section aria-label={strip.title} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{strip.title}</h2>
        <span className="text-sm text-muted">{strip.range}</span>
        <span className="text-xs text-muted">
          · {strip.total} event{strip.total === 1 ? "" : "s"}
        </span>
        <span className="ml-auto inline-flex gap-1">
          <Link href={hrefFor(offset - 1)} className={nav} aria-label="Previous week">
            ‹
          </Link>
          {offset !== 0 ? (
            <Link href={hrefFor(0)} className={nav}>
              Today
            </Link>
          ) : null}
          <Link href={hrefFor(offset + 1)} className={nav} aria-label="Next week">
            ›
          </Link>
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-[repeat(5,minmax(15rem,1fr))] gap-3 lg:grid-cols-5">
          {strip.days.map((day) => (
            <div key={day.date} className={`flex min-h-56 min-w-0 flex-col overflow-hidden rounded-xl bg-white ${day.isToday ? "border-2 border-ink" : "border border-line"}`}>
              <div className={`flex items-baseline gap-1.5 border-b border-line px-3 py-2 ${day.isToday ? "bg-ink text-white" : "bg-canvas text-ink"}`}>
                <span className="text-sm font-semibold">{day.name}</span>
                <span className="text-sm opacity-80">{day.label}</span>
                {day.isToday ? <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide">Today</span> : null}
              </div>
              <ul className="flex flex-col gap-2 p-2.5">
                {day.events.map((e) => (
                  <li key={e.id} className="flex items-start gap-1.5 rounded-md border border-line bg-white py-2 pl-2.5 pr-2" style={{ borderLeft: `5px solid ${eventTypeColor(e.eventType)}` }}>
                    <Link href={`/editorial/events/${e.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block break-words [overflow-wrap:anywhere] text-sm font-semibold leading-snug">{e.name}</span>
                      {e.eventType || e.format ? <span className="mt-0.5 block text-xs text-muted">{e.eventType ?? e.format}</span> : null}
                    </Link>
                    {canWrite ? <Pencil href={`/editorial/events/${e.id}/edit`} label={`Edit ${e.name}`} /> : null}
                  </li>
                ))}
                {day.events.length === 0 ? <li className="text-sm text-muted">No events</li> : null}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
