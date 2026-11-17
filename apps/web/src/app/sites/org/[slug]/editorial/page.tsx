import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { quickAddAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { feedItems, listChannels, listPublications, loadRange } from "@/features/calendar/data";
import { PubChip, StageLegend, StageNow } from "@/features/calendar/ui";
import { fmtDay, fmtTime, isDay, todayIn } from "../../../../../../../../modules/editorial/dates";
import { EVENT_STAGES, ISSUE_STATUSES, filterFeed, stageOn } from "../../../../../../../../modules/editorial/stages";

type Query = { q?: string; kind?: string; channel?: string; pub?: string; stage?: string; view?: string; recurring?: string; from?: string; to?: string; error?: string; notice?: string };

export default async function RunningListPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Query> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const today = todayIn();
  const upcoming = query.view !== "all";
  const from = !upcoming && isDay(query.from) ? query.from : null;
  const to = !upcoming && isDay(query.to) ? query.to : null;
  const [range, publications, channels] = await Promise.all([
    loadRange(ctx.resolved.id, ctx.brand.id, upcoming ? today : from, to),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
    listChannels(ctx.resolved.id, ctx.brand.id),
  ]);
  const kind = query.kind === "event" || query.kind === "issue" ? query.kind : "all";
  const items = filterFeed(feedItems(range), {
    today,
    upcoming,
    q: query.q,
    kind,
    channel: query.channel || undefined,
    publication: query.pub || undefined,
    stage: query.stage || undefined,
    hideRecurring: query.recurring === "hide",
    from: from ?? undefined,
    to: to ?? undefined,
  }).slice(0, 500);
  const pubColor = new Map(publications.map((p) => [p.code, p.color]));
  const events = new Map(range.events.map((e) => [e.id, e]));
  const issues = new Map(range.issues.map((i) => [i.id, i]));
  const activePubs = publications.filter((p) => p.active);

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      {ctx.canWrite ? (
        <form action={quickAddAction} className="grid gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:items-center">
          <select name="kind" aria-label="What to add" className="pc-control" defaultValue="event">
            <option value="event">Event</option>
            <option value="issue">Issue</option>
          </select>
          <Input name="title" placeholder="Quick add: name or title" aria-label="Name or title" maxLength={200} required />
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
      ) : null}

      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3" action="/editorial">
        <Input name="q" defaultValue={query.q ?? ""} placeholder="Search" aria-label="Search" className="w-full sm:w-48" />
        <select name="kind" defaultValue={kind} aria-label="Type" className="pc-control">
          <option value="all">Events and issues</option>
          <option value="event">Events only</option>
          <option value="issue">Issues only</option>
        </select>
        <select name="pub" defaultValue={query.pub ?? ""} aria-label="Publication" className="pc-control">
          <option value="">All publications</option>
          {publications.map((p) => (
            <option key={p.id} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
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
        <select name="stage" defaultValue={query.stage ?? ""} aria-label="Stage or status" className="pc-control">
          <option value="">Any stage or status</option>
          <optgroup label="Event stage">
            {EVENT_STAGES.map((s) => (
              <option key={`e-${s}`} value={s}>
                {s}
              </option>
            ))}
          </optgroup>
          <optgroup label="Issue status">
            {ISSUE_STATUSES.filter((s) => !(EVENT_STAGES as readonly string[]).includes(s)).map((s) => (
              <option key={`i-${s}`} value={s}>
                {s}
              </option>
            ))}
          </optgroup>
        </select>
        <select name="view" defaultValue={upcoming ? "upcoming" : "all"} aria-label="Range" className="pc-control">
          <option value="upcoming">Upcoming and running</option>
          <option value="all">All dates (newest first)</option>
        </select>
        {!upcoming ? (
          <>
            <input type="date" name="from" defaultValue={from ?? ""} aria-label="From" className="pc-control" />
            <input type="date" name="to" defaultValue={to ?? ""} aria-label="To" className="pc-control" />
          </>
        ) : null}
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="recurring" value="hide" defaultChecked={query.recurring === "hide"} /> Hide recurring
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <StageLegend />
        <span className="text-xs text-muted">{items.length} items</span>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {items.map((item) => {
          if (item.kind === "event") {
            const e = events.get(item.id)!;
            const now = stageOn(e, today);
            return (
              <li key={`e-${item.id}`}>
                <Link href={`/editorial/events/${item.id}`} className="flex gap-3 px-4 py-3 hover:bg-canvas">
                  <span className="w-14 shrink-0 text-sm font-semibold tabular-nums">{fmtDay(item.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-words [overflow-wrap:anywhere] font-medium">{item.title}</span>
                      {item.recurring ? <span className="rounded bg-[#fef0c7] px-1.5 py-0.5 text-[11px] font-semibold text-[#93370d]">Recurring</span> : null}
                      <StageNow stage={now} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {[
                        "Event",
                        e.eventType,
                        e.format,
                        e.startTime ? `${fmtTime(e.startTime)} ET` : null,
                        e.channels.join(", ") || null,
                        e.marketingStart || e.marketingEnd ? `marketing ${fmtDay(e.marketingStart)} – ${fmtDay(e.marketingEnd)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted sm:block">{e.stage}</span>
                </Link>
              </li>
            );
          }
          const i = issues.get(item.id)!;
          return (
            <li key={`i-${item.id}`}>
              <Link href={`/editorial/issues/${item.id}`} className="flex gap-3 px-4 py-3 hover:bg-canvas">
                <span className="w-14 shrink-0 text-sm font-semibold tabular-nums">{fmtDay(item.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <PubChip code={i.publicationCode} color={pubColor.get(i.publicationCode)} />
                    <span className="break-words [overflow-wrap:anywhere] font-medium">{item.title}</span>
                    {i.hasStats ? <span className="rounded bg-[#ecfdf3] px-1.5 py-0.5 text-[11px] font-semibold text-[#067647]">Stats</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{["Issue", i.issueType, i.writer, i.subjectLines[0]].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted sm:block">{i.status}</span>
              </Link>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted">
            {publications.length === 0 ? "Start under Setup: add your publications, then add events and issues." : "Nothing matches these filters."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
