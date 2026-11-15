import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
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
      <table className="w-full border-collapse rounded-lg border border-line bg-white text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">When</th><th>Action</th><th>Target</th></tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-line">
              <td className="px-3 py-2">{entry.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td>{entry.action}</td>
              <td>{entry.targetType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
