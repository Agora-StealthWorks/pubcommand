import { can } from "@pubcommand/core";
import { organizationHasModule, resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { publicBaseFor } from "../../../../../modules/miniblog/paths";
import { orgTimezone, type SiteRow } from "./data";

/** Is this request for the org the URL names? (Custom-domain requests resolve to their org.) */
export async function publicSiteMatches(orgSlug: string): Promise<boolean> {
  const request = await currentRequest();
  return request.site.kind === "org" && request.site.slug === orgSlug;
}

/** The link prefix for a public page: `/b/<site>`, `/t/<site>`, or "" on a custom domain. */
export async function publicBase(siteSlug: string): Promise<string> {
  const { pathname } = await currentRequest();
  return publicBaseFor(pathname, siteSlug);
}

async function moduleEnabled(organizationId: string): Promise<boolean> {
  // Plan, staff override, org switch, suspended/deleted: decided in one place.
  return organizationHasModule(organizationId, "miniblog");
}

/** A signed-in member who may see drafts (miniblog.read). */
async function previewer(orgSlug: string): Promise<boolean> {
  try {
    const ctx = await getOrgContext(orgSlug);
    return ctx.kind === "ok" && ctx.subject.entitledModuleIds.includes("miniblog") && can(ctx.subject, "miniblog.read", ctx.scope);
  } catch {
    return false;
  }
}

export type LoadedSite = { organizationId: string; site: SiteRow; brandName: string; timeZone: string; preview: boolean; now: Date };

export async function loadPublicSite(orgSlug: string, siteSlug: string, options: { preview?: string } = {}): Promise<LoadedSite | null> {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(siteSlug)) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await moduleEnabled(org.id))) return null;
  const db = tenantDb(org.id);
  const site = await db.textSite.findFirst({ where: { slug: siteSlug, deletedAt: null } });
  if (!site) return null;
  const preview = options.preview === "1" || site.status !== "live" ? await previewer(orgSlug) : false;
  if (site.status !== "live" && !preview) return null;
  const [brand, timeZone] = await Promise.all([db.brand.findFirst({ where: { id: site.brandId }, select: { name: true } }), orgTimezone(org.id)]);
  return { organizationId: org.id, site, brandName: brand?.name ?? site.name, timeZone, preview, now: new Date() };
}

export function looksLikeBot(userAgent: string | null): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|headless|monitor|curl|wget|python|axios/i.test(userAgent);
}

/** Record a page view (not for previews or obvious bots). Soft-fails. */
export async function recordSiteView(loaded: LoadedSite, postId: string | null): Promise<void> {
  if (loaded.preview) return;
  if (looksLikeBot((await headers()).get("user-agent"))) return;
  await tenantDb(loaded.organizationId)
    .textView.create({ data: { organizationId: loaded.organizationId, siteId: loaded.site.id, postId } })
    .catch((error: unknown) => console.warn("[miniblog] view not recorded", error));
}

/**
 * Salted IP hash for rate limits. The salt prefix stays "funnels:" (with the
 * FUNNELS_IP_SALT override) so hashes stored before the rename still match.
 */
export function hashIp(ip: string | null): string | null {
  const salt = process.env.FUNNELS_IP_SALT || process.env.AUTH_SECRET;
  if (!ip || !salt) return null;
  return createHash("sha256").update(`funnels:${salt}:${ip}`).digest("hex").slice(0, 40);
}

export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}

/** A safe same-site return path from a form ("/b/x/subscribe" or "/subscribe"). */
export function safeBack(value: FormDataEntryValue | null, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(text) ? text : fallback;
}
