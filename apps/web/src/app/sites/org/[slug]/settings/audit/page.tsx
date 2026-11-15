import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default async function AuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.audit.read", ctx.scope)) return <Denied />;
  const entries = await tenantDb(ctx.resolved.id).auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div>
      <PageHeader title="Audit log" description="Permission and admin changes for this organization." />
      <TableScroll>
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">When</th><th>Action</th><th>Target</th></tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-line">
              <td className="px-3 py-2">{entry.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td className="pc-break">{entry.action}</td>
              <td className="pc-break">{entry.targetType}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
    </div>
  );
}
