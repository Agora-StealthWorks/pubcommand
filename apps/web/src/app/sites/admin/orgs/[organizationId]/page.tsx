import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { OrganizationDetail, type OrganizationMemberRow } from "@/components/organizations-console";
import { Denied, Flash } from "@/components/ui";
import { readSession, readStaff, rootDomain } from "@/lib/auth";
import {
  addOrganizationMember,
  addSelfAsOrganizationAdmin,
  changeOrganizationMemberRole,
  changeOrganizationPlan,
  removeOrganizationMember,
  startImpersonation,
  suspendOrganization,
} from "@/server/platform-actions";

const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  if (!ORGANIZATION_ID.test(organizationId)) notFound();
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.viewOrgs)) return <Denied title="Platform staff only" />;
  const organization = await rawPrisma().organization.findUnique({
    where: { id: organizationId },
    include: {
      plan: true,
      memberships: { include: { user: true, role: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { brands: true, workspaces: true } },
    },
  });
  if (!organization) notFound();
  const [plans, roles] = await Promise.all([
    rawPrisma().plan.findMany({
      where: { OR: [{ archivedAt: null }, { id: organization.planId }] },
      orderBy: { seatLimit: "asc" },
      select: { id: true, name: true },
    }),
    rawPrisma().role.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  const seatsUsed = organization.memberships.filter((member) => member.status === "ACTIVE" || member.status === "INVITED").length;
  const self = auth.user
    ? organization.memberships.find((member) => member.userId === auth.user?.id && member.status === "ACTIVE")
    : undefined;
  const members: OrganizationMemberRow[] = organization.memberships.map((member) => ({
    id: member.id,
    email: member.user.email,
    roleId: member.roleId,
    roleName: member.role.name,
    status: member.status,
  }));
  return (
    <div>
      <Flash error={query.error} notice={query.notice} />
      <OrganizationDetail
        organization={{
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          planId: organization.planId,
          planName: organization.plan.name,
          seatsUsed,
          seatLimit: organization.seatLimit,
          brands: organization._count.brands,
          workspaces: organization._count.workspaces,
          suspended: Boolean(organization.suspendedAt),
        }}
        plans={plans}
        roles={roles.map((role) => ({ id: role.id, name: role.name }))}
        members={members}
        rootDomain={rootDomain()}
        selfIsAdmin={Boolean(self && (self.role.slug === "admin" || self.role.slug === "owner"))}
        canManage={platformCan(staff.role, PLATFORM_PERMISSIONS.manageOrgs)}
        canPlan={platformCan(staff.role, PLATFORM_PERMISSIONS.managePlans)}
        canSuspend={platformCan(staff.role, PLATFORM_PERMISSIONS.suspendOrgs)}
        canImpersonate={platformCan(staff.role, PLATFORM_PERMISSIONS.impersonate)}
        actions={{
          addMember: addOrganizationMember,
          removeMember: removeOrganizationMember,
          changeRole: changeOrganizationMemberRole,
          addSelf: addSelfAsOrganizationAdmin,
          changePlan: changeOrganizationPlan,
          suspend: suspendOrganization,
          impersonate: startImpersonation,
        }}
      />
    </div>
  );
}
