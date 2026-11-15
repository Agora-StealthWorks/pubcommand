import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { OrganizationsList, type OrganizationListItem } from "@/components/organizations-console";
import { Flash } from "@/components/ui";
import { readSession, readStaff, rootDomain } from "@/lib/auth";

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  const rows = await rawPrisma().organization.findMany({
    include: {
      plan: true,
      memberships: { select: { status: true } },
      _count: { select: { brands: true, workspaces: true } },
    },
    orderBy: { name: "asc" },
  });
  const organizations: OrganizationListItem[] = rows.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    planId: organization.planId,
    planName: organization.plan.name,
    seatsUsed: organization.memberships.filter((member) => member.status === "ACTIVE" || member.status === "INVITED").length,
    seatLimit: organization.seatLimit,
    brands: organization._count.brands,
    workspaces: organization._count.workspaces,
    suspended: Boolean(organization.suspendedAt),
  }));
  return (
    <div>
      <Flash error={query.error} notice={query.notice} />
      <OrganizationsList
        organizations={organizations}
        rootDomain={rootDomain()}
        canCreate={Boolean(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.manageOrgs))}
      />
    </div>
  );
}
