import { buildSiteUrl, can } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { rootDomain } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export type FunnelsPermission = "funnels.read" | "funnels.write" | "funnels.publish";

/** Page/route guard: org, entitlement, permission and brand. Called by every page and route handler. */
export async function funnelsAccess(slug: string, permission: FunnelsPermission = "funnels.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("funnels")) return { kind: "denied" as const, title: "Funnels is turned off for this organization" };
  if (!can(ctx.subject, "funnels.read", ctx.scope) || !can(ctx.subject, permission, ctx.scope)) return { kind: "denied" as const, title: "You do not have access" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    canWrite: can(ctx.subject, "funnels.write", ctx.scope),
    canPublish: can(ctx.subject, "funnels.publish", ctx.scope),
  };
}

/** Server-action guard. Redirects with a message instead of throwing. */
export async function funnelsAction(back: string, ...permissions: FunnelsPermission[]) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  const allowed = ctx.subject.entitledModuleIds.includes("funnels") && ["funnels.read", ...permissions].every((permission) => can(ctx.subject, permission, ctx.scope));
  if (!allowed) redirect(withMessage(back, "error", "You do not have permission to do that."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id, request };
}

export type FunnelsCtx = Awaited<ReturnType<typeof funnelsAction>>;

export function withMessage(path: string, kind: "error" | "notice", message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(kind, message);
  return `${base}?${params.toString()}`;
}

/** Absolute public link on the org host, e.g. https://acme.pubcommand.com/l/launch. */
export function orgPublicUrl(requestHost: string, orgSlug: string, pathname: string): string {
  return buildSiteUrl({ rootDomain: rootDomain(), requestHost, site: { kind: "org", slug: orgSlug }, pathname });
}
