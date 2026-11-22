import { buildSiteUrl, PLATFORM_PERMISSIONS, appAccessSummary, defaultMemberRoleId, organizationPurgeDate, platformCan } from "@pubcommand/core";
import { loadEntitlementState, platformTx, rawPrisma } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { OrgAppsSection, OrgDangerZone, OrgDomainsSection, type OrgAppRow } from "@/components/platform-admin";
import { appCatalog } from "@/lib/apps";
import { notFound } from "next/navigation";
import { OrganizationDetail, type OrganizationMemberRow } from "@/components/organizations-console";
import { Denied, Flash } from "@/components/ui";
import { readSession, readStaff, rootDomain, staffReady } from "@/lib/auth";
import { currentRequest } from "@/lib/request";
import {
  addOrganizationMember,
  addSelfAsOrganizationAdmin,
  changeOrganizationMemberRole,
  changeOrganizationPlan,
  removeOrganizationMember,
  deleteOrganization,
  purgeOrganizationNow,
  removeCustomDomain,
  restoreDeletedOrganization,
  setOrgAppAccess,
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
  const [state, domains] = await Promise.all([
    loadEntitlementState(organization.id),
    platformTx((tx) => tx.customDomain.findMany({ where: { organizationId: organization.id }, orderBy: { hostname: "asc" } })),
  ]);
  const cards = new Map(appCatalog().map((card) => [card.moduleId, card]));
  const ordered = [
    ...appCatalog().map((card) => card.moduleId),
    ...moduleRegistry.all().map((manifest) => manifest.id).filter((id) => !cards.has(id)),
  ];
  const apps: OrgAppRow[] = ordered.flatMap((moduleId) => {
    const manifest = moduleRegistry.getById(moduleId);
    if (!manifest || !state) return [];
    const summary = appAccessSummary(moduleId, state);
    return [{
      moduleId,
      name: cards.get(moduleId)?.name ?? manifest.name,
      description: cards.get(moduleId)?.description ?? manifest.description,
      ...summary,
      orgSwitchedOff: state.toggles[moduleId] === false,
    }];
  });
  const canDelete = platformCan(staff.role, PLATFORM_PERMISSIONS.deleteData);
  // New members default to the read-only User role (first in the add-member list).
  const defaultRoleId = defaultMemberRoleId(roles);
  const seatsUsed = organization.memberships.filter((member) => member.status === "ACTIVE" || member.status === "INVITED").length;
  const self = auth.user
    ? organization.memberships.find((member) => member.userId === auth.user?.id && member.status === "ACTIVE")
    : undefined;
  const request = await currentRequest();
  const workspace = {
    href: buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "org", slug: organization.slug }, pathname: "/" }),
    // Same rule as getOrgContext: members get in; the super admin may open any organization.
    access: self ? ("member" as const) : staff.role === "SUPER_ADMIN" && staffReady(staff, auth.session) && !organization.suspendedAt ? ("super_admin" as const) : ("none" as const),
  };
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
      {organization.deletedAt ? (
        <p className="mb-4 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm font-semibold text-[#b42318]">
          Deleted. Members cannot open it and its sites are offline. Restore it below before{" "}
          {organizationPurgeDate(organization.deletedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}.
        </p>
      ) : null}
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
          deleted: Boolean(organization.deletedAt),
        }}
        plans={plans}
        roles={[...roles].sort((a, b) => Number(b.id === defaultRoleId) - Number(a.id === defaultRoleId)).map((role) => ({ id: role.id, name: role.name }))}
        members={members}
        rootDomain={rootDomain()}
        workspace={workspace}
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
      >
        <OrgAppsSection
          organizationId={organization.id}
          apps={apps}
          canEdit={platformCan(staff.role, PLATFORM_PERMISSIONS.manageModules)}
          action={setOrgAppAccess}
        />
        <OrgDomainsSection
          domains={domains.map((domain) => ({
            id: domain.id,
            hostname: domain.hostname,
            status: domain.status,
            provider: domain.provider,
            targetPath: domain.targetPath,
            redirectToHost: domain.redirectToHost,
          }))}
          canRemove={canDelete}
          action={removeCustomDomain}
        />
        <OrgDangerZone
          organization={{ id: organization.id, name: organization.name, slug: organization.slug }}
          deletedAt={organization.deletedAt}
          purgeOn={organization.deletedAt ? organizationPurgeDate(organization.deletedAt) : null}
          canDelete={canDelete}
          actions={{ remove: deleteOrganization, restore: restoreDeletedOrganization, purge: purgeOrganizationNow }}
        />
      </OrganizationDetail>
    </div>
  );
}
