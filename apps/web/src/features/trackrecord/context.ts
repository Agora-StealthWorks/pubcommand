import { brandProfile, can } from "@pubcommand/core";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export type TrackScope = {
  organizationId: string;
  brandId: string;
  brandName: string;
  actorId: string;
  canWrite: boolean;
  slug: string;
};

export type TrackAccess = { ok: true; scope: TrackScope } | { ok: false; error: string };

/**
 * Every Track Record page, action and route calls this. Reading needs performance.read (or write); changing
 * anything needs performance.write. Track Record is finance-only, so a non-finance brand is refused here too,
 * not just hidden from the nav.
 */
export async function trackAccess(permission: "performance.read" | "performance.write" = "performance.read", slug?: string): Promise<TrackAccess> {
  const request = await currentRequest();
  if (request.site.kind !== "org") return { ok: false, error: "Open Track Record from your organization." };
  const orgSlug = slug ?? request.site.slug;
  const ctx = await getOrgContext(orgSlug);
  if (ctx.kind !== "ok") return { ok: false, error: "You are not signed in to this organization." };
  if (!ctx.subject.entitledModuleIds.includes("performance")) return { ok: false, error: "Track Record is turned off for this organization." };
  const canWrite = can(ctx.subject, "performance.write", ctx.scope);
  const canRead = canWrite || can(ctx.subject, "performance.read", ctx.scope);
  if (!canRead || (permission === "performance.write" && !canWrite)) return { ok: false, error: "You do not have access to this part of Track Record." };
  if (!ctx.brand) return { ok: false, error: "Add a brand in Settings first." };
  if (brandProfile(ctx.brand).niche !== "finance") return { ok: false, error: `Track Record is for finance brands. ${ctx.brand.name} is not set up as one.` };
  return {
    ok: true,
    scope: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, brandName: ctx.brand.name, actorId: ctx.auth.user.id, canWrite, slug: orgSlug },
  };
}
