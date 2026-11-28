import { publicLinker } from "../domains/public-links";
import { buildSiteUrl, can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { rootDomain } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { canOpenFunnels, funnelAccess, type RoleAccess } from "../../../../../modules/funnels/delegates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = Extract<Awaited<ReturnType<typeof getOrgContext>>, { kind: "ok" }>;

function roleAccess(ctx: Ctx): RoleAccess {
  return { read: can(ctx.subject, "funnels.read", ctx.scope), write: can(ctx.subject, "funnels.write", ctx.scope), publish: can(ctx.subject, "funnels.publish", ctx.scope) };
}

/** Is the signed-in member (or the person being impersonated) a delegate of this funnel? */
async function isDelegate(ctx: Ctx, funnelId: string | undefined): Promise<boolean> {
  if (!funnelId || !UUID.test(funnelId)) return false;
  return (await tenantDb(ctx.resolved.id).funnelDelegate.count({ where: { funnelId, userId: ctx.effectiveUserId } })) > 0;
}

/** Funnel ids this member is a delegate of (for the list page). */
export async function delegatedFunnelIds(organizationId: string, userId: string): Promise<string[]> {
  const rows = await tenantDb(organizationId).funnelDelegate.findMany({ where: { userId }, select: { funnelId: true } });
  return rows.map((row) => row.funnelId);
}

export type FunnelsPermission = "funnels.read" | "funnels.write" | "funnels.publish";

/**
 * Page/route guard: org, entitlement, permission and brand. Called by every
 * page and route handler. With `funnelId`, a delegate of that funnel passes for
 * read and write (never publish). Without it, a member with no funnels.read
 * passes only if they are a delegate of some funnel (`delegateOnly`).
 */
export async function funnelsAccess(slug: string, permission: FunnelsPermission = "funnels.read", funnelId?: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return { kind: "missing" as const };
  if (!ctx.subject.entitledModuleIds.includes("funnels")) return { kind: "denied" as const, title: "Funnels is turned off for this organization" };
  if (!ctx.brand) return { kind: "denied" as const, title: "Add a brand in Settings → Brands first" };
  const role = roleAccess(ctx);
  const access = funnelAccess(role, await isDelegate(ctx, funnelId));
  let delegateOnly = false;
  if (!access.read) {
    const delegated = funnelId ? [] : await delegatedFunnelIds(ctx.resolved.id, ctx.effectiveUserId);
    if (!canOpenFunnels(role, delegated.length)) return { kind: "denied" as const, title: "You do not have access" };
    delegateOnly = true;
  }
  const allowed = permission === "funnels.read" ? access.read || delegateOnly : permission === "funnels.write" ? access.write : access.publish;
  if (!allowed) return { kind: "denied" as const, title: "You do not have access" };
  return {
    kind: "ok" as const,
    ctx: { ...ctx, brand: ctx.brand },
    canRead: role.read,
    canWrite: access.write,
    canPublish: access.publish,
    /** Editing this funnel only because they were made a delegate. */
    delegate: access.delegate,
    /** No funnels.read: the list shows only their delegated funnels. */
    delegateOnly,
  };
}

/** Server-action guard. Redirects with a message instead of throwing. Role permissions only (no delegates). */
export async function funnelsAction(back: string, ...permissions: FunnelsPermission[]) {
  return funnelAction(back, undefined, ...permissions);
}

/**
 * Server-action guard for one funnel: a delegate of `funnelId` passes for
 * read and write, never publish. The action must still load the funnel
 * itself (brand and deletion checks).
 */
export async function funnelAction(back: string, funnelId: string | undefined, ...permissions: FunnelsPermission[]) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  const access = funnelAccess(roleAccess(ctx), ctx.subject.entitledModuleIds.includes("funnels") ? await isDelegate(ctx, funnelId) : false);
  const allowed = ctx.subject.entitledModuleIds.includes("funnels") && access.read && permissions.every((permission) => (permission === "funnels.read" ? access.read : permission === "funnels.write" ? access.write : access.publish));
  if (!allowed) redirect(withMessage(back, "error", "You do not have permission to do that."));
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id, request, delegate: access.delegate };
}

/** For actions the builder calls from the browser: the same checks, returning null instead of redirecting. */
export async function funnelWriteCtx(funnelId: string) {
  const request = await currentRequest();
  if (request.site.kind !== "org") return null;
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok" || !ctx.brand || !ctx.subject.entitledModuleIds.includes("funnels")) return null;
  const access = funnelAccess(roleAccess(ctx), await isDelegate(ctx, funnelId));
  if (!access.read || !access.write) return null;
  return { ...ctx, brand: ctx.brand, access };
}

export type FunnelsCtx = Awaited<ReturnType<typeof funnelsAction>>;

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

/** Absolute public link on the org host, e.g. https://acme.pubcommand.com/l/launch. */
export function orgPublicUrl(requestHost: string, orgSlug: string, pathname: string): string {
  return buildSiteUrl({ rootDomain: rootDomain(), requestHost, site: { kind: "org", slug: orgSlug }, pathname });
}

/** A link under a funnel's public address, keeping any query the address already has (local dev adds ?org=). */
export function publicLink(publicUrl: string, path = "", params: Record<string, string> = {}): string {
  try {
    const url = new URL(publicUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return `${publicUrl}${path}`;
  }
}

/** Hidden inputs for the query an address already carries (a GET form drops its action's query). */
export function actionQuery(publicUrl: string): [string, string][] {
  try {
    return [...new URL(publicUrl).searchParams.entries()];
  } catch {
    return [];
  }
}

/**
 * Links to one funnel's public pages for the builder: on its custom domain when
 * one is Active (Settings → Domains), on the organization's PubCommand address
 * only when there is none. Previews carry a signed token so they open on a
 * custom domain too, where the builder's sign-in cookie is not sent.
 */
export type FunnelLinks = {
  /** The funnel's public address. */
  root: string;
  /** A page of the funnel (`/day-2`, `/p/about`), with optional query params. */
  at: (path: string, params?: Record<string, string>) => string;
  /** A preview link to a page of the funnel (drafts and time travel work). */
  preview: (path?: string, params?: Record<string, string>) => string;
  /** Hidden fields a GET preview form needs (time travel): the preview flag and token. */
  previewFields: [string, string][];
  /** Where a GET preview form submits (the funnel's address without a query). */
  formAction: string;
};

export async function funnelLinks(input: { organizationId: string; orgSlug: string; requestHost: string; funnel: { id: string; slug: string } }): Promise<FunnelLinks> {
  const links = await publicLinker({ organizationId: input.organizationId, orgSlug: input.orgSlug, requestHost: input.requestHost });
  const base = `/l/${input.funnel.slug}`;
  const scope = `funnel:${input.funnel.id}`;
  const query = (params: Record<string, string>) => {
    const text = new URLSearchParams(params).toString();
    return text ? `?${text}` : "";
  };
  const previewUrl = links.preview(base, scope);
  const [formAction = previewUrl, previewQuery = ""] = previewUrl.split(/\?(.*)/s);
  return {
    root: links.url(base),
    at: (path, params = {}) => links.url(`${base}${path}${query(params)}`),
    preview: (path = "", params = {}) => links.preview(`${base}${path}`, scope, params),
    previewFields: [...new URLSearchParams(previewQuery).entries()],
    formAction,
  };
}
