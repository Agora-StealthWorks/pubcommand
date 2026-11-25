import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { calendarPage } from "@/features/calendar/context";
import { listChannels, listPublications, loadRange } from "@/features/calendar/data";
import { PostStatsChip, PubChip, StageDot, StageLegend } from "@/features/calendar/ui";
import { fmtDay, isMonth, monthGrid, monthLabel, shiftMonth, todayIn } from "../../../../../../../../../modules/editorial/dates";
import { contrastInk, STAGE_COLORS, stageOn, weekSegments, type WeekSegment } from "../../../../../../../../../modules/editorial/stages";

type Query = { month?: string; channel?: string; pub?: string; show?: string; marketing?: string };

type Bar = { key: string; href: string; label: string; seg: WeekSegment; color: string; ink: string };

/** Greedy lanes: each item keeps one lane across its segments in a week. */
function lanes(items: { key: string; segs: Bar[] }[]): Bar[][] {
  const rows: Bar[][] = [];
  for (const item of items) {
    const lo = Math.min(...item.segs.map((b) => b.seg.start));
    const hi = Math.max(...item.segs.map((b) => b.seg.end));
    let row = rows.find((r) => r.every((b) => b.seg.end < lo || b.seg.start > hi));
    if (!row) {
      row = [];
      rows.push(row);
    }
    row.push(...item.segs);
  }
  return rows;
}

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Query> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const today = todayIn();
  const month = isMonth(query.month) ? query.month : today.slice(0, 7);
  const days = monthGrid(month);
  const [range, publications, channels] = await Promise.all([
    loadRange(ctx.resolved.id, ctx.brand.id, days[0]!, days[days.length - 1]!),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
    listChannels(ctx.resolved.id, ctx.brand.id),
  ]);
  const show = query.show === "events" || query.show === "issues" ? query.show : "all";
  const hideMarketing = query.marketing === "hide";
  const pubColor = new Map(publications.map((p) => [p.code, p.color]));
  const events = range.events
    .filter((e) => show !== "issues" && (!query.channel || e.channels.includes(query.channel)))
    .map((e) => (hideMarketing ? { ...e, marketingStart: null, marketingEnd: null } : e));
  const issues = range.issues.filter((i) => show !== "events" && (!query.pub || i.publicationCode === query.pub));
  const weeks = Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  const link = (m: string) => {
    const p = new URLSearchParams({ month: m });
    for (const key of ["channel", "pub", "show", "marketing"] as const) if (query[key]) p.set(key, query[key]!);
    return `/editorial/calendar?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={link(shiftMonth(month, -1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white font-semibold" aria-label="Previous month">
            ‹
          </Link>
          <h2 className="min-w-40 text-center text-lg font-semibold">{monthLabel(month)}</h2>
          <Link href={link(shiftMonth(month, 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white font-semibold" aria-label="Next month">
            ›
          </Link>
          <Link href={link(today.slice(0, 7))} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold">
            Today
          </Link>
        </div>
        <form action="/editorial/calendar" className="flex flex-wrap gap-2">
          <input type="hidden" name="month" value={month} />
          <select name="show" defaultValue={show} className="pc-control" aria-label="Show">
            <option value="all">Events and issues</option>
            <option value="events">Events</option>
            <option value="issues">Issues</option>
          </select>
          {channels.length ? (
            <select name="channel" defaultValue={query.channel ?? ""} className="pc-control" aria-label="Channel">
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
          ) : null}
          <select name="pub" defaultValue={query.pub ?? ""} className="pc-control" aria-label="Publication">
            <option value="">All publications</option>
            {publications.map((p) => (
              <option key={p.id} value={p.code}>
                {p.code}
              </option>
            ))}
          </select>
          <select name="marketing" defaultValue={hideMarketing ? "hide" : ""} className="pc-control" aria-label="Marketing bands">
            <option value="">With marketing bands</option>
            <option value="hide">Event days only</option>
          </select>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>
      <StageLegend />

      {/* Desktop and tablet: the month grid. */}
      <div className="hidden overflow-hidden rounded-xl border border-line bg-white md:block">
        <div className="grid grid-cols-7 border-b border-line bg-canvas text-xs font-semibold uppercase tracking-wide text-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => {
          const weekStart = week[0]!;
          const weekEnd = week[6]!;
          const eventItems = events
            .map((e) => ({
              key: e.id,
              segs: weekSegments(e, weekStart).map((seg) => ({
                key: `${e.id}-${seg.bar}`,
                href: `/editorial/events/${e.id}`,
                label: seg.bar === "pre" ? `${e.name} · marketing` : seg.bar === "post" ? `${e.name} · follow-up` : e.name,
                seg,
                color: e.seriesId || e.stage === "Recurring" ? (seg.bar === "event" ? "#eab308" : STAGE_COLORS[seg.bar]) : STAGE_COLORS[seg.bar],
                ink: e.seriesId && seg.bar === "event" ? "#422006" : "#ffffff",
              })),
            }))
            .filter((item) => item.segs.length);
          const issueItems = issues
            .filter((i) => i.mailDate && i.mailDate >= weekStart && i.mailDate <= weekEnd)
            .map((i) => {
              const col = week.indexOf(i.mailDate!);
              const color = pubColor.get(i.publicationCode) ?? STAGE_COLORS.issue;
              return {
                key: i.id,
                segs: [{ key: i.id, href: `/editorial/issues/${i.id}`, label: `${i.publicationCode} · ${i.title}${i.post ? ` · ${i.post.views.toLocaleString("en-US")} views${i.post.ctr == null ? "" : ` · ${(i.post.ctr * 100).toFixed(1)}% CTR`}` : ""}`, seg: { start: col, end: col, bar: "issue" as const, continuesLeft: false, continuesRight: false }, color, ink: contrastInk(color) }],
              };
            });
          const rows = lanes([...eventItems, ...issueItems]);
          return (
            <div key={weekStart} className="border-b border-line last:border-b-0">
              <div className="grid grid-cols-7">
                {week.map((day) => (
                  <div key={day} className={`border-r border-line px-2 py-1 text-xs last:border-r-0 ${day.slice(0, 7) !== month ? "text-muted/60 bg-canvas/50" : ""}`}>
                    <span className={day === today ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent font-semibold text-white" : "font-semibold"}>{Number(day.slice(8))}</span>
                    {ctx.canWrite ? (
                      <Link href={`/editorial/events/new?date=${day}`} className="float-right text-muted hover:text-accent" aria-label={`Add an event on ${fmtDay(day)}`}>
                        +
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="min-h-16 space-y-1 pb-2">
                {rows.map((row, r) => (
                  <div key={r} className="grid grid-cols-7 gap-x-0.5 px-0.5">
                    {row.map((b) => (
                      <Link
                        key={b.key}
                        href={b.href}
                        title={b.label}
                        className={`truncate px-1.5 py-0.5 text-[11px] font-semibold leading-4 hover:opacity-90 ${b.seg.continuesLeft ? "" : "rounded-l"} ${b.seg.continuesRight ? "" : "rounded-r"}`}
                        style={{ gridColumn: `${b.seg.start + 1} / ${b.seg.end + 2}`, background: b.color, color: b.ink }}
                      >
                        {b.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Phone: the same month as an agenda. */}
      <ol className="space-y-2 md:hidden">
        {days
          .filter((day) => day.slice(0, 7) === month)
          .map((day) => {
            const dayEvents = events.map((e) => ({ e, stage: stageOn(e, day) })).filter((x) => x.stage);
            const dayIssues = issues.filter((i) => i.mailDate === day);
            if (!dayEvents.length && !dayIssues.length) return null;
            return (
              <li key={day} className="rounded-xl border border-line bg-white p-3">
                <p className={`text-sm font-semibold ${day === today ? "text-accent" : ""}`}>
                  {fmtDay(day)} · {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${day}T00:00:00Z`).getUTCDay()]}
                </p>
                <ul className="mt-1 space-y-1">
                  {dayEvents
                    .filter((x) => x.stage === "event" || day === x.e.marketingStart || day === x.e.marketingEnd)
                    .map(({ e, stage }) => (
                      <li key={e.id}>
                        <Link href={`/editorial/events/${e.id}`} className="flex min-h-9 items-center gap-2 text-sm">
                          <StageDot stage={stage!} />
                          <span className="break-words [overflow-wrap:anywhere]">
                            {e.name}
                            {stage !== "event" ? <span className="text-muted"> · {stage === "pre" ? "marketing starts" : "marketing ends"}</span> : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  {dayIssues.map((i) => (
                    <li key={i.id}>
                      <Link href={`/editorial/issues/${i.id}`} className="flex min-h-9 items-center gap-2 text-sm">
                        <PubChip code={i.publicationCode} color={pubColor.get(i.publicationCode)} />
                        <span className="break-words [overflow-wrap:anywhere]">{i.title}</span>
                        <PostStatsChip stats={i.post} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
      </ol>
    </div>
  );
}
