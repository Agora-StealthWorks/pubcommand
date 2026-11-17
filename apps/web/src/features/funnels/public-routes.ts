import { tenantDb } from "@pubcommand/db";
import { isValidEmail, captureOptin, consentText } from "../../../../../modules/funnels/sms";
import { ensureStart, recordWatch, rememberKey } from "../../../../../modules/funnels/viewer";
import { emailConsent, funnelBranding } from "./data";
import {
  clientIp,
  hashIp,
  loadPublicFunnel,
  loadPublicSite,
  looksLikeBot,
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
  let body: { kind?: unknown; dayId?: unknown; percent?: unknown; key?: unknown };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false }, 400);
  }
  const kind = body.kind === "watch" || body.kind === "cta" ? body.kind : "view";
  const dayId = typeof body.dayId === "string" && UUID.test(body.dayId) ? body.dayId : null;
  const day = dayId ? loaded.days.find((item) => item.id === dayId) ?? null : null;
  if (dayId && !day) return json({ ok: false }, 404);
  const { funnel, now } = loaded;
  let viewer = ensureStart(startViewer(await readViewer(funnel.id, false)), now);
  const db = tenantDb(loaded.organizationId);
  const bot = looksLikeBot(request.headers.get("user-agent"));
  let unlocked = false;

  if (kind === "view") {
    const key = typeof body.key === "string" ? body.key.slice(0, 40) : "";
    if (day && key && funnel.progression === "url_key" && key === day.unlockKey) {
      viewer = rememberKey(viewer, day.id);
      unlocked = true;
    }
    if (!bot) {
      const recent = await db.funnelEvent.count({ where: { funnelId: funnel.id, dayId, visitorId: viewer.visitorId, kind: "view", createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
      if (!recent) await db.funnelEvent.create({ data: { organizationId: loaded.organizationId, funnelId: funnel.id, dayId, kind: "view", visitorId: viewer.visitorId } });
    }
  } else if (kind === "watch") {
    const percent = Number(body.percent);
    if (!day || !Number.isFinite(percent)) return json({ ok: false }, 400);
    const index = loaded.days.findIndex((item) => item.id === day.id);
    const state = statesFor(loaded, viewer)[index];
    // Only a day that is actually open with its video can be "watched".
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
  } else if (!bot) {
    await db.funnelEvent.create({ data: { organizationId: loaded.organizationId, funnelId: funnel.id, dayId, kind: "cta", visitorId: viewer.visitorId } });
  }

  const cookie = viewerCookieHeader(funnel.id, viewer, isSecure(request));
  return json({ ok: true, unlocked }, 200, cookie ? { "set-cookie": cookie } : {});
}

/** POST /l/<funnel>/optin: waitlist email capture. Stores the consent sentence shown. */
export async function handleFunnelOptin(request: Request, orgSlug: string, funnelSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug)) || !sameOrigin(request)) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicFunnel(orgSlug, funnelSlug);
  if (!loaded || loaded.funnel.optinMode !== "email") return new Response("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const back = safeBack(form.get("back"), "/");
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
        },
      })
      .catch(() => undefined);
  }
  return seeOther(withQuery(back, { joined: "1" }));
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

/** POST /t/<site>/subscribe/submit: phone + consent checkbox, with the exact consent text stored. */
export async function handleSubscribe(request: Request, orgSlug: string, siteSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug)) || !sameOrigin(request)) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicSite(orgSlug, siteSlug);
  if (!loaded) return new Response("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const back = safeBack(form.get("back"), "/subscribe");
  const current = consentText(loaded.site);
  const result = captureOptin(
    {
      phone: String(form.get("phone") ?? ""),
      consentChecked: form.get("consent") === "yes",
      shownConsent: String(form.get("consentShown") ?? ""),
      honeypot: String(form.get("website") ?? ""),
    },
    current,
  );
  if (!result.ok) return seeOther(withQuery(back, result.spam ? { done: "1" } : { error: result.error }));
  if (loaded.preview) return seeOther(withQuery(back, { done: "1" }));
  const db = tenantDb(loaded.organizationId);
  const ipHash = hashIp(clientIp(request.headers));
  if (ipHash) {
    const recent = await db.textOptin.count({ where: { siteId: loaded.site.id, ipHash, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 10) return seeOther(withQuery(back, { error: "Too many sign-ups from this connection. Try again later." }));
  }
  await db.textOptin.create({
    data: {
      organizationId: loaded.organizationId,
      siteId: loaded.site.id,
      phone: result.record.phone,
      consentText: result.record.consentText,
      ipHash,
      pageUrl: (request.headers.get("referer") ?? "").slice(0, 500) || null,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    },
  });
  return seeOther(withQuery(back, { done: "1" }));
}

export async function siteLogo(orgSlug: string, siteSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug))) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicSite(orgSlug, siteSlug, { preview: "1" });
  const id = loaded?.site.logoAssetId;
  const asset = loaded && id ? await tenantDb(loaded.organizationId).funnelAsset.findFirst({ where: { id, ownerId: loaded.site.id } }) : null;
  return asset ? imageResponse(asset) : new Response("Not found", { status: 404 });
}
