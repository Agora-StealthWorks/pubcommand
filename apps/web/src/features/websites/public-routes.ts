import { tenantDb } from "@pubcommand/db";
import { cookies } from "next/headers";
import { getImage } from "@/features/pubsetup/read";
import { exposeMagicLinkOnPage } from "@/lib/mail";
import { currentRequest } from "@/lib/request";
import { logoFor } from "../../../../../modules/pubsetup/logos";
import { normalizeEmail, safeReturnPath } from "../../../../../modules/websites/content";
import { UUID_RE } from "./guard";
import { endSession, memberCookieName, redeemSignInToken, sendMemberSignInLink } from "./members";
import { clientIp, hashIp, loadSite, sameOrigin } from "./public";

function seeOther(location: string) {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

function withQuery(path: string, params: Record<string, string>): string {
  const [beforeHash, hash] = path.split("#");
  const query = new URLSearchParams(params).toString();
  return `${beforeHash}${beforeHash!.includes("?") ? "&" : "?"}${query}${hash ? `#${hash}` : ""}`;
}

const notFound = () => new Response("Not found", { status: 404 });

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** Cookie options: this host only, httpOnly, secure outside localhost. */
async function cookieOptions(maxAge: number) {
  const { origin } = await currentRequest();
  return { httpOnly: true, sameSite: "lax" as const, secure: origin.startsWith("https://"), path: "/", maxAge };
}

/** POST /subscribe: free newsletter sign-up (one or more publications). Creates a free member account too. */
export async function handleSubscribe(request: Request, orgSlug: string, siteSlug: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded || !sameOrigin(request)) return notFound();
  const form = await readForm(request);
  if (!form) return new Response("Bad request", { status: 400 });
  const home = loaded.base || "/";
  const back = safeReturnPath(form.get("back"), home);
  if (String(form.get("website") ?? "")) return seeOther(withQuery(back, { signup: "subscribed" })); // honeypot
  const email = normalizeEmail(form.get("email"));
  if (!email) return seeOther(withQuery(back, { signup: "invalid" }));
  const wanted = new Set(form.getAll("publicationId").map(String));
  const pubs = loaded.free.filter((pub) => wanted.has(pub.id));
  if (pubs.length === 0) return seeOther(withQuery(back, { signup: "invalid" }));
  if (loaded.site.status !== "live") return seeOther(withQuery(back, { signup: "subscribed" })); // staff preview: record nothing
  const db = tenantDb(loaded.organizationId);
  const ipHash = hashIp(clientIp(request.headers));
  if (ipHash) {
    const recent = await db.webSignup.count({ where: { siteId: loaded.site.id, ipHash, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 12) return seeOther(withQuery(back, { signup: "limited" }));
  }
  const existing = await db.webMember.findFirst({ where: { siteId: loaded.site.id, email }, select: { id: true } });
  const member = existing ?? (await db.webMember.create({ data: { organizationId: loaded.organizationId, siteId: loaded.site.id, email }, select: { id: true } }));
  const source = (request.headers.get("referer") ?? "").slice(0, 500);
  for (const pub of pubs) {
    const found = await db.webSignup.findFirst({ where: { siteId: loaded.site.id, email, publicationId: pub.id }, select: { id: true } });
    if (found) await db.webSignup.updateMany({ where: { id: found.id }, data: { status: "subscribed", memberId: member.id } });
    else await db.webSignup.create({ data: { organizationId: loaded.organizationId, siteId: loaded.site.id, memberId: member.id, email, publicationId: pub.id, source, ipHash } });
  }
  return seeOther(withQuery(back, { signup: "subscribed" }));
}

/** POST /sign-in/submit: email a one-time link. Always answers the same way, so it never reveals who is a member. */
export async function handleSignInRequest(request: Request, orgSlug: string, siteSlug: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded || !sameOrigin(request)) return notFound();
  const form = await readForm(request);
  if (!form) return new Response("Bad request", { status: 400 });
  const page = `${loaded.base}/sign-in`;
  const next = safeReturnPath(form.get("next"), `${loaded.base}/my`);
  const email = normalizeEmail(form.get("email"));
  if (!email) return seeOther(withQuery(page, { error: "email", next }));
  const db = tenantDb(loaded.organizationId);
  const ipHash = hashIp(clientIp(request.headers));
  const member = await db.webMember.findFirst({ where: { siteId: loaded.site.id, email, status: "active" } });
  const params: Record<string, string> = { sent: "1" };
  if (member) {
    const recent = await db.webMemberToken.count({ where: { memberId: member.id, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
    if (recent < 5) {
      const { origin } = await currentRequest();
      const result = await sendMemberSignInLink({ organizationId: loaded.organizationId, orgSlug, site: loaded.site, member, origin, returnTo: next });
      if (exposeMagicLinkOnPage()) params.dev = result.link;
    }
  }
  void ipHash;
  return seeOther(withQuery(page, params));
}

/** GET /sign-in/verify?token=…: open a session and go to the members area (or where the reader was). */
export async function handleSignInVerify(request: Request, orgSlug: string, siteSlug: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded) return notFound();
  const url = new URL(request.url);
  const opened = await redeemSignInToken(loaded.organizationId, loaded.site.id, url.searchParams.get("token") ?? "");
  if (!opened) return seeOther(withQuery(`${loaded.base}/sign-in`, { error: "expired" }));
  (await cookies()).set(opened.cookie, opened.value, await cookieOptions(opened.maxAge));
  return seeOther(safeReturnPath(url.searchParams.get("next"), `${loaded.base}/my`));
}

/** POST /sign-out */
export async function handleSignOut(request: Request, orgSlug: string, siteSlug: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded || !sameOrigin(request)) return notFound();
  const jar = await cookies();
  const name = memberCookieName(loaded.site.id);
  await endSession(loaded.organizationId, loaded.site.id, jar.get(name)?.value);
  jar.set(name, "", await cookieOptions(0));
  return seeOther(loaded.base || "/");
}

function imageResponse(data: Uint8Array, mime: string, maxAge: number): Response {
  return new Response(Buffer.from(data), {
    headers: {
      "content-type": mime,
      "content-length": String(data.byteLength),
      "cache-control": `public, max-age=${maxAge}${maxAge > 86400 ? ", immutable" : ""}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

/** GET /media/<id>: a media-library file. Ids never change content, so it is cached for a year. */
export async function serveMedia(orgSlug: string, siteSlug: string, assetId: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded || !UUID_RE.test(assetId)) return notFound();
  const asset = await tenantDb(loaded.organizationId).webAsset.findFirst({ where: { id: assetId, siteId: loaded.site.id } });
  if (!asset) return notFound();
  const response = imageResponse(asset.data, asset.mimeType, 31_536_000);
  if (asset.mimeType === "application/pdf") {
    // Browsers' PDF viewers do not run under a sandbox CSP.
    response.headers.delete("content-security-policy");
    response.headers.set("content-disposition", `inline; filename="${asset.filename.replace(/[^\w.-]+/g, "_")}"`);
  }
  return response;
}

/** GET /logo?bg=dark|light: the site's own logo, else the brand logo from Publication Setup. */
export async function serveLogo(request: Request, orgSlug: string, siteSlug: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded) return notFound();
  const bg = new URL(request.url).searchParams.get("bg") === "light" ? "light" : "dark";
  const { site } = loaded;
  const own = bg === "light" ? (site.logoLightAssetId ?? site.logoAssetId) : (site.logoAssetId ?? site.logoLightAssetId);
  if (own) {
    const asset = await tenantDb(loaded.organizationId).webAsset.findFirst({ where: { id: own, siteId: site.id } });
    if (asset) return imageResponse(asset.data, asset.mimeType, 3600);
  }
  const choice = logoFor(null, bg, { id: site.brandId, logos: loaded.brandLogo });
  const image = choice ? await getImage(loaded.organizationId, choice.kind, site.brandId, site.brandId) : null;
  return image ? imageResponse(image.data, image.mime, 3600) : notFound();
}

/** GET /pub-logo/<id>?bg=dark|light: a publication's logo from Publication Setup. */
export async function servePubLogo(request: Request, orgSlug: string, siteSlug: string, pubId: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  const pub = loaded?.publications.find((item) => item.id === pubId);
  if (!loaded || !pub) return notFound();
  const bg = new URL(request.url).searchParams.get("bg") === "light" ? "light" : "dark";
  const choice = logoFor(pub, bg);
  const image = choice ? await getImage(loaded.organizationId, choice.kind, pub.id, loaded.site.brandId) : null;
  return image ? imageResponse(image.data, image.mime, 3600) : notFound();
}

/** GET /editor-photo/<id> */
export async function serveEditorPhoto(orgSlug: string, siteSlug: string, editorId: string): Promise<Response> {
  const loaded = await loadSite(orgSlug, siteSlug);
  const editor = loaded?.editors.find((item) => item.id === editorId);
  if (!loaded || !editor?.hasPhoto) return notFound();
  const image = await getImage(loaded.organizationId, "editor-photo", editor.id, loaded.site.brandId);
  return image ? imageResponse(image.data, image.mime, 3600) : notFound();
}
