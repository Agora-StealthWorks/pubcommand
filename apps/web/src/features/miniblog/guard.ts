import { buildSiteUrl, can } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { rootDomain } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export type MiniBlogPermission = "miniblog.read" | "miniblog.write" | "miniblog.publish";

/** Page/route guard: org, entitlement, permission and brand. Called by every page and route handler. */
export async function miniblogAccess(slug: string, permission: MiniBlogPermission = "miniblog.read") {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("miniblog")) return { kind: "denied" as const, title: "Mini-Blog is turned off for this organization" };
  if (!can(ctx.subject, "miniblog.read", ctx.scope) || !can(ctx.subject, permission, ctx.scope)) return { kind: "denied" as const, title: "You do not have access" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    canWrite: can(ctx.subject, "miniblog.write", ctx.scope),
    canPublish: can(ctx.subject, "miniblog.publish", ctx.scope),
  };
}

/** Server-action guard. Redirects with a message instead of throwing. */
export async function miniblogAction(back: string, ...permissions: MiniBlogPermission[]) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  const allowed = ctx.subject.entitledModuleIds.includes("miniblog") && ["miniblog.read", ...permissions].every((permission) => can(ctx.subject, permission, ctx.scope));
  if (!allowed) redirect(withMessage(back, "error", "You do not have permission to do that."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id, request };
}

/** For actions the editor calls from the browser: the same checks (miniblog.write), returning null instead of redirecting. */
export async function miniblogWriteCtx() {
  const request = await currentRequest();
  if (request.site.kind !== "org") return null;
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok" || !ctx.brand) return null;
  const allowed = ctx.subject.entitledModuleIds.includes("miniblog") && can(ctx.subject, "miniblog.read", ctx.scope) && can(ctx.subject, "miniblog.write", ctx.scope);
  return allowed ? { ...ctx, brand: ctx.brand } : null;
}

export type MiniBlogCtx = Awaited<ReturnType<typeof miniblogAction>>;

export function withMessage(path: string, kind: "error" | "notice", message: string): string {
  // Keep a #fragment at the end, where browsers read it (not inside the query).
  const [beforeHash, hash = ""] = path.split("#");
  const [base, query = ""] = (beforeHash ?? "").split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(kind, message);
  return `${base}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

/** Absolute public link on the org host, e.g. https://acme.pubcommand.com/b/alerts. */
export function orgPublicUrl(requestHost: string, orgSlug: string, pathname: string): string {
  return buildSiteUrl({ rootDomain: rootDomain(), requestHost, site: { kind: "org", slug: orgSlug }, pathname });
}
