import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { buildRadarAction } from "@/features/intel/actions";
import { intelAccess } from "@/features/intel/context";
import { listRadarWeeks, loadRadar } from "@/features/intel/data";
import { computeRadar } from "@/features/intel/server";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { EMAIL_TYPE_LABELS, hostOf, isoDay, parseWeek, weekLabel, weekStartOf, type EmailType, type RadarSummary } from "../../../../../../../../../modules/intel/index";

const DAY_MS = 86_400_000;

export default async function IntelRadarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ week?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const thisWeek = weekStartOf(new Date());
  const week = parseWeek(search.week) ?? thisWeek;
  const [stored, weeks] = await Promise.all([loadRadar(scope.organizationId, scope.brand.id, week), listRadarWeeks(scope.organizationId, scope.brand.id)]);
  // Without a stored radar, show the live grouping so the page is never empty when there is data.
  const summary: RadarSummary = stored?.summary ?? (await computeRadar(scope.organizationId, scope.brand.id, week));
  const prev = isoDay(new Date(week.getTime() - 7 * DAY_MS));
  const next = week.getTime() < thisWeek.getTime() ? isoDay(new Date(week.getTime() + 7 * DAY_MS)) : null;
  const busy = stored?.status === "QUEUED" || stored?.status === "RUNNING";

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Promo Radar · {weekLabel(week)}</h2>
          <p className="text-sm text-muted">
            {summary.totals.emails} competitor email{summary.totals.emails === 1 ? "" : "s"} · {summary.totals.promos} promo{summary.totals.promos === 1 ? "" : "s"} ({summary.totals.newPromos} new) ·{" "}
            {summary.totals.competitors} sender{summary.totals.competitors === 1 ? "" : "s"}
            {summary.totals.emails > summary.totals.classified ? ` · ${summary.totals.emails - summary.totals.classified} not extracted yet` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/intel/radar?week=${prev}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">
            ← Week before
          </Link>
          {next ? (
            <Link href={`/intel/radar?week=${next}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">
              Week after →
            </Link>
          ) : null}
          {scope.canWrite ? (
            <form action={buildRadarAction}>
              <input type="hidden" name="week" value={isoDay(week)} />
              <Button type="submit" disabled={busy}>
                {stored ? "Rebuild radar" : "Build radar"}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {!stored ? (
        <p className="mb-4 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">
          A live preview. Build the radar to save this week, write the AI read of recurring angles and teach the brand Brain. It is also built every Monday by the scheduled job.
        </p>
      ) : null}
      {busy ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Writing the radar read · <AutoRefresh />
        </p>
      ) : null}
      {stored?.status === "FAILED" ? <p className="mb-4 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">The AI read failed: {stored.error}</p> : null}
      {stored && stored.status === "NONE" && !aiConfigured() && summary.totals.promos > 0 ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          The AI key is not set, so the radar has no written read; the grouping below comes straight from the emails. Add <code>ANTHROPIC_API_KEY</code>, then rebuild.
        </p>
      ) : null}

      {stored?.narrative ? (
        <section className="mb-4 rounded-xl border border-line bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">This week&apos;s read</h3>
          <p className="text-sm text-ink">{stored.narrative.overview}</p>
          {stored.narrative.themes.length ? (
            <ul className="mt-3 space-y-2">
              {stored.narrative.themes.map((theme) => (
                <li key={theme.angle} className="text-sm">
                  <span className="font-semibold">{theme.angle}</span>
                  {theme.competitors.length ? <span className="text-muted"> · {theme.competitors.join(", ")}</span> : null}
                  <p className="text-ink">{theme.note}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {stored.narrative.watch.length ? (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Worth watching</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {stored.narrative.watch.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="mt-3 text-xs text-muted">Written by AI ({stored.model}) from the promos below. Saved to this brand&apos;s Brain.</p>
        </section>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-3">
          {summary.competitors.length === 0 ? (
            <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">No competitor emails this week.</p>
          ) : null}
          {summary.competitors.map((group) => (
            <div key={group.key} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                {group.competitorId ? (
                  <Link href={`/intel/competitors/${group.competitorId}`} className="pc-break font-semibold text-ink underline-offset-2 hover:underline">
                    {group.name}
                  </Link>
                ) : (
                  <span className="pc-break font-semibold text-ink">{group.name}</span>
                )}
                <span className="text-xs text-muted">
                  {group.emails} email{group.emails === 1 ? "" : "s"}:{" "}
                  {Object.entries(group.types)
                    .map(([type, count]) => `${count} ${(EMAIL_TYPE_LABELS[type as EmailType] ?? "not extracted").toLowerCase()}`)
                    .join(", ")}
                </span>
              </div>
              {group.promos.length ? (
                <ul className="mt-2 divide-y divide-line">
                  {group.promos.map((promo) => (
                    <li key={promo.key} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {promo.isNew ? <Badge tone="accent">new</Badge> : <Badge>returning</Badge>}
                        <Link href={`/intel/emails/${promo.emailIds[0]}`} className="pc-break text-sm font-medium text-ink hover:underline">
                          {promo.headline}
                        </Link>
                      </div>
                      <p className="pc-break mt-0.5 text-xs text-muted">
                        {[
                          `${promo.sends} send${promo.sends === 1 ? "" : "s"} from ${promo.firstSent}`,
                          promo.product,
                          promo.priceText ? `${promo.priceText} (as stated)` : null,
                          promo.experts.join(", ") || null,
                          hostOf(promo.landingUrl),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {promo.angles.length ? (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {promo.angles.map((angle) => (
                            <span key={angle} className="rounded-full bg-canvas px-2 py-0.5 text-xs">
                              {angle}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted">No promos this week.</p>
              )}
            </div>
          ))}
        </section>
        <aside className="min-w-0 space-y-4">
          <div className="rounded-xl border border-line bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Recurring angles</h3>
            {summary.angles.length === 0 ? (
              <p className="text-sm text-muted">None yet: an angle shows here once it is used twice or by two competitors.</p>
            ) : (
              <ul className="space-y-2">
                {summary.angles.map((angle) => (
                  <li key={angle.angle} className="text-sm">
                    <span className="font-medium">{angle.angle}</span> <span className="text-muted">· {angle.count}×</span>
                    <p className="pc-break text-xs text-muted">{angle.competitors.join(", ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {weeks.length ? (
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Saved weeks</h3>
              <ul className="space-y-1 text-sm">
                {weeks.map((row) => (
                  <li key={row.id}>
                    <Link href={`/intel/radar?week=${isoDay(row.weekStart)}`} className={`underline ${isoDay(row.weekStart) === isoDay(week) ? "font-semibold text-ink" : "text-accent"}`}>
                      {weekLabel(row.weekStart)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
