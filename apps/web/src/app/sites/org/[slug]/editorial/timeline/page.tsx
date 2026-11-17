import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { calendarPage } from "@/features/calendar/context";
import { listChannels, listPublications, loadRange } from "@/features/calendar/data";
import { PubChip, StageLegend } from "@/features/calendar/ui";
import { addDays, diffDays, fmtDay, isDay, todayIn, weekday } from "../../../../../../../../../modules/editorial/dates";
import { STAGE_COLORS, STAGE_LABELS, stageSpans, timelineBar } from "../../../../../../../../../modules/editorial/stages";

const SPANS = [4, 8, 13, 26] as const;

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ start?: string; weeks?: string; channel?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const today = todayIn();
  const monday = (day: string) => addDays(day, -((weekday(day) + 6) % 7));
  const start = monday(isDay(query.start) ? query.start : addDays(today, -7));
  const weeks = SPANS.find((n) => String(n) === query.weeks) ?? 8;
  const end = addDays(start, weeks * 7 - 1);
  const [range, publications, channels] = await Promise.all([
    loadRange(ctx.resolved.id, ctx.brand.id, start, end),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
    listChannels(ctx.resolved.id, ctx.brand.id),
  ]);
  const events = range.events.filter((e) => e.eventDate && (!query.channel || e.channels.includes(query.channel)));
  const pubColor = new Map(publications.map((p) => [p.code, p.color]));
  const lanes = [...new Set(range.issues.map((i) => i.publicationCode))].sort();
  const todayBar = timelineBar(today, today, start, end);
  const weekStarts = Array.from({ length: weeks }, (_, w) => addDays(start, w * 7));
  const nav = (s: string) => `/editorial/timeline?${new URLSearchParams({ start: s, weeks: String(weeks), ...(query.channel ? { channel: query.channel } : {}) }).toString()}`;
  const step = Math.max(1, Math.floor(weeks / 2)) * 7;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={nav(addDays(start, -step))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white font-semibold" aria-label="Earlier">
            ‹
          </Link>
          <h2 className="text-center text-base font-semibold sm:text-lg">
            {fmtDay(start)} – {fmtDay(end)}, {end.slice(0, 4)}
          </h2>
          <Link href={nav(addDays(start, step))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white font-semibold" aria-label="Later">
            ›
          </Link>
        </div>
        <form action="/editorial/timeline" className="flex flex-wrap gap-2">
          <input type="hidden" name="start" value={start} />
          <select name="weeks" defaultValue={String(weeks)} className="pc-control" aria-label="Range">
            {SPANS.map((n) => (
              <option key={n} value={n}>
                {n} weeks
              </option>
            ))}
          </select>
          {channels.length ? (
            <select name="channel" defaultValue={query.channel ?? ""} className="pc-control" aria-label="Channel">
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
          ) : null}
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>
      <StageLegend />

      <TableScroll>
        <div className="min-w-[760px] rounded-xl border border-line bg-white">
          <div className="grid grid-cols-[200px_minmax(0,1fr)] border-b border-line text-xs text-muted">
            <div className="px-3 py-2 font-semibold uppercase tracking-wide">Event</div>
            <div className="relative h-8">
              {weekStarts.map((w) => {
                const bar = timelineBar(w, addDays(w, 6), start, end)!;
                return (
                  <span key={w} className="absolute top-0 h-full border-l border-line px-1 pt-2" style={{ left: `${bar.left}%` }}>
                    {fmtDay(w)}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="relative">
            {todayBar ? <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-[#f04438]" style={{ left: `calc(200px + (100% - 200px) * ${todayBar.left / 100})` }} aria-hidden /> : null}
            {events.map((e) => (
              <div key={e.id} className="grid grid-cols-[200px_minmax(0,1fr)] border-b border-line last:border-b-0">
                <Link href={`/editorial/events/${e.id}`} className="truncate px-3 py-2 text-sm font-medium hover:text-accent" title={e.name}>
                  {e.name}
                </Link>
                <div className="relative h-9">
                  {stageSpans(e).map((span) => {
                    const bar = timelineBar(span.start, span.end, start, end);
                    if (!bar) return null;
                    return (
                      <Link
                        key={span.stage}
                        href={`/editorial/events/${e.id}`}
                        title={`${STAGE_LABELS[span.stage]}: ${fmtDay(span.start)} – ${fmtDay(span.end)}`}
                        className="absolute top-2 h-5 rounded"
                        style={{ left: `${bar.left}%`, width: `max(${bar.width}%, 4px)`, background: span.stage === "event" && e.seriesId ? "#eab308" : STAGE_COLORS[span.stage] }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {events.length === 0 ? <p className="px-3 py-4 text-sm text-muted">No events in this range.</p> : null}
          </div>
          <div className="border-t-2 border-line bg-canvas px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Editorial</div>
          {lanes.map((code) => (
            <div key={code} className="grid grid-cols-[200px_minmax(0,1fr)] border-t border-line">
              <div className="flex items-center gap-2 px-3 py-2 text-sm">
                <PubChip code={code} color={pubColor.get(code)} />
                <span className="truncate text-muted">{publications.find((p) => p.code === code)?.name ?? ""}</span>
              </div>
              <div className="relative h-9">
                {range.issues
                  .filter((i) => i.publicationCode === code && i.mailDate)
                  .map((i) => {
                    const bar = timelineBar(i.mailDate!, i.mailDate!, start, end);
                    if (!bar) return null;
                    return (
                      <Link
                        key={i.id}
                        href={`/editorial/issues/${i.id}`}
                        title={`${fmtDay(i.mailDate)} · ${i.title}`}
                        className="absolute top-2 h-5 rounded-sm"
                        style={{ left: `${bar.left}%`, width: `max(${bar.width}%, 6px)`, background: pubColor.get(code) ?? STAGE_COLORS.issue }}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
          {lanes.length === 0 ? <p className="border-t border-line px-3 py-4 text-sm text-muted">No issues in this range.</p> : null}
        </div>
      </TableScroll>
      <p className="text-xs text-muted">
        {diffDays(start, end) + 1} days. Recurring events show in yellow. The red line is today.
      </p>
    </div>
  );
}
