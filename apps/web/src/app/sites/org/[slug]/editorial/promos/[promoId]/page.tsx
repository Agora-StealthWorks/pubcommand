import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { calendarPage } from "@/features/calendar/context";
import { listPublications } from "@/features/calendar/data";
import { loadOptions } from "@/features/calendar/options";
import { deletePromoAction, movePromoStageAction } from "@/features/calendar/promo-actions";
import { findPromo } from "@/features/calendar/promos";
import { ExternalLink, LinkButton, PubChip, Section } from "@/features/calendar/ui";
import { fmtDay, fmtDayFull, isDay, todayIn, toDay } from "../../../../../../../../../../modules/editorial/dates";
import { optionsWith } from "../../../../../../../../../../modules/editorial/options";

function when(d: Date): string {
  return fmtDayFull(todayIn("America/New_York", d));
}

/** History values: days read as dates, everything else as typed. */
function shown(value: string | null): string {
  if (!value) return "—";
  return isDay(value) ? fmtDayFull(value) : value;
}

export default async function PromoPage({ params, searchParams }: { params: Promise<{ slug: string; promoId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, promoId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, promoId);
  if (!promo) notFound();
  const db = tenantDb(ctx.resolved.id);
  const [options, publications, events, issues, activity] = await Promise.all([
    loadOptions(ctx.resolved.id, ctx.brand.id),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
    db.calendarEvent.findMany({ where: { brandId: ctx.brand.id, calendarPromoId: promo.id, deletedAt: null }, orderBy: [{ eventDate: "asc" }, { name: "asc" }], select: { id: true, name: true, eventDate: true, stage: true }, take: 200 }),
    db.calendarIssue.findMany({ where: { brandId: ctx.brand.id, calendarPromoId: promo.id, deletedAt: null }, orderBy: [{ mailDate: "asc" }, { title: "asc" }], select: { id: true, title: true, mailDate: true, publicationCode: true, status: true }, take: 200 }),
    db.calendarPromoActivity.findMany({ where: { promoId: promo.id }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const actorIds = [...new Set(activity.map((a) => a.actorId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length ? await db.membership.findMany({ where: { userId: { in: actorIds } }, select: { userId: true, user: { select: { name: true, email: true } } } }).catch(() => []) : [];
  const actorName = new Map(actors.map((a) => [a.userId, a.user.name || a.user.email]));
  const pub = publications.find((p) => p.code === promo.product);
  const stages = options["promo.stage"];
  const detail = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="break-words [overflow-wrap:anywhere] font-medium">{value || "—"}</dd>
    </div>
  );

  return (
    <div className="max-w-4xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <Link href="/editorial/promos" className="text-accent hover:underline">
              Promos
            </Link>
            {promo.product ? <PubChip code={promo.product} color={pub?.color} /> : null}
            {pub?.name ?? null}
          </p>
          <h2 className="mt-1 break-words [overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">{promo.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="rounded-full bg-[#fde8f2] px-2 py-0.5 text-xs font-semibold text-[#8a1155]">{promo.stage}</span>
            {[promo.promoType, promo.format].filter(Boolean).join(" · ")}
          </p>
        </div>
        {ctx.canWrite ? (
          <LinkButton href={`/editorial/promos/${promo.id}/edit`} primary>
            Edit
          </LinkButton>
        ) : null}
      </header>

      {ctx.canWrite ? (
        <form action={movePromoStageAction} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3">
          <input type="hidden" name="promoId" value={promo.id} />
          <input type="hidden" name="back" value="detail" />
          <label htmlFor="promo-stage" className="text-sm font-medium">
            Stage
          </label>
          <select id="promo-stage" name="stage" className="pc-control min-w-0 flex-1 sm:max-w-xs" defaultValue={promo.stage}>
            {optionsWith(stages, promo.stage).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Move
          </Button>
        </form>
      ) : null}

      <Section title="Details">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {detail("Launch date", promo.launchDate ? `${fmtDayFull(promo.launchDate)}${promo.launchEstimated ? " (estimate)" : ""}` : null)}
          {detail("Targeted date", promo.targetedDate ? fmtDayFull(promo.targetedDate) : null)}
          {detail("Copywriters", promo.writers.join(", "))}
          {detail("Editors", promo.gurus.join(", "))}
          {detail("Publication", promo.product ? `${promo.product}${pub ? ` · ${pub.name}` : ""}` : null)}
          {detail("Type", [promo.promoType, promo.format].filter(Boolean).join(" · "))}
        </dl>
        {promo.copyPlatformUrl || promo.hotlistPageUrl || promo.promoFileUrl ? (
          <div className="mt-3 flex flex-col gap-1 text-sm">
            <ExternalLink href={promo.copyPlatformUrl}>Copy platform ↗</ExternalLink>
            <ExternalLink href={promo.hotlistPageUrl}>Hotlist page ↗</ExternalLink>
            <ExternalLink href={promo.promoFileUrl}>Promo file ↗</ExternalLink>
          </div>
        ) : null}
        {promo.notes ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{promo.notes}</p> : null}
      </Section>

      <Section title={`On the calendar · ${events.length + issues.length}`}>
        {events.length + issues.length === 0 ? (
          <p className="text-sm text-muted">Nothing linked yet. Pick this promo on an event or issue{promo.launchDate || promo.targetedDate ? "" : ", or give it a launch date to add its launch event"}.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/editorial/events/${e.id}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm hover:bg-canvas">
                  <span className="w-14 shrink-0 font-semibold tabular-nums">{fmtDay(toDay(e.eventDate))}</span>
                  <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-medium">
                    {e.name}
                    {promo.launchEventId === e.id ? <span className="ml-2 rounded bg-[#ecfdf3] px-1.5 py-0.5 text-[11px] font-semibold text-[#067647]">Launch event</span> : null}
                  </span>
                  <span className="text-xs text-muted">Event · {e.stage}</span>
                </Link>
              </li>
            ))}
            {issues.map((i) => (
              <li key={i.id}>
                <Link href={`/editorial/issues/${i.id}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm hover:bg-canvas">
                  <span className="w-14 shrink-0 font-semibold tabular-nums">{fmtDay(toDay(i.mailDate))}</span>
                  <PubChip code={i.publicationCode} color={publications.find((p) => p.code === i.publicationCode)?.color} />
                  <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-medium">{i.title}</span>
                  <span className="text-xs text-muted">Issue · {i.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="History">
        <ol className="space-y-2 text-sm">
          {activity.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-2">
              <span className="w-28 shrink-0 text-muted">{when(a.createdAt)}</span>
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                {a.kind === "created" ? (a.note ?? "Created") : a.kind === "launchEvent" ? a.note : `${a.field}: ${shown(a.fromValue)} → ${shown(a.toValue)}`}
                {a.actorId && actorName.get(a.actorId) ? <span className="text-muted"> · {actorName.get(a.actorId)}</span> : null}
              </span>
            </li>
          ))}
          {activity.length === 0 ? <li className="text-muted">No history yet.</li> : null}
        </ol>
      </Section>

      {ctx.canWrite ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Delete…</summary>
          <form action={deletePromoAction} className="mt-3 space-y-2">
            <input type="hidden" name="promoId" value={promo.id} />
            <p className="text-sm text-muted">Linked events and issues stay on the calendar without this promo.</p>
            <Button type="submit" variant="danger">
              Delete this promo
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
