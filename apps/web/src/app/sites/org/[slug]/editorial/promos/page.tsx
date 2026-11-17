import { tenantDb } from "@pubcommand/db";
import { Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { calendarPage, UUID } from "@/features/calendar/context";
import { loadOptions } from "@/features/calendar/options";
import { findPromo, listPromos } from "@/features/calendar/promos";
import { savePromoTrackAction } from "@/features/calendar/settings-actions";
import { Field, PromoLine, Section } from "@/features/calendar/ui";
import { fmtDayFull, toDay } from "../../../../../../../../../modules/editorial/dates";
import { CLOSED_PROMO_STAGES, optionsWith, pipelineColumns } from "../../../../../../../../../modules/editorial/options";

export default async function PromoPipelinePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; promo?: string; all?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const db = tenantDb(ctx.resolved.id);
  const [promos, options, tracks, events, rounds] = await Promise.all([
    listPromos(ctx.resolved.id, ctx.brand.id, 1000),
    loadOptions(ctx.resolved.id, ctx.brand.id),
    db.calendarPromoTrack.findMany({ where: { brandId: ctx.brand.id }, select: { promoId: true, launchDate: true, launchEstimated: true, writers: true } }),
    db.calendarEvent.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, promoId: { not: null } }, select: { promoId: true }, take: 5000 }),
    db.calendarCubRound.findMany({ where: { brandId: ctx.brand.id, promoId: { not: null } }, select: { promoId: true }, take: 5000 }),
  ]);
  const stages = options["promo.stage"];
  const showAll = query.all === "1";
  const track = new Map(tracks.map((t) => [t.promoId, t]));
  const tally = (rows: { promoId: string | null }[]) => rows.reduce((m, r) => m.set(r.promoId!, (m.get(r.promoId!) ?? 0) + 1), new Map<string, number>());
  const eventCount = tally(events);
  const cubCount = tally(rounds);
  const visible = promos.filter((p) => showAll || !CLOSED_PROMO_STAGES.includes(p.stage ?? ""));
  const columns = pipelineColumns(
    visible.map((p) => ({ ...p, stage: p.stage ?? stages[0] ?? null })),
    stages.filter((s) => showAll || !CLOSED_PROMO_STAGES.includes(s)),
  ).filter((c) => c.promos.length || !CLOSED_PROMO_STAGES.includes(c.stage));
  const selected = query.promo && UUID.test(query.promo) ? await findPromo(ctx.resolved.id, ctx.brand.id, query.promo) : null;

  return (
    <div className="space-y-5">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Promo pipeline</h2>
          <p className="text-sm text-muted">Promo Analyzer promos by workflow stage. Starting a CUB round moves a promo to CUB. Change the stages under Setup → Field options.</p>
        </div>
        <Link href={showAll ? "/editorial/promos" : "/editorial/promos?all=1"} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
          {showAll ? "Hide finished and parked" : "Show finished and parked"}
        </Link>
      </div>

      {selected && ctx.canWrite ? (
        <Section title={`Edit · ${selected.title}`} action={<Link href="/editorial/promos" className="text-sm font-medium text-accent">Close</Link>}>
          <form action={savePromoTrackAction} className="space-y-3">
            <input type="hidden" name="promoId" value={selected.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Stage">
                <select name="stage" className="pc-control w-full" defaultValue={selected.stage ?? stages[0]}>
                  {optionsWith(stages, selected.stage).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Launch date">
                <input type="date" name="launchDate" className="pc-control w-full" defaultValue={selected.launchDate ?? ""} />
              </Field>
              <label className="flex min-h-11 items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="launchEstimated" value="1" defaultChecked={track.get(selected.id)?.launchEstimated} /> Date is an estimate
              </label>
            </div>
            <Field label="Copywriters" hint="Separate names with commas.">
              <Input name="writers" maxLength={600} defaultValue={selected.writers.join(", ")} />
            </Field>
            <Field label="Notes">
              <Textarea name="notes" rows={3} defaultValue={selected.notes ?? ""} />
            </Field>
            <Button type="submit">Save</Button>
          </form>
        </Section>
      ) : null}

      {promos.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">
          No promos yet. Add them in <Link href="/promo-studio" className="font-medium text-accent">Promo Analyzer</Link>.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {columns.map((col) => (
            <section key={col.stage} className="min-w-0 rounded-xl border border-line bg-white p-3">
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
                {col.stage}
                <span className="rounded-full bg-canvas px-2 text-xs text-muted">{col.promos.length}</span>
              </h3>
              <ul className="space-y-2">
                {col.promos.map((p) => {
                  const t = track.get(p.id);
                  const launch = toDay(t?.launchDate);
                  return (
                    <li key={p.id} className="rounded-lg border border-line p-2.5">
                      <PromoLine promo={{ ...p, stage: null }} />
                      <p className="mt-1 text-xs text-muted">
                        {launch ? `Launch ${fmtDayFull(launch)}${t?.launchEstimated ? " (est.)" : ""}` : "No launch date"}
                        {t?.writers.length ? ` · ${t.writers.join(", ")}` : ""}
                        {eventCount.get(p.id) ? ` · ${eventCount.get(p.id)} event${eventCount.get(p.id) === 1 ? "" : "s"}` : ""}
                        {cubCount.get(p.id) ? ` · ${cubCount.get(p.id)} CUB round${cubCount.get(p.id) === 1 ? "" : "s"}` : ""}
                      </p>
                      {ctx.canWrite ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <form action={savePromoTrackAction} className="flex min-w-0 flex-1 gap-1">
                            <input type="hidden" name="promoId" value={p.id} />
                            <input type="hidden" name="back" value="board" />
                            <select name="stage" className="pc-control min-w-0 flex-1" defaultValue={p.stage ?? ""} aria-label={`Stage of ${p.title}`}>
                              {optionsWith(stages, p.stage).map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                            <Button type="submit" variant="secondary">
                              Move
                            </Button>
                          </form>
                          <Link href={`/editorial/promos?promo=${p.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
                            Details
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {col.promos.length === 0 ? <li className="text-xs text-muted">None</li> : null}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
