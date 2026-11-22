import { can, type AccessScope } from "@pubcommand/core";
import { loadAccessSubject, loadSuperAdminSubject, rawPrisma, resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { cookies } from "next/headers";
import { cache } from "react";
import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { readImpersonation, readSession, readStaff, staffReady } from "./auth";
import { CONSOLE_ORG_SLUG, ensureConsoleOrganization } from "./console-workspace";
import { currentRequest } from "./request";

type CurrentRequest = Awaited<ReturnType<typeof currentRequest>>;

/**
 * The organization slug this request works in: the org host's slug, or the
 * console workspace on admin.<root> (Promo Analyzer and VidRipper run there).
 * Null on any other host. Use it instead of reading request.site.slug directly.
 */
export function requestOrgSlug(request: CurrentRequest): string | null {
  if (request.site.kind === "org") return request.site.slug;
  if (request.site.kind === "admin") return CONSOLE_ORG_SLUG;
  return null;
}

/** True when the page is the admin console's copy of an org app. */
export function isConsoleRequest(request: CurrentRequest): boolean {
  return request.site.kind === "admin";
}

export const getOrgContext = cache(async (slug: string) => {
  const request = await currentRequest();
  if (request.site.kind === "admin" && slug === CONSOLE_ORG_SLUG) return consoleContext(request);
  if (request.site.kind !== "org" || request.site.slug !== slug) return { kind: "mismatch" as const, request };
  const resolved = await resolveOrgBySlug(slug);
  if (!resolved) return { kind: "missing" as const, request };
  if (resolved.redirected) return { kind: "redirect" as const, resolved, request };
  const auth = await readSession();
  if (!auth.user || !auth.session) return { kind: "anonymous" as const, request, resolved };
  const impersonation = await readImpersonation(auth.user.id);
  const impersonatingHere = impersonation?.organizationId === resolved.id ? impersonation : null;
  const effectiveUserId = impersonatingHere?.targetUserId ?? auth.user.id;
  if (resolved.suspendedAt) {
    return { kind: "suspended" as const, request, resolved, auth, impersonatingHere };
  }
  let subject = await loadAccessSubject(resolved.id, effectiveUserId, moduleRegistry.permissionModules());
  if (!subject && !impersonatingHere && auth.session.mfaVerified) {
    // The platform super admin can open every organization without being a member.
    const staff = await readStaff(auth.user.id);
    if (staff?.role === "SUPER_ADMIN" && staffReady(staff, auth.session)) {
      subject = await loadSuperAdminSubject(resolved.id, auth.user.id, moduleRegistry.permissionModules());
    }
  }
  if (!subject) return { kind: "forbidden" as const, request, resolved, auth, impersonatingHere };
  const brands = await tenantDb(resolved.id).brand.findMany({
    orderBy: { name: "asc" },
    include: { workspaces: { orderBy: { name: "asc" } } },
  });
  const brandCookie = (await cookies()).get("pc_brand")?.value;
  const brand = brands.find((item) => item.id === brandCookie) ?? brands[0] ?? null;
  const memberships = await rawPrisma().membership.findMany({
    where: { userId: effectiveUserId, status: "ACTIVE", organization: { deletedAt: null } },
    include: { organization: true },
    orderBy: { organization: { name: "asc" } },
  });
  const scope: AccessScope = {
    organizationId: resolved.id,
    brandId: subject.membershipBrandId ?? brand?.id ?? null,
  };
  return {
    kind: "ok" as const,
    request,
    resolved,
    auth,
    subject,
    brands,
    brand,
    memberships,
    impersonatingHere,
    effectiveUserId,
    scope,
  };
});

/**
 * The console workspace for signed-in platform staff who may use the Master
 * Brain (platform.brain.manage). Same shape as an org context, with every
 * permission, so the org apps' pages and actions run unchanged.
 */
async function consoleContext(request: CurrentRequest) {
  const auth = await readSession();
  if (!auth.user || !auth.session) return { kind: "mismatch" as const, request };
  const staff = await readStaff(auth.user.id);
  if (!staff || !staffReady(staff, auth.session) || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageBrain)) {
    return { kind: "mismatch" as const, request };
  }
  await ensureConsoleOrganization();
  const resolved = await resolveOrgBySlug(CONSOLE_ORG_SLUG);
  if (!resolved || resolved.redirected) return { kind: "missing" as const, request };
  const subject = await loadSuperAdminSubject(resolved.id, auth.user.id, moduleRegistry.permissionModules());
  if (!subject) return { kind: "missing" as const, request };
  const brands = await tenantDb(resolved.id).brand.findMany({ orderBy: { name: "asc" }, include: { workspaces: { orderBy: { name: "asc" } } } });
  const brand = brands[0] ?? null;
  const scope: AccessScope = { organizationId: resolved.id, brandId: brand?.id ?? null };
  return {
    kind: "ok" as const,
    request,
    resolved,
    auth: { ...auth, user: auth.user, session: auth.session },
    subject,
    brands,
    brand,
    memberships: [] as Awaited<ReturnType<ReturnType<typeof rawPrisma>["membership"]["findMany"]>>,
    impersonatingHere: null,
    effectiveUserId: auth.user.id,
    scope,
  };
}

export { can };
