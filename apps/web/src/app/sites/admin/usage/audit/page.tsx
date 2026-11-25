import { rawPrisma } from "@pubcommand/db";
import { TableScroll } from "@/components/table-scroll";
import { PageHeader } from "@/components/ui";

export default async function PlatformAuditPage() {
  const entries = await rawPrisma().platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div>
      <PageHeader title="Platform audit" description="Append-only. The application cannot update or delete these rows, and the database rejects both." />
      <TableScroll>
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead className="text-left text-xs uppercase text-muted">
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
