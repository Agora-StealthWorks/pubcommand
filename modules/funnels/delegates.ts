/**
 * Funnel delegates: members who may build ONE funnel without the role
 * permission to build every funnel. PURE.
 *
 * - The role decides first: funnels.read / write / publish apply to every
 *   funnel of the brand.
 * - A delegate of a funnel may see and edit that funnel (read + write) even
 *   without those permissions, and sees only their funnels in the list.
 * - Delegation never grants publish: publishing, opt-in exports, header and
 *   footer code, delegates and deleting stay with funnels.publish.
 */
export type RoleAccess = { read: boolean; write: boolean; publish: boolean };

export type FunnelAccess = RoleAccess & { delegate: boolean };

export function funnelAccess(role: RoleAccess, isDelegate: boolean): FunnelAccess {
  const delegate = isDelegate && !role.write;
  return {
    read: role.read || isDelegate,
    write: role.write || isDelegate,
    publish: role.publish,
    delegate,
  };
}

/** May this person open the Funnels list at all? */
export function canOpenFunnels(role: RoleAccess, delegateFunnelCount: number): boolean {
  return role.read || delegateFunnelCount > 0;
}

/** Which funnels the list shows: all of the brand's, or only the delegated ones. */
export function visibleFunnelIds(role: RoleAccess, allIds: string[], delegatedIds: string[]): string[] {
  if (role.read) return allIds;
  const mine = new Set(delegatedIds);
  return allIds.filter((id) => mine.has(id));
}

/** A permission a delegate may hold on their funnel. */
export function delegateAllows(permission: "funnels.read" | "funnels.write" | "funnels.publish"): boolean {
  return permission !== "funnels.publish";
}
