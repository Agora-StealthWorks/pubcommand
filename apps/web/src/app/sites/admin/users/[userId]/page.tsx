import { PLATFORM_PERMISSIONS, PLATFORM_STAFF_MANAGER_EMAIL, canManagePlatformStaff, platformCan } from "@pubcommand/core";
import { rawPrisma, userDeleteCheck } from "@pubcommand/db";
import { UserDeleteSection } from "@/components/platform-admin";
import { notFound } from "next/navigation";
import { UserDetail, type UserMembership, type UserPlacement } from "@/components/users-console";
import { Denied, Flash } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";
import {
  addUserOrganization,
  changeOrganizationMemberRole,
  deleteUser,
  removeOrganizationMember,
  resetUserAuthenticator,
  saveUserPassword,
  saveUserProfile,
  saveUserStaff,
  setUserAccess,
  setUserIdleTimeoutAction,
  signOutUserSessions,
} from "@/server/platform-actions";
import { userUsage } from "@/features/usage/stats";
import { UserUsageSection } from "@/features/usage/user-section";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { userId } = await params;
  const query = await searchParams;
  if (!USER_ID.test(userId)) notFound();
  const auth = await readSession();
  const viewer = auth.user;
  const staff = viewer ? await readStaff(viewer.id) : null;
  if (!viewer || !staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.viewUsers)) return <Denied title="Platform staff only" />;
  const user = await rawPrisma().user.findUnique({
    where: { id: userId },
    include: {
      staff: true,
      sessions: { select: { id: true } },
      memberships: { include: { organization: true, role: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!user) notFound();
  const organizations = await rawPrisma().organization.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: { roles: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  const rolesFor = new Map(organizations.map((organization) => [organization.id, organization.roles]));
  const activeOrgIds = new Set(
    user.memberships.filter((membership) => membership.status !== "DISABLED").map((membership) => membership.organizationId),
  );
  const memberships: UserMembership[] = user.memberships.map((membership) => ({
    id: membership.id,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    roleId: membership.roleId,
    roleName: membership.role.name,
    status: membership.status,
    roles: rolesFor.get(membership.organizationId) ?? [{ id: membership.roleId, name: membership.role.name }],
  }));
  const placements: UserPlacement[] = organizations
    .filter((organization) => !activeOrgIds.has(organization.id))
    .flatMap((organization) =>
      organization.roles.map((role) => ({
        organizationId: organization.id,
        organizationName: organization.name,
        roleId: role.id,
        roleName: role.name,
      })),
    );
  const canDelete = platformCan(staff.role, PLATFORM_PERMISSIONS.deleteData);
  const deleteBlocked = canDelete && !user.deletedAt ? await userDeleteCheck(viewer.id, user.id) : null;
  const usage = await userUsage(user.id, 30);
  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <UserDetail
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          disabled: Boolean(user.disabledAt),
          staffManager: user.email.toLowerCase() === PLATFORM_STAFF_MANAGER_EMAIL,
          sessionCount: user.sessions.length,
          staff: user.staff
            ? {
                role: user.staff.role,
                removed: Boolean(user.staff.disabledAt),
                totp: user.staff.totpConfirmedAt ? "enrolled" : "pending",
              }
            : null,
        }}
        memberships={memberships}
        placements={placements}
        canEdit={platformCan(staff.role, PLATFORM_PERMISSIONS.manageUsers)}
        canStaff={canManagePlatformStaff({ email: viewer.email, role: staff.role })}
        self={viewer.id === user.id}
        actions={{
          saveProfile: saveUserProfile,
          savePassword: saveUserPassword,
          resetTotp: resetUserAuthenticator,
          signOut: signOutUserSessions,
          setAccess: setUserAccess,
          changeRole: changeOrganizationMemberRole,
          removeMember: removeOrganizationMember,
          addOrganization: addUserOrganization,
          saveStaff: saveUserStaff,
        }}
      />
      <UserUsageSection userId={user.id} usage={usage} days={30} canEdit={platformCan(staff.role, PLATFORM_PERMISSIONS.manageUsers)} action={setUserIdleTimeoutAction} />
      {canDelete ? (
        <UserDeleteSection
          user={{ id: user.id, email: user.email, deleted: Boolean(user.deletedAt) }}
          blockedReason={deleteBlocked}
          action={deleteUser}
        />
      ) : null}
    </div>
  );
}
