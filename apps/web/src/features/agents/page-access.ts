import { can } from "@pubcommand/core";
import { getOrgContext } from "@/lib/org";

/**
 * AI Agents pages. Every member can add and manage their own agents. agents.manage sees and
 * manages all of them and the organization setting; anyone with publish rights in Websites or
 * Mini-Blog can work the Approvals queue for those apps.
 */
export async function agentsPage(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return null;
  const brandIds = ctx.subject.membershipBrandId ? [ctx.subject.membershipBrandId] : ctx.brands.map((brand) => brand.id);
  const publishBrands = (permission: string, moduleId: string) =>
    ctx.subject.entitledModuleIds.includes(moduleId) ? brandIds.filter((brandId) => can(ctx.subject, permission, { organizationId: ctx.resolved.id, brandId })) : [];
  const webPublishBrands = publishBrands("websites.publish", "websites");
  const textPublishBrands = publishBrands("miniblog.publish", "miniblog");
  return {
    ctx,
    me: ctx.auth.user.id,
    canManage: can(ctx.subject, "agents.manage", ctx.scope),
    webPublishBrands,
    textPublishBrands,
    canApprove: webPublishBrands.length > 0 || textPublishBrands.length > 0,
  };
}

export const when = (date: Date | null | undefined, timeZone = "America/New_York") =>
  date ? date.toLocaleString("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
