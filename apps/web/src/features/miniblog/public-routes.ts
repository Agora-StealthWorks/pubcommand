import { tenantDb } from "@pubcommand/db";
import { captureEmailOptin, emailConsentText } from "../../../../../modules/miniblog/sms";
import { subscribeKind } from "../../../../../modules/miniblog/mediums";
import { clientIp, hashIp, loadPublicSite, publicSiteMatches, safeBack, sameOrigin } from "./public";

/** 303 back to a page on the same host (relative Location, so custom domains keep working). */
function seeOther(location: string) {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/**
 * POST /b/<site>/subscribe/submit (or /t/…): an EMAIL sign-up + consent checkbox,
 * with the exact consent text stored. Every other medium 404s: no SMS sign-up.
 */
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
  if (subscribeKind(loaded.site.medium) !== "email") return new Response("Not found", { status: 404 });
  const result = captureEmailOptin(
    { email: String(form.get("email") ?? ""), consentChecked: form.get("consent") === "yes", shownConsent: String(form.get("consentShown") ?? ""), honeypot: String(form.get("website") ?? "") },
    emailConsentText(loaded.site),
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
      channel: "email",
      email: result.record.email,
      consentText: result.record.consentText,
      ipHash,
      pageUrl: (request.headers.get("referer") ?? "").slice(0, 500) || null,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    },
  });
  return seeOther(withQuery(back, { done: "1" }));
}

/** The uploaded logo. Public by nature; only the logo attached to this site is served. */
export async function siteLogo(orgSlug: string, siteSlug: string): Promise<Response> {
  if (!(await publicSiteMatches(orgSlug))) return new Response("Not found", { status: 404 });
  const loaded = await loadPublicSite(orgSlug, siteSlug, { preview: "1", assets: true });
  const id = loaded?.site.logoAssetId;
  const asset = loaded && id ? await tenantDb(loaded.organizationId).funnelAsset.findFirst({ where: { id, ownerId: loaded.site.id } }) : null;
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(asset.data), {
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(asset.size),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
