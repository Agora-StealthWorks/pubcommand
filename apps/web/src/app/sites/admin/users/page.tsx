import { rawPrisma } from "@pubcommand/db";
import { PageHeader } from "@/components/ui";

export default async function PlatformUsersPage() {
  const users = await rawPrisma().user.findMany({
    include: { staff: true, memberships: { include: { organization: true } } },
    orderBy: { email: "asc" },
  });
  return (
    <div>
      <PageHeader title="Users" description="Platform view of accounts. Staff status is separate from organization membership." />
      <table className="w-full border-collapse rounded-lg border border-line bg-white text-sm">
        <thead className="text-left text-xs uppercase text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Staff</th><th>Organizations</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-line">
              <td className="px-3 py-2">{user.email}</td>
              <td>{user.staff && !user.staff.disabledAt ? user.staff.role : "—"}</td>
              <td>{user.memberships.map((membership) => membership.organization.slug).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
