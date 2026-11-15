import { can } from "@pubcommand/core";
import { moduleRegistry, performanceHome } from "@pubcommand/modules";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default async function PerformancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const manifest = moduleRegistry.getBySlug("performance");
  if (!manifest) notFound();
  if (!ctx.subject.entitledModuleIds.includes(manifest.planEntitlement)) {
    return (
      <div>
        <PageHeader title={manifest.name} description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it.
        </p>
      </div>
    );
  }
  const allowed = manifest.permissions.some((permission) => can(ctx.subject, permission.key, ctx.scope));
  if (!allowed) return <Denied />;
  const home = performanceHome(ctx.resolved.id);
  return (
    <div>
      <PageHeader title={manifest.name} description={manifest.description} />
      <p className="mb-4 text-sm text-muted">
        {home.example
          ? "Example data for this organization. Broker import is not connected."
          : "Example seed for this organization. Broker import is not connected."}
      </p>
      <h2 className="mb-2 text-sm font-semibold">Recommendations</h2>
      <TableScroll>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Direction</th>
            <th className="px-3 py-2">Opened</th>
            <th className="px-3 py-2">Closed</th>
            <th className="px-3 py-2">P&L</th>
          </tr>
        </thead>
        <tbody>
          {home.recommendations.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-3 py-2">{row.symbol}</td>
              <td className="px-3 py-2">{row.direction}</td>
              <td className="px-3 py-2">{row.openedOn}</td>
              <td className="px-3 py-2">{row.closedOn}</td>
              <td className="px-3 py-2">{row.pnl}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
      <p className="mb-6 mt-2 text-sm text-muted">Closed P&L {home.closedPnl}</p>
      <h2 className="mb-2 text-sm font-semibold">Launch funnel</h2>
      <p className="mb-2 text-sm text-muted">Placeholder metrics. Launch tracking is not connected.</p>
      <TableScroll>
      <table className="w-full min-w-[24rem] border-collapse text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Visits</th>
            <th className="px-3 py-2">Opt-ins</th>
            <th className="px-3 py-2">Revenue</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <td className="px-3 py-2">{home.funnel.visits}</td>
            <td className="px-3 py-2">{home.funnel.optIns}</td>
            <td className="px-3 py-2">{home.funnel.revenue}</td>
          </tr>
        </tbody>
      </table>
      </TableScroll>
    </div>
  );
}
