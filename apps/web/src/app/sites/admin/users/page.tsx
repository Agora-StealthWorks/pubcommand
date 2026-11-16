import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { UsersList, type UserListRow } from "@/components/users-console";
import { Denied, PageHeader } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";

export default async function PlatformUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q?.trim().slice(0, 80) ?? "";
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.viewUsers)) return <Denied title="Platform staff only" />;
  const users = await rawPrisma().user.findMany({
    where: query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { staff: true, memberships: { include: { organization: true } } },
    orderBy: { email: "asc" },
  });
  const rows: UserListRow[] = users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    disabled: Boolean(user.disabledAt),
    staffRole: user.staff && !user.staff.disabledAt ? user.staff.role : null,
    organizations: user.memberships
      .filter((membership) => membership.status !== "DISABLED")
      .map((membership) => membership.organization.slug)
      .join(", "),
  }));
  return (
    <div>
      <PageHeader title="Users" description="Search accounts, then open one to edit the profile, memberships, password, or staff access." />
      <UsersList users={rows} query={query} />
    </div>
  );
}
