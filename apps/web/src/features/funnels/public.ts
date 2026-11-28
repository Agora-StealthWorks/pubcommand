import { can } from "@pubcommand/core";
import { PREVIEW_PARAM, currentPreviewToken, requestHasPreviewToken } from "@/lib/preview-token";
import { organizationHasModule, resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { resolveCustomHost } from "@/features/domains/resolve";
import { computeDayStates, type DayState, type ViewerFacts } from "../../../../../modules/funnels/state";
import { zonedLocalToUtc } from "../../../../../modules/funnels/time";
import { VIEWER_COOKIE_MAX_AGE, decodeViewer, emptyViewerCookie, encodeViewer, viewerCookieName, viewerSecret, type ViewerCookie } from "../../../../../modules/funnels/viewer";
import { dayRules, funnelRules, orgTimezone, type DayRow, type FunnelRow, type HostRow, type NavItemRow } from "./data";
import { applyDesignDraft, hasDraft } from "./site-data";
import type { SmsFormRow } from "./sms-data";

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
  const request = await currentRequest();
  const own = `/${prefix}/${slug}`;
  // A custom domain pointed at this funnel serves it at its root: links start at "/" (/day-2, /p/page).
  if (request.customDomain) {
    const resolved = await resolveCustomHost(request.customDomain).catch(() => null);
    if (resolved && resolved.targetPath.replace(/\/+$/, "") === own) return "";
  }
  const { pathname } = request;
  return pathname === own || pathname.startsWith(`${own}/`) ? own : "";
}

async function moduleEnabled(organizationId: string): Promise<boolean> {
  // Plan, staff override, org switch, suspended/deleted: decided in one place.
  return organizationHasModule(organizationId, "funnels");
}

/** A signed-in member who may see drafts and time-travel (funnels.read, or a delegate of this funnel). */
async function previewer(orgSlug: string, funnelId: string): Promise<boolean> {
  try {
    const ctx = await getOrgContext(orgSlug);
    if (ctx.kind !== "ok" || !ctx.subject.entitledModuleIds.includes("funnels")) return false;
    if (can(ctx.subject, "funnels.read", ctx.scope)) return true;
    return (await tenantDb(ctx.resolved.id).funnelDelegate.count({ where: { funnelId, userId: ctx.effectiveUserId } })) > 0;
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
  /** The funnel's SMS opt-in forms (placed on pages by id). */
  smsForms: SmsFormRow[];
};

export async function loadPublicFunnel(orgSlug: string, funnelSlug: string, options: PreviewOptions = {}): Promise<LoadedFunnel | null> {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(funnelSlug)) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await moduleEnabled(org.id))) return null;
  const db = tenantDb(org.id);
  const row = await db.funnel.findFirst({ where: { slug: funnelSlug, deletedAt: null } });
  if (!row) return null;
  const wantsPreview = options.preview === "1" || Boolean(options.as_of) || options.fresh === "1" || options.draft === "1" || row.status !== "published";
  // A signed preview link (lib/preview-token.ts) works on a custom domain, where the sign-in cookie is not sent.
  const preview = wantsPreview ? (await requestHasPreviewToken(org.id, `funnel:${row.id}`)) || (await previewer(orgSlug, row.id)) : false;
  if (row.status !== "published" && !preview) return null;
  const draft = preview && options.draft === "1";
  const funnel = draft ? applyDesignDraft(row) : row;
  const [days, hosts, navItems, timeZone, smsForms] = await Promise.all([
    db.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
    db.funnelHost.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
    db.funnelNavItem.findMany({ where: { funnelId: funnel.id }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    orgTimezone(org.id),
    db.funnelSmsForm.findMany({ where: { funnelId: funnel.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const asOf = preview && options.as_of ? zonedLocalToUtc(options.as_of, timeZone) : null;
  const params = new URLSearchParams();
  if (preview) {
    params.set("preview", "1");
    if (options.as_of && asOf) params.set("as_of", options.as_of);
    if (options.fresh === "1") params.set("fresh", "1");
    if (draft) params.set("draft", "1");
    // Keep the signed preview token on every page of the preview (custom domains).
    const token = await currentPreviewToken();
    if (token && (await requestHasPreviewToken(org.id, `funnel:${row.id}`))) params.set(PREVIEW_PARAM, token);
  }
  const draftShown = draft && (hasDraft(row.designDraft) || hasDraft(row.homeBlocksDraft));
  return { organizationId: org.id, orgSlug, funnel, days, hosts, navItems, timeZone, smsForms, draftShown, preview, now: asOf ?? new Date(), carry: preview ? `?${params.toString()}` : "" };
}

export async function readViewer(funnelId: string, fresh: boolean): Promise<ViewerCookie | null> {
  if (fresh) return null;
  const store = await cookies();
  return decodeViewer(store.get(viewerCookieName(funnelId))?.value, viewerSecret({ FUNNELS_COOKIE_SECRET: process.env.FUNNELS_COOKIE_SECRET, AUTH_SECRET: process.env.AUTH_SECRET }));
}

export function viewerFacts(viewer: ViewerCookie | null): ViewerFacts {
  return viewer ? { start: viewer.start, watched: viewer.watched, keys: viewer.keys } : { watched: {}, keys: [] };
}

/** The state-engine view of a loaded funnel (with the org time zone for "today"). */
export function rulesOf(loaded: Pick<LoadedFunnel, "funnel" | "timeZone">) {
  return funnelRules(loaded.funnel, loaded.timeZone);
}

export function dayRulesOf(loaded: Pick<LoadedFunnel, "funnel" | "days">) {
  return loaded.days.map((day) => dayRules(day, loaded.funnel.mode));
}

export function statesFor(loaded: LoadedFunnel, viewer: ViewerCookie | null, presentedKeys: Record<string, string> = {}): DayState[] {
  return computeDayStates(rulesOf(loaded), dayRulesOf(loaded), viewerFacts(viewer), loaded.now, presentedKeys);
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

/**
 * Day rows safe to hand to page components: unlock keys are never sent, and a
 * day that is not open with its video loses its video id and automatic
 * thumbnail (a YouTube thumbnail URL carries the id).
 */
export function publicDays(days: DayRow[], states: DayState[]): DayRow[] {
  return days.map((day, index) => {
    const open = states[index]?.kind === "video";
    // A Wistia poster address is a delivery hash, not the media id, so a locked module keeps its tile image
    // (as the old app did). YouTube's carries the id and Vidalytics has none: both are dropped.
    const keepThumb = day.videoProvider === "wistia" && day.videoThumbUrl && !day.videoThumbUrl.includes(day.videoId ?? "\u0000") ? day.videoThumbUrl : null;
    return { ...day, unlockKey: "", ...(open ? {} : { videoId: null, videoProvider: null, videoThumbUrl: keepThumb, videoTitle: null }) };
  });
}
