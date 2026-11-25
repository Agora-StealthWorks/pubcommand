export { Prisma, PrismaClient } from "@prisma/client";
export { MembershipStatus, PermissionEffect, PlatformRole } from "@prisma/client";
export type { AppPrisma } from "./client";
export { PlatformAuditImmutableError, createPrismaClient, getPrisma, rawPrisma } from "./client";
export { appendOrgAudit, loadAccessSubject, loadSuperAdminSubject } from "./access";
export { DEFAULT_SUPERADMIN_EMAIL, normalizeEmail } from "./email";
export { appendPlatformAudit, changeOrganizationSlug, resolveOrgBySlug, slugAvailability } from "./platform";
export {
  activateInvitedMemberships,
  addOrganizationMember,
  addStaffAsOrganizationAdmin,
  assignOrganizationPlan,
  changeOrganizationMemberRole,
  provisionOrganization,
  removeOrganizationMember,
  setOrganizationSuspended,
} from "./provision";
export {
  resetUserTwoFactor,
  revokeUserSessions,
  setPlatformStaffAccess,
  setUserDisabled,
  setUserPasswordHash,
  updateUserProfile,
} from "./accounts";
export { createCatalogPlan, ensureDefaultPlans, insertPlanIfAbsent, setPlanArchived, updateCatalogPlan } from "./plans";
export { readDefaultAppIds, saveDefaultAppIds } from "./platform-settings";
export { ensureSuperadmin } from "./superadmin";
export { TenantIsolationError, createTenantClient, tenantDb, tenantModelNames, withOrgContext } from "./tenant";
export {
  activeOrganizationIds,
  entitledFromState,
  loadEntitlementState,
  loadEntitlementStates,
  organizationHasModule,
  organizationsWithModule,
  platformTx,
  type OrganizationEntitlementState,
} from "./entitlements";
export {
  deleteUserAccount,
  lastAdminOrganizations,
  organizationsDueForPurge,
  purgeOrganization,
  restoreOrganization,
  setOrganizationAppAccess,
  softDeleteOrganization,
  superAdminEmails,
  tablesWithOrganizationId,
  userDeleteCheck,
  type DomainDetachResult,
  type PurgeDomain,
} from "./lifecycle";
export { ensureBuiltInMemberRoles, ensureBuiltInMemberRolesForAll, ensureBuiltInRolesForAll, ensureOwnerPermissions } from "./roles";
export { changeOwnPassword, memberPasswordFacts, resetForgottenPassword, setMemberPassword, updateOwnName } from "./passwords";
