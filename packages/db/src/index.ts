export { Prisma, PrismaClient } from "@prisma/client";
export { MembershipStatus, PermissionEffect, PlatformRole } from "@prisma/client";
export type { AppPrisma } from "./client";
export { PlatformAuditImmutableError, createPrismaClient, getPrisma, rawPrisma } from "./client";
export { appendOrgAudit, loadAccessSubject } from "./access";
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
export { ensureSuperadmin } from "./superadmin";
export { TenantIsolationError, createTenantClient, tenantDb, withOrgContext } from "./tenant";
