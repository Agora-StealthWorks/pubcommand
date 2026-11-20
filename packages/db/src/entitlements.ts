import {
  effectiveModuleIds,
  superAdminModuleIds,
  type AppAccessOverride,
  type EntitlementInput,
} from "@pubcommand/core";
import type { Prisma } from "@prisma/client";
import { rawPrisma } from "./client";

/**
 * THE place an organization's entitled apps are worked out. Every guard
 * (loadAccessSubject), public page, API and job goes through here, so a staff
 * override or a plan change reaches all of them at once.
 */

export type OrganizationEntitlementState = EntitlementInput & {
  organizationId: string;
  deleted: boolean;
  suspended: boolean;
};

/** Platform reads of the staff override table (RLS only lets bypass_rls write it). */
export async function platformTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx);
  });
}

export async function loadEntitlementStates(organizationIds: readonly string[]): Promise<Map<string, OrganizationEntitlementState>> {
  const ids = [...new Set(organizationIds)];
  const out = new Map<string, OrganizationEntitlementState>();
  if (ids.length === 0) return out;
  const [orgs, overrides] = await platformTx((tx) =>
    Promise.all([
      tx.organization.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          deletedAt: true,
          suspendedAt: true,
          plan: { select: { modules: { select: { moduleId: true } } } },
          modules: { select: { moduleId: true, enabled: true } },
        },
      }),
      tx.organizationAppAccess.findMany({ where: { orgId: { in: ids } }, select: { orgId: true, moduleId: true, access: true } }),
    ]),
  );
  for (const org of orgs) {
    const own: Record<string, AppAccessOverride> = {};
    for (const row of overrides) if (row.orgId === org.id) own[row.moduleId] = row.access;
    out.set(org.id, {
      organizationId: org.id,
      deleted: Boolean(org.deletedAt),
      suspended: Boolean(org.suspendedAt),
      planModuleIds: org.plan.modules.map((row) => row.moduleId),
      overrides: own,
      toggles: Object.fromEntries(org.modules.map((row) => [row.moduleId, row.enabled])),
    });
  }
  return out;
}

export async function loadEntitlementState(organizationId: string): Promise<OrganizationEntitlementState | null> {
  return (await loadEntitlementStates([organizationId])).get(organizationId) ?? null;
}

/** Entitled module ids for an org member. Empty for a deleted organization. */
export function entitledFromState(state: OrganizationEntitlementState): string[] {
  if (state.deleted) return [];
  return effectiveModuleIds(state);
}

/** Entitled module ids for the platform super admin (no plan limit; staff blocks and org switches apply). */
export function superAdminEntitledFromState(state: OrganizationEntitlementState, allModuleIds: readonly string[]): string[] {
  if (state.deleted) return [];
  return superAdminModuleIds(allModuleIds, state);
}

/**
 * Public pages and APIs with no signed-in subject: is this app live for the org?
 * False when the org is deleted or suspended, blocked by staff, off the plan, or switched off.
 */
export async function organizationHasModule(organizationId: string, moduleId: string): Promise<boolean> {
  const state = await loadEntitlementState(organizationId);
  if (!state || state.suspended) return false;
  return entitledFromState(state).includes(moduleId);
}

/** Jobs: which of these organizations have the app on right now (same rule as above). */
export async function organizationsWithModule(organizationIds: readonly string[], moduleId: string): Promise<Set<string>> {
  const states = await loadEntitlementStates(organizationIds);
  const out = new Set<string>();
  for (const state of states.values()) {
    if (!state.suspended && entitledFromState(state).includes(moduleId)) out.add(state.organizationId);
  }
  return out;
}

/** Organizations scheduled work should touch: not deleted, not suspended. */
export async function activeOrganizationIds(): Promise<string[]> {
  const rows = await rawPrisma().organization.findMany({ where: { deletedAt: null, suspendedAt: null }, select: { id: true } });
  return rows.map((row) => row.id);
}
