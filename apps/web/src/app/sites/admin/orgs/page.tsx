import { AGENT_EMAIL_DOMAIN, PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { OrganizationsList, type OrganizationListItem } from "@/components/organizations-console";
import Link from "next/link";
import { Flash } from "@/components/ui";
import { readSession, readStaff, rootDomain } from "@/lib/auth";

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; show?: string }> }) {
  const query = await searchParams;
  const showDeleted = query.show === "deleted";
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  const deletedCount = await rawPrisma().organization.count({ where: { deletedAt: { not: null } } });
  const rows = await rawPrisma().organization.findMany({
    where: { deletedAt: showDeleted ? { not: null } : null },
    include: {
      plan: true,
      memberships: { select: { status: true }, where: { user: { email: { not: { endsWith: `@${AGENT_EMAIL_DOMAIN}` } } } } },
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
    deleted: Boolean(organization.deletedAt),
  }));
  const tab = (active: boolean) =>
    `inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`;
  return (
    <div>
      <Flash error={query.error} notice={query.notice} />
      <nav className="mb-4 flex gap-1 border-b border-line" aria-label="Filter organizations">
        <Link href="/orgs" className={tab(!showDeleted)}>Active</Link>
        <Link href="/orgs?show=deleted" className={tab(showDeleted)}>Deleted ({deletedCount})</Link>
      </nav>
      <OrganizationsList
        organizations={organizations}
        rootDomain={rootDomain()}
        canCreate={Boolean(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.manageOrgs))}
      />
    </div>
  );
}
