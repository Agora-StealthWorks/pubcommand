import { tenantDb } from "@pubcommand/db";
import { verifyUnsubscribeToken } from "../../../../../modules/funnels/emails";
import { captureSmsOptin, isValidEmail } from "../../../../../modules/funnels/sms";
import { classifyTraffic, clientIpOf, deviceOf, isClickKind, isPageKind } from "../../../../../modules/funnels/traffic";
import { ensureStart, recordWatch, rememberKey, rememberParams } from "../../../../../modules/funnels/viewer";
import { attributedParams, paramsFromUrl } from "../../../../../modules/funnels/tracking";
import { loadFunnelsSettings } from "./tracking-data";
import { eventBoxEvent, icsFile } from "../../../../../modules/funnels/calendar";
import { sessionEvent, upcomingSessions } from "./calendar-view";
import { effectiveStart, keyUnlocks } from "../../../../../modules/funnels/state";
import { emailConsent, funnelBranding, funnelRules } from "./data";
import { unsubscribeOptin, unsubscribeSecret } from "./emails";
import { acceptsEmailOptin, homeBlocks } from "./site-data";
import {
  clientIp,
  hashIp,
  loadPublicFunnel,
  publicSiteMatches,
  readViewer,
  safeBack,
  sameOrigin,
  startViewer,
  statesFor,
  viewerCookieHeader,
} from "./public";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function isSecure(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto ? proto === "https" : new URL(request.url).protocol === "https:";
}

/** 303 back to a page on the same host (relative Location, so custom domains keep working). */
function seeOther(location: string) {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** POST /l/<funnel>/sync. The server re-checks every claim against the state engine. */
export async function handleViewerSync(request: Request, orgSlug: string, funnelSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug)) || !sameOrigin(request)) return json({ ok: false }, 404);
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug);
  if (!loaded) return json({ ok: false }, 404);
  if (loaded.preview) return json({ ok: true, preview: true });
  const raw = await request.text();
  if (raw.length > 2000) return json({ ok: false }, 413);
  let body: { kind?: unknown; dayId?: unknown; percent?: unknown; key?: unknown; wd?: unknown; page?: unknown; target?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false }, 400);
  }
  const kind = typeof body.kind === "string" && (body.kind === "view" || body.kind === "watch" || isClickKind(body.kind)) ? body.kind : null;
  if (!kind) return json({ ok: false }, 400);
  const page = isPageKind(body.page) ? body.page : null;
  // dayId is a module id, or on a custom page that page's id.
  const rawId = typeof body.dayId === "string" && UUID.test(body.dayId) ? body.dayId : null;
  const day = rawId ? loaded.days.find((item) => item.id === rawId) ?? null : null;
  const pageItem = rawId && !day && page === "custom" ? loaded.navItems.find((item) => item.id === rawId) ?? null : null;
  if (rawId && !day && !pageItem) return json({ ok: false }, 404);
  const dayId = day?.id ?? pageItem?.id ?? null;
  const target = typeof body.target === "string" ? body.target.replace(/[\u0000-\u001f]/g, " ").slice(0, 600) : null;
  const { funnel, now } = loaded;
  let viewer = ensureStart(startViewer(await readViewer(funnel.id, false)), now);
  // Tracked URL parameters (org Funnels settings): read from the page address this call came from
  // (its Referer), kept in the viewer cookie by first/last touch, and recorded on every event.
  const tracking = await loadFunnelsSettings(loaded.organizationId);
  const incoming = paramsFromUrl(request.headers.get("referer"), tracking.trackedParams);
  viewer = rememberParams(viewer, incoming, tracking.attribution);
  const params = attributedParams(viewer.params, undefined, tracking.trackedParams, tracking.attribution);
  const db = tenantDb(loaded.organizationId);
  // Flag (never drop) automated traffic: bot user agents, cloud / data-center networks, automated browsers.
  const userAgent = request.headers.get("user-agent");
  const botReason = classifyTraffic({ userAgent, ip: clientIpOf(request.headers), webdriver: body.wd === true });
  const bot = botReason !== null;
  const device = deviceOf(userAgent, request.headers.get("sec-ch-ua-mobile"));
  let unlocked = false;

  if (kind === "view") {
    const key = typeof body.key === "string" ? body.key.slice(0, 40) : "";
    if (day && key && keyUnlocks(funnel) && key === day.unlockKey) {
      viewer = rememberKey(viewer, day.id);
      unlocked = true;
    }
    const recent = await db.funnelEvent.count({ where: { funnelId: funnel.id, dayId, page, visitorId: viewer.visitorId, kind: "view", createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
    if (!recent) await db.funnelEvent.create({ data: { organizationId: loaded.organizationId, funnelId: funnel.id, dayId, page, device, kind: "view", visitorId: viewer.visitorId, botReason, ...(params ? { params } : {}) } });
  } else if (kind === "watch") {
    const percent = Number(body.percent);
    if (!day || !Number.isFinite(percent)) return json({ ok: false }, 400);
    const index = loaded.days.findIndex((item) => item.id === day.id);
    const state = statesFor(loaded, viewer)[index];
    // Only a module that is actually open with its content can be "watched" (every provider, and text modules).
    if (state?.kind !== "video") return json({ ok: false, error: "locked" }, 409);
    viewer = recordWatch(viewer, day.id, percent);
    const value = viewer.watched[day.id] ?? 0;
    if (!bot) {
      const existing = await db.funnelWatch.findFirst({ where: { funnelId: funnel.id, dayId: day.id, visitorId: viewer.visitorId } });
      if (existing) {
        if (value > existing.percent) await db.funnelWatch.updateMany({ where: { id: existing.id }, data: { percent: value } });
      } else {
        await db.funnelWatch.create({ data: { organizationId: loaded.organizationId, funnelId: funnel.id, dayId: day.id, visitorId: viewer.visitorId, percent: value } }).catch(() => undefined);
      }
    }
  } else {
    // A click. Bursts from one visitor are capped so a script cannot flood the table.
    const recent = await db.funnelEvent.count({ where: { funnelId: funnel.id, visitorId: viewer.visitorId, createdAt: { gte: new Date(now.getTime() - 10 * 60_000) } } });
    if (recent < 150) await db.funnelEvent.create({ data: { organizationId: loaded.organizationId, funnelId: funnel.id, dayId, page, device, kind, target, visitorId: viewer.visitorId, botReason, ...(params ? { params } : {}) } });
  }

  const cookie = viewerCookieHeader(funnel.id, viewer, isSecure(request));
  return json({ ok: true, unlocked }, 200, cookie ? { "set-cookie": cookie } : {});
}

/** POST /l/<funnel>/optin: waitlist email capture. Stores the consent sentence shown. */
export async function handleFunnelOptin(request: Request, orgSlug: string, funnelSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug)) || !sameOrigin(request)) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug);
  if (!loaded || !acceptsEmailOptin(loaded.funnel, loaded.navItems)) return new Response("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const back = safeBack(form.get("back"), "/").replace(/#.*$/, "");
  if (String(form.get("website") ?? "").trim()) return seeOther(withQuery(back, { joined: "1" }));
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  if (!isValidEmail(email)) return seeOther(withQuery(back, { error: "Enter a valid email address." }));
  if (loaded.preview) return seeOther(withQuery(back, { joined: "1" }));
  const db = tenantDb(loaded.organizationId);
  const ipHash = hashIp(clientIp(request.headers));
  if (ipHash) {
    const recent = await db.funnelOptin.count({ where: { funnelId: loaded.funnel.id, ipHash, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 10) return seeOther(withQuery(back, { error: "Too many sign-ups from this connection. Try again later." }));
  }
  const branding = await funnelBranding(loaded.organizationId, loaded.funnel, "");
  const params = await requestParams(request, loaded.organizationId, loaded.funnel.id);
  const existing = await db.funnelOptin.findFirst({ where: { funnelId: loaded.funnel.id, email }, select: { id: true } });
  if (!existing) {
    await db.funnelOptin
      .create({
        data: {
          organizationId: loaded.organizationId,
          funnelId: loaded.funnel.id,
          email,
          consentText: emailConsent(loaded.funnel, branding),
          ipHash,
          pageUrl: (request.headers.get("referer") ?? "").slice(0, 500) || null,
          ...(params ? { params } : {}),
        },
      })
      .catch(() => null);
  }
  return seeOther(withQuery(back, { joined: "1" }));
}

/** An opt-in's tracked URL parameters: the visitor's cookie set merged with the form page's address (Referer). */
async function requestParams(request: Request, organizationId: string, funnelId: string) {
  const tracking = await loadFunnelsSettings(organizationId);
  if (!tracking.trackedParams.length) return undefined;
  const viewer = await readViewer(funnelId, false);
  return attributedParams(viewer?.params, paramsFromUrl(request.headers.get("referer"), tracking.trackedParams), tracking.trackedParams, tracking.attribution);
}

function imageResponse(file: { data: Uint8Array; mimeType: string; size: number }) {
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.size),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}

/**
 * Logo (dayId null) or a day's uploaded thumbnail. These are public by nature;
 * only images attached to this funnel are served.
 */
export async function funnelImage(orgSlug: string, funnelSlug: string, dayId: string | null): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug))) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug, { preview: "1" });
  if (!loaded) return new Response("Not found", { status: 404 });
  const db = tenantDb(loaded.organizationId);
  const { funnel } = loaded;
  if (dayId === null) {
    if (funnel.formThemeId) {
      const theme = await db.formTheme.findFirst({ where: { id: funnel.formThemeId, brandId: funnel.brandId, deletedAt: null }, select: { logoFileId: true } });
      const file = theme?.logoFileId ? await db.formFile.findFirst({ where: { id: theme.logoFileId, kind: "logo" } }) : null;
      return file ? imageResponse(file) : new Response("Not found", { status: 404 });
    }
    const asset = funnel.logoAssetId ? await db.funnelAsset.findFirst({ where: { id: funnel.logoAssetId, ownerId: funnel.id } }) : null;
    return asset ? imageResponse(asset) : new Response("Not found", { status: 404 });
  }
  const day = loaded.days.find((item) => item.id === dayId);
  const asset = day?.thumbAssetId ? await db.funnelAsset.findFirst({ where: { id: day.thumbAssetId, ownerId: funnel.id } }) : null;
  return asset ? imageResponse(asset) : new Response("Not found", { status: 404 });
}

/**
 * GET /l/<funnel>/asset/<id>: an image the funnel owns (header or page image,
 * footer logo, host photo, block or page image, nav thumbnail). These are public
 * by nature. Drafts are served only to previewers.
 */
export async function funnelAsset(orgSlug: string, funnelSlug: string, assetId: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug)) || !UUID.test(assetId)) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug, { preview: "1" });
  if (!loaded) return new Response("Not found", { status: 404 });
  const asset = await tenantDb(loaded.organizationId).funnelAsset.findFirst({ where: { id: assetId, ownerId: loaded.funnel.id } });
  return asset ? imageResponse(asset) : new Response("Not found", { status: 404 });
}

function icsResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "event"}.ics"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** GET /l/<funnel>/ics?day=<id> (a live session) or ?block=<id> (a home page event box): the .ics invite. */
export async function funnelIcs(request: Request, orgSlug: string, funnelSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug))) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug, { preview: url.searchParams.get("preview") ?? undefined });
  if (!loaded) return new Response("Not found", { status: 404 });
  const { funnel, timeZone } = loaded;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || "localhost";
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const rules = funnelRules(funnel);
  const dayId = url.searchParams.get("day") ?? "";
  const blockId = url.searchParams.get("block") ?? "";
  if (url.searchParams.get("series") === "1") {
    if (rules.mode !== "live") return new Response("Not found", { status: 404 });
    const events = upcomingSessions(loaded).map((day) => sessionEvent(loaded, day, origin)).filter((event) => event !== null);
    return events.length ? icsResponse(icsFile(events, { timeZone, calendarName: funnel.name, domain: host }), `${funnel.slug}-sessions`) : new Response("Not found", { status: 404 });
  }
  if (dayId) {
    const day = UUID.test(dayId) ? loaded.days.find((item) => item.id === dayId) : undefined;
    if (!day || rules.mode !== "live" || !day.isLive) return new Response("Not found", { status: 404 });
    const event = sessionEvent(loaded, day, origin);
    return event ? icsResponse(icsFile([event], { timeZone, calendarName: funnel.name, domain: host }), `${funnel.slug}-day-${day.position}`) : new Response("Not found", { status: 404 });
  }
  const block = homeBlocks(funnel).find((item) => item.id === blockId);
  if (!block || block.type !== "event") return new Response("Not found", { status: 404 });
  const viewer = await readViewer(funnel.id, false);
  const start = block.at ? new Date(block.at) : effectiveStart(rules, { watched: {}, keys: [], ...(viewer?.start ? { start: viewer.start } : {}) }, loaded.now);
  const event = eventBoxEvent({ funnelId: funnel.id, blockId: block.id, title: block.title || funnel.name, start, minutes: block.minutes, pageUrl: `${origin}/l/${funnel.slug}`, timeZone });
  return event ? icsResponse(icsFile([event], { timeZone, calendarName: funnel.name, domain: host }), funnel.slug) : new Response("Not found", { status: 404 });
}

/**
 * POST /l/<funnel>/sms: an SMS opt-in. The form must belong to this funnel and
 * be placed somewhere on it; the consent text must match the form's current
 * wording, and it is stored word for word. Nothing is texted (no provider yet).
 */
export async function handleSmsOptin(request: Request, orgSlug: string, funnelSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug)) || !sameOrigin(request)) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug);
  if (!loaded) return new Response("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const back = safeBack(form.get("back"), "/").replace(/#.*$/, "");
  const formId = String(form.get("formId") ?? "");
  const db = tenantDb(loaded.organizationId);
  const sms = UUID.test(formId) ? await db.funnelSmsForm.findFirst({ where: { id: formId, funnelId: loaded.funnel.id } }) : null;
  if (!sms) return new Response("Not found", { status: 404 });
  const result = captureSmsOptin(
    {
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      consentChecked: form.get("consent") === "yes",
      shownConsent: String(form.get("consentShown") ?? ""),
      honeypot: String(form.get("website") ?? ""),
    },
    sms,
  );
  if (!result.ok) return seeOther(withQuery(back, result.spam ? { sms_done: sms.id } : { sms_form: sms.id, sms_error: result.error }));
  if (loaded.preview) return seeOther(withQuery(back, { sms_done: sms.id }));
  const ipHash = hashIp(clientIp(request.headers));
  if (ipHash) {
    const recent = await db.funnelSmsOptin.count({ where: { funnelId: loaded.funnel.id, ipHash, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 10) return seeOther(withQuery(back, { sms_form: sms.id, sms_error: "Too many sign-ups from this connection. Try again later." }));
  }
  const params = await requestParams(request, loaded.organizationId, loaded.funnel.id);
  await db.funnelSmsOptin.create({
    data: {
      ...(params ? { params } : {}),
      organizationId: loaded.organizationId,
      funnelId: loaded.funnel.id,
      formId: sms.id,
      phone: result.phone,
      email: result.email,
      consentText: result.consentText,
      ipHash,
      pageUrl: (request.headers.get("referer") ?? "").slice(0, 500) || null,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    },
  });
  return seeOther(withQuery(back, { sms_done: sms.id }));
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f6f8;color:#1f2937}main{max-width:28rem;margin:12vh auto;padding:0 16px}div{background:#fff;border:1px solid #e1e4ea;border-radius:12px;padding:24px}h1{font-size:1.25rem;margin:0 0 .5rem}p{line-height:1.5}button{min-height:44px;padding:0 18px;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font-weight:600;font-size:1rem;cursor:pointer}</style></head><body><main><div>${body}</div></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * GET/POST /l/<funnel>/unsubscribe?o=<opt-in>&t=<token>. GET shows a confirm
 * button (link scanners open GET links, so they never unsubscribe anyone);
 * POST, or a mail client's one-click POST, unsubscribes. Signed links only.
 */
export async function handleUnsubscribe(request: Request, orgSlug: string, funnelSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug))) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug, { preview: "1" });
  if (!loaded) return new Response("Not found", { status: 404 });
  const name = esc(loaded.funnel.name);
  if (url.searchParams.get("test") === "1") return page("Unsubscribe", `<h1>Unsubscribe</h1><p>This is the unsubscribe link from a test email. Real emails carry a personal link here.</p>`);
  const optinId = url.searchParams.get("o") ?? "";
  const token = url.searchParams.get("t") ?? "";
  const secret = unsubscribeSecret();
  if (!UUID.test(optinId) || !verifyUnsubscribeToken(optinId, token, secret)) return page("Link not valid", `<h1>This link is not valid</h1><p>It may have been cut off. Use the unsubscribe link in your latest email from ${name}.</p>`, 404);
  if (request.method === "POST") {
    await unsubscribeOptin(loaded.organizationId, loaded.funnel.id, optinId);
    return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>You will not get any more emails about ${name}.</p>`);
  }
  const optin = await tenantDb(loaded.organizationId).funnelOptin.findFirst({ where: { id: optinId, funnelId: loaded.funnel.id }, select: { unsubscribedAt: true } });
  if (!optin) return page("Link not valid", `<h1>This link is not valid</h1>`, 404);
  if (optin.unsubscribedAt) return page("Unsubscribed", `<h1>You're already unsubscribed</h1><p>You will not get any more emails about ${name}.</p>`);
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from ${name}?</h1><p>You will stop getting emails about this event from this link.</p><form method="post" action="${esc(url.pathname + url.search)}"><button type="submit">Unsubscribe</button></form>`,
  );
}
