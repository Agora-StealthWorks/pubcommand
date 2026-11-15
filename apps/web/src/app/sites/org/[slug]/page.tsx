import { Badge, Card } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default async function OrgHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const [settings, audit] = await Promise.all([
    tenantDb(ctx.resolved.id).orgSettings.findUnique({ where: { organizationId: ctx.resolved.id } }),
    tenantDb(ctx.resolved.id).auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return (
    <div>
      <PageHeader title={settings?.displayName ?? ctx.resolved.name} description="Organization overview. Product modules in the sidebar are shells in this phase." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted">Brand</p>
          <p className="mt-2 text-lg font-semibold">{ctx.brand?.name ?? "No brand yet"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted">Workspaces</p>
          <p className="mt-2 text-lg font-semibold">{ctx.brand?.workspaces.length ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase text-muted">Modules</p>
          <p className="mt-2 text-lg font-semibold">{ctx.subject.entitledModuleIds.length}</p>
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Recent audit</h2>
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {audit.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{entry.action}</span>
            <Badge>{entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Badge>
          </li>
        ))}
        {audit.length === 0 ? <li className="px-4 py-4 text-sm text-muted">No audit events yet.</li> : null}
      </ul>
    </div>
  );
}
