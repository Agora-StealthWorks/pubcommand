import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { calendarPage } from "@/features/calendar/context";
import { listPublications } from "@/features/calendar/data";
import { loadOptions } from "@/features/calendar/options";
import { movePromoStageAction } from "@/features/calendar/promo-actions";
import { listPromos } from "@/features/calendar/promos";
import { LinkButton, PubChip } from "@/features/calendar/ui";
import { fmtDayFull } from "../../../../../../../../../modules/editorial/dates";
import { CLOSED_PROMO_STAGES, optionsWith, pipelineColumns } from "../../../../../../../../../modules/editorial/options";

export default async function PromoPipelinePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; all?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const db = tenantDb(ctx.resolved.id);
  const [promos, options, publications, events, issues] = await Promise.all([
    listPromos(ctx.resolved.id, ctx.brand.id, 1000),
    loadOptions(ctx.resolved.id, ctx.brand.id),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
    db.calendarEvent.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, calendarPromoId: { not: null } }, select: { calendarPromoId: true }, take: 5000 }),
    db.calendarIssue.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, calendarPromoId: { not: null } }, select: { calendarPromoId: true }, take: 5000 }),
  ]);
  const stages = options["promo.stage"];
  const showAll = query.all === "1";
  const tally = (rows: { calendarPromoId: string | null }[]) => rows.reduce((m, r) => m.set(r.calendarPromoId!, (m.get(r.calendarPromoId!) ?? 0) + 1), new Map<string, number>());
  const eventCount = tally(events);
  const issueCount = tally(issues);
  const pubColor = new Map(publications.map((p) => [p.code, p.color]));
  const visible = promos.filter((p) => showAll || !CLOSED_PROMO_STAGES.includes(p.stage));
  const columns = pipelineColumns(visible, stages.filter((s) => showAll || !CLOSED_PROMO_STAGES.includes(s))).filter((c) => c.promos.length || !CLOSED_PROMO_STAGES.includes(c.stage));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="space-y-5">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Promo pipeline</h2>
          <p className="text-sm text-muted">Every promo by stage. Change the stages under Setup → Field options.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={showAll ? "/editorial/promos" : "/editorial/promos?all=1"} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
            {showAll ? "Hide finished and parked" : "Show finished and parked"}
          </Link>
          {ctx.canWrite ? (
            <LinkButton href="/editorial/promos/new" primary>
              + Promo
            </LinkButton>
          ) : null}
        </div>
      </div>

      {promos.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">
          No promos yet.{" "}
          {ctx.canWrite ? (
            <Link href="/editorial/promos/new" className="font-medium text-accent">
              Add the first one
            </Link>
          ) : null}
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
                  const links = [eventCount.get(p.id) ? plural(eventCount.get(p.id)!, "event") : null, issueCount.get(p.id) ? plural(issueCount.get(p.id)!, "issue") : null].filter(Boolean);
                  return (
                    <li key={p.id} className="rounded-lg border border-line p-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.product ? <PubChip code={p.product} color={pubColor.get(p.product)} /> : null}
                        <Link href={`/editorial/promos/${p.id}`} className="break-words [overflow-wrap:anywhere] font-medium text-accent hover:underline">
                          {p.name}
                        </Link>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {p.launchDate ? `Launch ${fmtDayFull(p.launchDate)}${p.launchEstimated ? " (est.)" : ""}` : "No launch date"}
                        {p.writers.length ? ` · ${p.writers.join(", ")}` : ""}
                        {links.length ? ` · ${links.join(", ")}` : ""}
                      </p>
                      {ctx.canWrite ? (
                        <form action={movePromoStageAction} className="mt-2 flex min-w-0 gap-1">
                          <input type="hidden" name="promoId" value={p.id} />
                          <select name="stage" className="pc-control min-w-0 flex-1" defaultValue={p.stage} aria-label={`Stage of ${p.name}`}>
                            {optionsWith(stages, p.stage).map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <Button type="submit" variant="secondary">
                            Move
                          </Button>
                        </form>
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
