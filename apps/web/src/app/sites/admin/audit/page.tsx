import { rawPrisma } from "@pubcommand/db";
import { PageHeader } from "@/components/ui";

export default async function PlatformAuditPage() {
  const entries = await rawPrisma().platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div>
      <PageHeader title="Platform audit" description="Append-only. The application cannot update or delete these rows, and the database rejects both." />
      <table className="w-full border-collapse rounded-lg border border-line bg-white text-sm">
        <thead className="text-left text-xs uppercase text-muted">
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
