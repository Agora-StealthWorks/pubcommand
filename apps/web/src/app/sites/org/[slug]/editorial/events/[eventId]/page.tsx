import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { deleteEventAction } from "@/features/calendar/actions";
import { findPromo } from "@/features/calendar/promos";
import { trashSeriesAction } from "@/features/calendar/settings-actions";
import { calendarPage } from "@/features/calendar/context";
import { listChannels, loadEvent } from "@/features/calendar/data";
import { count, ExternalLink, LinkButton, money, PromoLine, Section, Stat, StageDot, StageNow } from "@/features/calendar/ui";
import { fmtDayFull, fmtTime, todayIn } from "../../../../../../../../../../modules/editorial/dates";
import { FREQUENCY_LABELS, isFrequency } from "../../../../../../../../../../modules/editorial/recurrence";
import { STAGE_LABELS, stageOn, stageSpans } from "../../../../../../../../../../modules/editorial/stages";

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, eventId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const [loaded, channels] = await Promise.all([loadEvent(ctx.resolved.id, ctx.brand.id, eventId), listChannels(ctx.resolved.id, ctx.brand.id)]);
  if (!loaded) notFound();
  const { event: e, dates, series, followingCount } = loaded;
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, e.promoId);
  const spans = stageSpans(dates);
  const channelColor = new Map(channels.map((c) => [c.name, c.color]));
  const metrics = [
    ["Peak attendance", count(e.peakAttendance)],
    ["Average attendance", count(e.avgAttendance)],
    ["Registrations", count(e.registrations)],
    ["New subscribers", count(e.newSubscribers)],
    ["Leads", count(e.leads)],
    ["Orders", count(e.orders)],
    ["Revenue", money(e.revenue)],
    ["Revenue per attendee", e.revenue != null && e.peakAttendance ? money(Math.round(e.revenue / e.peakAttendance)) : "—"],
    ["Chat messages", count(e.messages)],
  ] as const;

  return (
    <div className="max-w-4xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Event</p>
          <h2 className="break-words [overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">{e.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{e.stage}</span>
            {e.eventType ? <span>· {e.eventType}</span> : null}
            {e.format ? <span>· {e.format}</span> : null}
            <StageNow stage={stageOn(dates, todayIn())} />
          </div>
        </div>
        {ctx.canWrite ? (
          <div className="flex flex-wrap gap-2">
            {series ? (
              <>
                <LinkButton href={`/editorial/events/${e.id}/edit?scope=single`}>Edit this one</LinkButton>
                <LinkButton href={`/editorial/events/${e.id}/edit?scope=following`} primary>
                  Edit this and {followingCount} later
                </LinkButton>
              </>
            ) : (
              <LinkButton href={`/editorial/events/${e.id}/edit`} primary>
                Edit
              </LinkButton>
            )}
          </div>
        ) : null}
      </header>

      {series ? (
        <p className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Part of a series: {isFrequency(series.frequency) ? FREQUENCY_LABELS[series.frequency].toLowerCase() : series.frequency}
          {series.until ? ` until ${fmtDayFull(series.until)}` : ""}
          {series.active ? "" : " (stopped)"}. {followingCount} later occurrence{followingCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      <Section title="When">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Event</dt>
            <dd className="font-medium">
              {dates.eventDate ? fmtDayFull(dates.eventDate) : "No date yet"}
              {dates.eventEnd && dates.eventEnd !== dates.eventDate ? ` – ${fmtDayFull(dates.eventEnd)}` : ""}
              {e.startTime ? ` · ${fmtTime(e.startTime)}${e.endTime ? `–${fmtTime(e.endTime)}` : ""} ET` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Marketing window</dt>
            <dd className="font-medium">
              {dates.marketingStart || dates.marketingEnd ? `${fmtDayFull(dates.marketingStart)} – ${fmtDayFull(dates.marketingEnd)}` : "Not set"}
            </dd>
          </div>
        </dl>
        {spans.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {spans.map((span) => (
              <li key={span.stage} className="flex items-center gap-2">
                <StageDot stage={span.stage} />
                <span className="font-medium">{STAGE_LABELS[span.stage]}:</span>
                <span className="text-muted">
                  {fmtDayFull(span.start)}
                  {span.end !== span.start ? ` – ${fmtDayFull(span.end)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Details">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Channels</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {e.channels.length
                ? e.channels.map((name) => (
                    <span key={name} className="rounded px-2 py-0.5 text-xs font-semibold text-white" style={{ background: channelColor.get(name) ?? "#475467" }}>
                      {name}
                    </span>
                  ))
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Hosts</dt>
            <dd className="font-medium">{e.hosts.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Offer</dt>
            <dd className="break-words [overflow-wrap:anywhere] font-medium">{e.offer ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Promo code</dt>
            <dd className="font-medium">{e.promoCode ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Promo</dt>
            <dd className="mt-1">
              <PromoLine promo={promo} />
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <ExternalLink href={e.ctaLink}>Call-to-action link ↗</ExternalLink>
            <ExternalLink href={e.registrationLink}>Registration link ↗</ExternalLink>
            <ExternalLink href={e.replayLink}>Replay ↗</ExternalLink>
          </div>
        </dl>
        {e.notes ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{e.notes}</p> : null}
      </Section>

      <Section title="Results">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {metrics.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </dl>
      </Section>

      {ctx.canWrite ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Delete…</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={deleteEventAction}>
              <input type="hidden" name="eventId" value={e.id} />
              <input type="hidden" name="scope" value="single" />
              <Button type="submit" variant="danger">
                {series ? "Delete only this occurrence" : "Delete this event"}
              </Button>
            </form>
            {series ? (
              <form action={deleteEventAction}>
                <input type="hidden" name="eventId" value={e.id} />
                <input type="hidden" name="scope" value="following" />
                <Button type="submit" variant="danger">
                  Delete this and {followingCount} later
                </Button>
              </form>
            ) : null}
            {series ? (
              <form action={trashSeriesAction}>
                <input type="hidden" name="seriesId" value={series.id} />
                <Button type="submit" variant="danger">
                  Move the whole series to the trash
                </Button>
              </form>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted">Deleted items go to the trash (Setup → Trash), where you can restore them.</p>
        </details>
      ) : null}
      <p>
        <Link href="/editorial" className="text-sm font-medium text-accent">
          ← Back to the list
        </Link>
      </p>
    </div>
  );
}
