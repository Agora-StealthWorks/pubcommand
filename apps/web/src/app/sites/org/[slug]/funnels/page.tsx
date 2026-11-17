import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { createFunnel } from "@/features/funnels/actions";
import { listFunnels, orgTimezone, statusBadge } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { formatZoned } from "../../../../../../../../modules/funnels/time";

export default async function FunnelsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite } = access;
  const [funnels, timeZone] = await Promise.all([listFunnels(ctx.resolved.id, ctx.brand.id), orgTimezone(ctx.resolved.id)]);

  return (
    <div>
      <PageHeader title="Launch funnels" description={`Video-series launches and microsites for ${ctx.brand.name}: a waitlist with a countdown or a block-built home page, day-by-day videos, then a close or order page.`} />
      <Flash error={query.error} notice={query.notice} />
      <div className="space-y-4">
        {canWrite ? (
          <details className="rounded-xl border border-line bg-white" open={funnels.length === 0}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-accent">+ New launch funnel or microsite</summary>
            <form action={createFunnel} className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_200px_110px]">
              <div>
                <Label htmlFor="funnel-name">Name</Label>
                <Input id="funnel-name" name="name" required maxLength={120} placeholder="e.g. Spring masterclass" />
              </div>
              <div>
                <Label htmlFor="funnel-type">Type</Label>
                <select id="funnel-type" name="siteType" className="pc-control w-full text-sm" defaultValue="launch">
                  <option value="launch">Launch funnel (waitlist)</option>
                  <option value="microsite">Microsite (home page)</option>
                </select>
              </div>
              <div>
                <Label htmlFor="funnel-mode">Kind</Label>
                <select id="funnel-mode" name="mode" className="pc-control w-full text-sm" defaultValue="evergreen">
                  <option value="evergreen">Evergreen (pre-recorded)</option>
                  <option value="live">Live sessions</option>
                </select>
              </div>
              <div>
                <Label htmlFor="funnel-days">Days</Label>
                <Input id="funnel-days" name="days" type="number" min={0} max={10} defaultValue={3} />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" className="w-full sm:w-auto">
                  Create and open the builder
                </Button>
              </div>
            </form>
          </details>
        ) : null}

        <div className="rounded-xl border border-line bg-white">
          <TableScroll>
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Funnel</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Starts</th>
                  <th className="px-4 py-2.5 text-right">Days</th>
                  <th className="px-4 py-2.5 text-right">Opt-ins</th>
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
                        /l/{funnel.slug} · {funnel.siteType === "microsite" ? "Microsite" : "Launch"} · {funnel.mode === "live" ? "Live" : "Evergreen"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusBadge(funnel.status).tone}>{statusBadge(funnel.status).label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{funnel.timing === "per_viewer" && funnel.mode !== "live" ? "On first visit" : funnel.startAt ? formatZoned(funnel.startAt, timeZone, { weekday: false }) : "Not set"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{funnel.dayCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{funnel.optinCount}</td>
                  </tr>
                ))}
                {funnels.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted">
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
