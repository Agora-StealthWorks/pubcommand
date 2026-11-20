import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export type WebsitesPermission = "websites.read" | "websites.write" | "websites.publish" | "websites.settings" | "websites.members";

/** Cookie remembering which of the brand's sites the sub-menu pages work on. */
export const SITE_COOKIE = "pc_web_site";

/** Cookie that carries a new API key to the settings page once (2 minutes, that path only). */
export const NEW_KEY_COOKIE = "pc_web_new_key";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function allowed(ctx: { subject: AccessSubject; scope: AccessScope }, permissions: WebsitesPermission[]) {
  return ctx.subject.entitledModuleIds.includes("websites") && ["websites.read", ...permissions].every((permission) => can(ctx.subject, permission, ctx.scope));
}

/** The brand's current site: the cookie's choice, else the first one. */
async function currentSite(organizationId: string, brandId: string) {
  const sites = await tenantDb(organizationId).webSite.findMany({ where: { brandId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const chosen = (await cookies()).get(SITE_COOKIE)?.value;
  return { sites, site: sites.find((site) => site.id === chosen) ?? sites[0] ?? null };
}

/** Page guard: org, entitlement, permission, brand, and the site being edited. */
export async function websitesAccess(slug: string, permission: WebsitesPermission = "websites.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("websites")) return { kind: "denied" as const, title: "Websites is turned off for this organization" };
  if (!allowed(ctx, [permission])) return { kind: "denied" as const, title: "You do not have access" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  const { sites, site } = await currentSite(ctx.resolved.id, ctx.brand.id);
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    sites,
    site,
    canWrite: can(ctx.subject, "websites.write", ctx.scope),
    canPublish: can(ctx.subject, "websites.publish", ctx.scope),
    canSettings: can(ctx.subject, "websites.settings", ctx.scope),
    canMembers: can(ctx.subject, "websites.members", ctx.scope),
  };
}

/** Server-action guard. Redirects with a message instead of throwing. */
export async function websitesAction(back: string, ...permissions: WebsitesPermission[]) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!allowed(ctx, permissions)) redirect(withMessage(back, "error", "You do not have permission to do that."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return {
    ...ctx,
    brand: ctx.brand,
    actorId: ctx.auth.user.id,
    canPublish: can(ctx.subject, "websites.publish", ctx.scope),
  };
}

/** For calls from the browser (image uploads): the same checks, null instead of a redirect. */
export async function websitesWriteCtx() {
  const request = await currentRequest();
  if (request.site.kind !== "org") return null;
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok" || !ctx.brand) return null;
  return allowed(ctx, ["websites.write"]) ? { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id } : null;
}

export type WebsitesCtx = Awaited<ReturnType<typeof websitesAction>>;

/** A site of the action's brand, or a redirect. */
export async function ownSite(ctx: WebsitesCtx, siteId: string, back = "/websites") {
  const site = UUID_RE.test(siteId) ? await tenantDb(ctx.resolved.id).webSite.findFirst({ where: { id: siteId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!site) redirect(withMessage(back, "error", "That website no longer exists."));
  return site;
}

export function withMessage(path: string, kind: "error" | "notice", message: string): string {
  const [beforeHash, hash = ""] = path.split("#");
  const [base, query = ""] = (beforeHash ?? "").split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(kind, message);
  return `${base}?${params.toString()}${hash ? `#${hash}` : ""}`;
}
