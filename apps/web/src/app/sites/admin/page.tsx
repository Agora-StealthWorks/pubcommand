import { rawPrisma } from "@pubcommand/db";
import { PageHeader } from "@/components/ui";

export default async function AdminHome() {
  const [orgs, staff, audit] = await Promise.all([
    rawPrisma().organization.count(),
    rawPrisma().platformStaff.count({ where: { disabledAt: null } }),
    rawPrisma().platformAuditLog.count(),
  ]);
  return (
    <div>
      <PageHeader title="Platform console" description="Staff only. Organization roles never open this host." />
      <dl className="grid gap-4 md:grid-cols-3">
        <Stat label="Organizations" value={orgs} />
        <Stat label="Active staff" value={staff} />
        <Stat label="Platform audit events" value={audit} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold">{value}</dd>
    </div>
  );
}
