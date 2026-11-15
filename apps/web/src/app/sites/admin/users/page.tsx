import { rawPrisma } from "@pubcommand/db";
import { TableScroll } from "@/components/table-scroll";
import { PageHeader } from "@/components/ui";

export default async function PlatformUsersPage() {
  const users = await rawPrisma().user.findMany({
    include: { staff: true, memberships: { include: { organization: true } } },
    orderBy: { email: "asc" },
  });
  return (
    <div>
      <PageHeader title="Users" description="Platform view of accounts. Staff status is separate from organization membership." />
      <TableScroll>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead className="text-left text-xs uppercase text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Staff</th><th>Organizations</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-line">
              <td className="pc-break px-3 py-2">{user.email}</td>
              <td>{user.staff && !user.staff.disabledAt ? user.staff.role : "—"}</td>
              <td className="pc-break">{user.memberships.map((membership) => membership.organization.slug).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
    </div>
  );
}
