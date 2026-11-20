import { can, type AccessScope } from "@pubcommand/core";
import { loadAccessSubject, loadSuperAdminSubject, rawPrisma, resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { cookies } from "next/headers";
import { cache } from "react";
import { readImpersonation, readSession, readStaff, staffReady } from "./auth";
import { currentRequest } from "./request";

export const getOrgContext = cache(async (slug: string) => {
  const request = await currentRequest();
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

export { can };
