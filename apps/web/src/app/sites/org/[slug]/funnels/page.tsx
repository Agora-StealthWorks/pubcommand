import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { FUNNEL_PRESETS, PRESET_INFO } from "../../../../../../../../modules/funnels/presets";
import { createFunnel, duplicateFunnel } from "@/features/funnels/actions";
import { PROGRESSIONS, PROGRESSION_LABELS, type Progression } from "../../../../../../../../modules/funnels/state";
import { listFunnels, orgTimezone, statusBadge } from "@/features/funnels/data";
import { delegatedFunnelIds, funnelsAccess } from "@/features/funnels/guard";
import { visibleFunnelIds } from "../../../../../../../../modules/funnels/delegates";
import { formatZoned } from "../../../../../../../../modules/funnels/time";

export default async function FunnelsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canPublish, delegateOnly } = access;
  const [all, timeZone, delegated] = await Promise.all([listFunnels(ctx.resolved.id, ctx.brand.id), orgTimezone(ctx.resolved.id), delegateOnly ? delegatedFunnelIds(ctx.resolved.id, ctx.effectiveUserId) : Promise.resolve([])]);
  // A delegate without funnels.read sees only the funnels they were given.
  const visible = new Set(visibleFunnelIds({ read: !delegateOnly, write: canWrite, publish: false }, all.map((funnel) => funnel.id), delegated));
  const funnels = all.filter((funnel) => visible.has(funnel.id));
  const smallBase = "inline-flex min-h-9 items-center whitespace-nowrap rounded-md border px-2.5 text-xs font-semibold";
  const small = `${smallBase} border-line bg-white hover:bg-canvas`;
  const smallPrimary = `${smallBase} border-accent bg-accent text-white hover:opacity-90`;

  return (
    <div>
      <PageHeader title="Launch funnels" description={delegateOnly ? `The ${ctx.brand.name} funnels you were made a delegate of.` : `Video-series launches and microsites for ${ctx.brand.name}: a waitlist with a countdown or a block-built home page, day-by-day videos, then a close or order page.`} />
      <Flash error={query.error} notice={query.notice} />
      {canPublish ? (
        <p className="-mt-2 mb-4 text-sm">
          <Link href="/funnels/settings" className="font-semibold text-accent">
            Funnels settings
          </Link>{" "}
          <span className="text-muted">· tracked URL parameters for every funnel</span>
        </p>
      ) : null}
      <div className="space-y-4">
        {canWrite ? (
          <details className="rounded-xl border border-line bg-white" open={funnels.length === 0}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-accent">+ New launch funnel or microsite</summary>
            <form action={createFunnel} className="grid gap-4 border-t border-line p-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div>
                <Label htmlFor="funnel-name">Name</Label>
                <Input id="funnel-name" name="name" required maxLength={120} placeholder="e.g. Spring masterclass" />
              </div>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium text-ink">Start from a preset</legend>
                <p className="text-xs text-muted">Sets sensible starting settings. You can change anything afterwards.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {FUNNEL_PRESETS.map((preset) => (
                    <label key={preset} className="flex min-h-24 cursor-pointer gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-[#f5f8ff]">
                      <input type="radio" name="preset" value={preset} defaultChecked={preset === "evergreen"} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
                      <span>
                        <span className="block font-semibold">{PRESET_INFO[preset].label}</span>
                        <span className="block text-xs text-muted">{PRESET_INFO[preset].description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <Label htmlFor="funnel-days">Days / videos</Label>
                <Input id="funnel-days" name="days" type="number" min={0} max={30} defaultValue={4} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" className="w-full sm:w-auto">
                  Create and open the builder
                </Button>
              </div>
            </form>
          </details>
        ) : null}

        <div className="rounded-xl border border-line bg-white">
          <TableScroll>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Funnel</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Mode</th>
                  <th className="px-4 py-2.5 text-right">Days</th>
                  <th className="px-4 py-2.5">Starts</th>
                  <th className="px-4 py-2.5">Ends</th>
                  <th className="px-4 py-2.5 text-right">Opt-ins</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {funnels.map((funnel) => (
                  <tr key={funnel.id} className="border-b border-line last:border-0">
                    <td className="max-w-[320px] px-4 py-3">
                      <Link href={`/funnels/${funnel.id}`} className="font-semibold text-ink [overflow-wrap:anywhere] hover:text-accent">
                        {funnel.name}
                      </Link>
                      <span className="block truncate text-xs text-muted">
                        /l/{funnel.slug} · {funnel.siteType === "microsite" ? "Microsite" : "Launch funnel"} · {PROGRESSION_LABELS[(PROGRESSIONS as readonly string[]).includes(funnel.progression) ? (funnel.progression as Progression) : "all_open"]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusBadge(funnel.status).tone}>{statusBadge(funnel.status).label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {funnel.mode === "live" ? "Live" : "Evergreen"}
                      {funnel.timing === "per_viewer" && funnel.mode !== "live" ? <span className="block text-xs text-muted">per viewer</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{funnel.dayCount}</td>
                    <td className="px-4 py-3 text-muted">{funnel.timing === "per_viewer" && funnel.mode !== "live" ? "First visit" : funnel.startAt ? formatZoned(funnel.startAt, timeZone, { weekday: false }) : "Not set"}</td>
                    <td className="px-4 py-3 text-muted">{funnel.timing === "per_viewer" && funnel.mode !== "live" ? "—" : funnel.endAt ? formatZoned(funnel.endAt, timeZone, { weekday: false }) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{funnel.optinCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <a href={`/l/${funnel.slug}?preview=1`} target="_blank" rel="noopener" className={small}>
                          Preview
                        </a>
                        <Link href={`/funnels/${funnel.id}/stats`} className={small}>
                          Stats
                        </Link>
                        {canWrite ? (
                          <form action={duplicateFunnel}>
                            <input type="hidden" name="funnelId" value={funnel.id} />
                            <button type="submit" className={small}>
                              Duplicate
                            </button>
                          </form>
                        ) : null}
                        <Link href={`/funnels/${funnel.id}`} className={smallPrimary}>
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {funnels.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted">
                      No launch funnels yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </div>
    </div>
  );
}
