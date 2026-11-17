import { can } from "@pubcommand/core";
import { resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { computeDayStates, type DayState, type ViewerFacts } from "../../../../../modules/funnels/state";
import { zonedLocalToUtc } from "../../../../../modules/funnels/time";
import { VIEWER_COOKIE_MAX_AGE, decodeViewer, emptyViewerCookie, encodeViewer, viewerCookieName, viewerSecret, type ViewerCookie } from "../../../../../modules/funnels/viewer";
import { dayRules, funnelRules, orgTimezone, type DayRow, type FunnelRow, type HostRow, type NavItemRow, type SiteRow } from "./data";
import { applyDesignDraft, hasDraft } from "./site-data";

/** Is this request for the org the URL names? (A custom-domain host will extend this check.) */
export async function publicSiteMatches(orgSlug: string): Promise<boolean> {
  const request = await currentRequest();
  return request.site.kind === "org" && request.site.slug === orgSlug;
}

/**
 * The path prefix links on a public page should use. On the org host the page is
 * at /l/<slug>/…, so links keep that prefix; when a custom domain maps its root
 * to /l/<slug>, the browser path has no prefix and links start at "/".
 */
export async function publicBase(prefix: "l" | "t", slug: string): Promise<string> {
  const { pathname } = await currentRequest();
  const own = `/${prefix}/${slug}`;
  return pathname === own || pathname.startsWith(`${own}/`) ? own : "";
}

async function moduleEnabled(organizationId: string): Promise<boolean> {
  const organization = await tenantDb(organizationId).organization.findUnique({
    where: { id: organizationId },
    include: { plan: { include: { modules: true } }, modules: true },
  });
  if (!organization || organization.suspendedAt) return false;
  const inPlan = organization.plan.modules.some((row) => row.moduleId === "funnels");
  const toggle = organization.modules.find((row) => row.moduleId === "funnels");
  return inPlan && (!toggle || toggle.enabled);
}

/** A signed-in member who may see drafts and time-travel (funnels.read). */
async function previewer(orgSlug: string): Promise<boolean> {
  try {
    const ctx = await getOrgContext(orgSlug);
    return ctx.kind === "ok" && ctx.subject.entitledModuleIds.includes("funnels") && can(ctx.subject, "funnels.read", ctx.scope);
  } catch {
    return false;
  }
}

/** draft=1: the builder's live preview shows the unsaved design and home page. */
export type PreviewOptions = { preview?: string; as_of?: string; fresh?: string; draft?: string };

export type LoadedFunnel = {
  organizationId: string;
  orgSlug: string;
  funnel: FunnelRow;
  days: DayRow[];
  hosts: HostRow[];
  navItems: NavItemRow[];
  timeZone: string;
  /** Admin preview: drafts visible, no stats, no cookie writes. */
  preview: boolean;
  now: Date;
  /** The builder's unsaved draft is shown (live preview). */
  draftShown: boolean;
  /** Query suffix to keep preview settings on internal links ("" for visitors). */
  carry: string;
};

export async function loadPublicFunnel(orgSlug: string, funnelSlug: string, options: PreviewOptions = {}): Promise<LoadedFunnel | null> {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(funnelSlug)) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await moduleEnabled(org.id))) return null;
  const db = tenantDb(org.id);
  const row = await db.funnel.findFirst({ where: { slug: funnelSlug, deletedAt: null } });
  if (!row) return null;
  const wantsPreview = options.preview === "1" || Boolean(options.as_of) || options.draft === "1" || row.status !== "published";
  const preview = wantsPreview ? await previewer(orgSlug) : false;
  if (row.status !== "published" && !preview) return null;
  const draft = preview && options.draft === "1";
  const funnel = draft ? applyDesignDraft(row) : row;
  const [days, hosts, navItems, timeZone] = await Promise.all([
    db.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
    db.funnelHost.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
    db.funnelNavItem.findMany({ where: { funnelId: funnel.id }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    orgTimezone(org.id),
  ]);
  const asOf = preview && options.as_of ? zonedLocalToUtc(options.as_of, timeZone) : null;
  const params = new URLSearchParams();
  if (preview) {
    params.set("preview", "1");
    if (options.as_of && asOf) params.set("as_of", options.as_of);
    if (options.fresh === "1") params.set("fresh", "1");
    if (draft) params.set("draft", "1");
  }
  const draftShown = draft && (hasDraft(row.designDraft) || hasDraft(row.homeBlocksDraft));
  return { organizationId: org.id, orgSlug, funnel, days, hosts, navItems, timeZone, draftShown, preview, now: asOf ?? new Date(), carry: preview ? `?${params.toString()}` : "" };
}

export async function readViewer(funnelId: string, fresh: boolean): Promise<ViewerCookie | null> {
  if (fresh) return null;
  const store = await cookies();
  return decodeViewer(store.get(viewerCookieName(funnelId))?.value, viewerSecret({ FUNNELS_COOKIE_SECRET: process.env.FUNNELS_COOKIE_SECRET, AUTH_SECRET: process.env.AUTH_SECRET }));
}

export function viewerFacts(viewer: ViewerCookie | null): ViewerFacts {
  return viewer ? { start: viewer.start, watched: viewer.watched, keys: viewer.keys } : { watched: {}, keys: [] };
}

export function statesFor(loaded: LoadedFunnel, viewer: ViewerCookie | null, presentedKeys: Record<string, string> = {}): DayState[] {
  return computeDayStates(funnelRules(loaded.funnel), loaded.days.map(dayRules), viewerFacts(viewer), loaded.now, presentedKeys);
}

export function newVisitorId(): string {
  return randomBytes(12).toString("base64url");
}

export function viewerCookieHeader(funnelId: string, viewer: ViewerCookie, secure: boolean): string | null {
  const secret = viewerSecret({ FUNNELS_COOKIE_SECRET: process.env.FUNNELS_COOKIE_SECRET, AUTH_SECRET: process.env.AUTH_SECRET });
  if (!secret) return null;
  const parts = [`${viewerCookieName(funnelId)}=${encodeViewer(viewer, secret)}`, "Path=/", `Max-Age=${VIEWER_COOKIE_MAX_AGE}`, "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function startViewer(existing: ViewerCookie | null): ViewerCookie {
  return existing ?? emptyViewerCookie(newVisitorId());
}

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

export function looksLikeBot(userAgent: string | null): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|headless|monitor|curl|wget|python|axios/i.test(userAgent);
}

/** A safe same-site return path from a form ("/t/x/subscribe" or "/subscribe"). */
export function safeBack(value: FormDataEntryValue | null, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(text) ? text : fallback;
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

/** Record a text-site page view (not for previews or obvious bots). Soft-fails. */
export async function recordSiteView(loaded: LoadedSite, postId: string | null): Promise<void> {
  if (loaded.preview) return;
  if (looksLikeBot((await headers()).get("user-agent"))) return;
  await tenantDb(loaded.organizationId)
    .textView.create({ data: { organizationId: loaded.organizationId, siteId: loaded.site.id, postId } })
    .catch((error: unknown) => console.warn("[funnels] view not recorded", error));
}

/**
 * Day rows safe to hand to page components: unlock keys are never sent, and a
 * day that is not open with its video loses its video id and automatic
 * thumbnail (a YouTube thumbnail URL carries the id).
 */
export function publicDays(days: DayRow[], states: DayState[]): DayRow[] {
  return days.map((day, index) => {
    const open = states[index]?.kind === "video";
    return { ...day, unlockKey: "", ...(open ? {} : { videoId: null, videoProvider: null, videoThumbUrl: null, videoTitle: null }) };
  });
}
