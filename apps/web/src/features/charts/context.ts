import { can } from "@pubcommand/core";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import type { Scope } from "./server";

export type ChartsAccess = { ok: true; scope: Scope; canManage: boolean; slug: string } | { ok: false; error: string };

/**
 * Every page, action and route calls this. Making and saving charts needs charts.read or charts.write
 * (editors are seeded with charts.read); managing templates and deleting any project needs charts.write.
 */
export async function chartsAccess(slug?: string): Promise<ChartsAccess> {
  const request = await currentRequest();
  if (request.site.kind !== "org") return { ok: false, error: "Open ChartBuilder from your organization." };
  const orgSlug = slug ?? request.site.slug;
  const ctx = await getOrgContext(orgSlug);
  if (ctx.kind !== "ok") return { ok: false, error: "You are not signed in to this organization." };
  if (!ctx.subject.entitledModuleIds.includes("charts")) return { ok: false, error: "ChartBuilder is turned off for this organization." };
  const canUse = can(ctx.subject, "charts.read", ctx.scope) || can(ctx.subject, "charts.write", ctx.scope);
  if (!canUse) return { ok: false, error: "You do not have access to ChartBuilder." };
  if (!ctx.brand) return { ok: false, error: "Add a brand in Settings first." };
  return {
    ok: true,
    slug: orgSlug,
    canManage: can(ctx.subject, "charts.write", ctx.scope),
    scope: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, brandName: ctx.brand.name, actorId: ctx.auth.user.id },
  };
}
