import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { quickAddAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { feedItems, listChannels, listPublications, loadRange } from "@/features/calendar/data";
import { loadOptions } from "@/features/calendar/options";
import { StageDot } from "@/features/calendar/ui";
import { EditPencil, WeekStrip } from "@/features/calendar/week-strip";
import { addDays, fmtDay, fmtTime, isDay, todayIn } from "../../../../../../../../modules/editorial/dates";
import { SEND_STATS_ENABLED } from "../../../../../../../../modules/editorial/features";
import { filterFeed, STAGE_COLORS, stageOn } from "../../../../../../../../modules/editorial/stages";
import { eventTypeColor, mondayOf, weekOffset, weekStrip } from "../../../../../../../../modules/editorial/week";

type Query = { q?: string; kind?: string; channel?: string; pub?: string; stage?: string; type?: string; view?: string; f?: string; recurring?: string; from?: string; to?: string; week?: string; error?: string; notice?: string };

const pill = "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

export default async function RunningListPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Query> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const today = todayIn();
  // The checkbox only posts when ticked, so a submitted form (f=1) without it means "all dates".
  const upcoming = query.f === "1" ? query.view === "upcoming" : query.view !== "all";
  const from = !upcoming && isDay(query.from) ? query.from : null;
  const to = !upcoming && isDay(query.to) ? query.to : null;
  const offset = weekOffset(query.week);
  const monday = addDays(mondayOf(today), offset * 7);
  const [range, weekRange, publications, channels, options] = await Promise.all([
    loadRange(ctx.resolved.id, ctx.brand.id, upcoming ? today : from, to),
    loadRange(ctx.resolved.id, ctx.brand.id, monday, addDays(monday, 4)),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
    listChannels(ctx.resolved.id, ctx.brand.id),
    loadOptions(ctx.resolved.id, ctx.brand.id),
  ]);
  const strip = weekStrip(weekRange.events, today, offset);
  const eventStages = options["event.stage"];
  const eventTypes = [...new Set([...options["event.type"], ...range.events.map((e) => e.eventType).filter((t): t is string => Boolean(t))])];
  const kind = query.kind === "event" || query.kind === "issue" ? query.kind : "all";
  const items = filterFeed(feedItems(range), {
    today,
    upcoming,
    q: query.q,
    kind,
    channel: query.channel || undefined,
    publication: query.pub || undefined,
    stage: query.stage || undefined,
    type: query.type || undefined,
    hideRecurring: query.recurring === "hide",
    from: from ?? undefined,
    to: to ?? undefined,
  }).slice(0, 500);
  const pubColor = new Map(publications.map((p) => [p.code, p.color]));
  const events = new Map(range.events.map((e) => [e.id, e]));
  const issues = new Map(range.issues.map((i) => [i.id, i]));
  const activePubs = publications.filter((p) => p.active);
  const weekHref = (week: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v && k !== "week" && k !== "error" && k !== "notice") qs.set(k, v);
    if (week !== 0) qs.set("week", String(week));
    const s = qs.toString();
    return s ? `/editorial?${s}` : "/editorial";
  };

  return (
    <div className="min-w-0 space-y-5">
      <Flash error={query.error} notice={query.notice} />
      <h2 className="text-xl font-semibold tracking-tight">{upcoming ? "Upcoming / Active Events" : "All dates"}</h2>

      <WeekStrip strip={strip} offset={offset} hrefFor={weekHref} canWrite={ctx.canWrite} />

      {ctx.canWrite ? (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas [&::-webkit-details-marker]:hidden">
            + Quick add
          </summary>
          <form action={quickAddAction} className="mt-2 grid gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:items-center">
            <select name="kind" aria-label="What to add" className="pc-control" defaultValue="event">
              <option value="event">Event</option>
              <option value="issue">Issue</option>
            </select>
            <Input name="title" placeholder="Name or title" aria-label="Name or title" maxLength={200} required />
            <input type="date" name="date" aria-label="Date" className="pc-control" defaultValue={today} />
            <select name="publicationCode" aria-label="Publication (issues only)" className="pc-control" defaultValue={activePubs[0]?.code ?? ""}>
              {activePubs.length === 0 ? <option value="">No publications yet</option> : null}
              {activePubs.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.code} (issues)
                </option>
              ))}
            </select>
            <Button type="submit">Add</Button>
          </form>
        </details>
      ) : null}

      <form className="space-y-2" action="/editorial">
        <input type="hidden" name="f" value="1" />
        {offset ? <input type="hidden" name="week" value={offset} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Input name="q" defaultValue={query.q ?? ""} placeholder="Search" aria-label="Search" className="w-full sm:w-56" />
          <select name="kind" defaultValue={kind} aria-label="Events or issues" className="pc-control">
            <option value="all">Events and issues</option>
            <option value="event">Events only</option>
            <option value="issue">Issues only</option>
          </select>
          {channels.length ? (
            <select name="channel" defaultValue={query.channel ?? ""} aria-label="Channel" className="pc-control">
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : null}
          <select name="type" defaultValue={query.type ?? ""} aria-label="Event type" className="pc-control">
            <option value="">All event types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select name="pub" defaultValue={query.pub ?? ""} aria-label="Publication" className="pc-control">
            <option value="">All publications</option>
            {publications.map((p) => (
              <option key={p.id} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
          <select name="stage" defaultValue={query.stage ?? ""} aria-label="Stage or status" className="pc-control">
            <option value="">All stages</option>
            <optgroup label="Event stage">
              {eventStages.map((s) => (
                <option key={`e-${s}`} value={s}>
                  {s}
                </option>
              ))}
            </optgroup>
            <optgroup label="Issue status">
              {options["issue.status"].filter((s) => !eventStages.includes(s)).map((s) => (
                <option key={`i-${s}`} value={s}>
                  {s}
                </option>
              ))}
            </optgroup>
          </select>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="view" value="upcoming" defaultChecked={upcoming} /> Upcoming / active only
          </label>
          {!upcoming ? (
            <>
              <input type="date" name="from" defaultValue={from ?? ""} aria-label="From" className="pc-control" />
              <input type="date" name="to" defaultValue={to ?? ""} aria-label="To" className="pc-control" />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="recurring" value="hide" defaultChecked={query.recurring === "hide"} /> Hide recurring events
          </label>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <span className="ml-auto text-sm text-muted">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      <ul className="space-y-2">
        {items.map((item) => {
          if (item.kind === "event") {
            const e = events.get(item.id)!;
            const now = stageOn(e, today);
            const sub = [e.eventType ?? e.format, e.startTime ? `${fmtTime(e.startTime)} ET` : null, e.channels.join(", ") || null].filter(Boolean).join(" · ");
            return (
              <li key={`e-${item.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 sm:px-4" style={{ borderLeft: `5px solid ${eventTypeColor(e.eventType)}` }}>
                <span className="w-14 shrink-0 whitespace-nowrap text-sm tabular-nums text-muted">{fmtDay(item.date)}</span>
                <span className="hidden sm:inline-flex" title={now ? `${now} now` : undefined}>
                  {now ? <StageDot stage={now} /> : <span className="inline-block h-2.5 w-2.5 rounded-full bg-line" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-1.5">
                    <Link href={`/editorial/events/${item.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] font-medium hover:underline">
                      {item.title}
                    </Link>
                    {ctx.canWrite ? <EditPencil href={`/editorial/events/${item.id}/edit`} label={`Edit ${item.title}`} /> : null}
                  </span>
                  {sub ? <span className="mt-0.5 block text-xs text-muted">{sub}</span> : null}
                  <span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
                    {item.recurring && e.stage !== "Recurring" ? <span className={`${pill} bg-[#fef0c7] text-[#93370d]`}>Recurring</span> : null}
                    <span className={`${pill} bg-[#eef4ff] text-[#1e3a8a]`}>{e.stage}</span>
                  </span>
                </span>
                <span className="hidden shrink-0 flex-wrap justify-end gap-1.5 sm:flex">
                  {now === "event" ? <span className={pill} style={{ background: `${STAGE_COLORS.event}1a`, color: STAGE_COLORS.event }}>Live now</span> : null}
                  {item.recurring && e.stage !== "Recurring" ? <span className={`${pill} bg-[#fef0c7] text-[#93370d]`}>Recurring</span> : null}
                  <span className={`${pill} bg-[#eef4ff] text-[#1e3a8a]`}>{e.stage}</span>
                </span>
              </li>
            );
          }
          const i = issues.get(item.id)!;
          const color = pubColor.get(i.publicationCode) ?? STAGE_COLORS.issue;
          const pubPill = (
            <span className={`${pill} text-white`} style={{ background: color }}>
              {i.publicationCode}
            </span>
          );
          return (
            <li key={`i-${item.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 sm:px-4" style={{ borderLeft: `5px solid ${color}` }}>
              <span className="w-14 shrink-0 whitespace-nowrap text-sm tabular-nums text-muted">{fmtDay(item.date)}</span>
              <span className="hidden sm:inline-flex">
                <StageDot stage="issue" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-1.5">
                  <Link href={`/editorial/issues/${item.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] font-medium hover:underline">
                    {item.title}
                  </Link>
                  {ctx.canWrite ? <EditPencil href={`/editorial/issues/${item.id}/edit`} label={`Edit ${item.title}`} /> : null}
                  {SEND_STATS_ENABLED && i.hasStats ? <span className="rounded bg-[#ecfdf3] px-1.5 py-0.5 text-[11px] font-semibold text-[#067647]">Stats</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">{["Issue", i.issueType, i.writer, i.subjectLines[0]].filter(Boolean).join(" · ")}</span>
                <span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
                  {pubPill}
                  <span className={`${pill} bg-[#eef4ff] text-[#1e3a8a]`}>{i.status}</span>
                </span>
              </span>
              <span className="hidden shrink-0 gap-1.5 sm:flex">
                {pubPill}
                <span className={`${pill} bg-[#eef4ff] text-[#1e3a8a]`}>{i.status}</span>
              </span>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">
            {publications.length === 0 ? "Start under Setup: add your publications, then add events and issues." : "Nothing matches these filters."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
