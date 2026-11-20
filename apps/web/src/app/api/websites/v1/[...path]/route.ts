import { tenantDb, type Prisma } from "@pubcommand/db";
import { getEditors, getImage, getPublications } from "@/features/pubsetup/read";
import { authenticate, bodyForSite, cardJson, memberJson, minutes, siteJson, type ApiSite } from "@/features/websites/api";
import { CARD_SELECT } from "@/features/websites/public";
import { endSession, passwordSignIn, readMemberByToken, redeemSignInToken, sendMemberSignInLink, setMemberPassword } from "@/features/websites/members";
import { tickerQuotes } from "@/features/websites/ticker";
import { hashIp } from "@/features/websites/public";
import { isFreePublication } from "@/features/websites/data";
import { UUID_RE } from "@/features/websites/guard";
import { logoFor } from "../../../../../../../../modules/pubsetup/logos";
import { canRead, isLive, normalizeEmail, safeReturnPath, teaserHtml } from "../../../../../../../../modules/websites/content";

/**
 * Website API (v1) for a site that runs as its own app. Every call needs the site's
 * key (`Authorization: Bearer pcw_…`, made in Websites → Site settings). Reader
 * sessions travel in `x-member-session`. See modules/websites/README.md.
 */

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200, cache = "no-store") => Response.json(data, { status, headers: { "cache-control": cache } });
const notFound = () => json({ error: "not_found" }, 404);
const bad = (error: string) => json({ error }, 400);

function liveWhere(api: ApiSite, extra: Prisma.WebPostWhereInput = {}): Prisma.WebPostWhereInput {
  return { siteId: api.site.id, deletedAt: null, status: { in: ["published", "scheduled"] }, publishedAt: { lte: new Date() }, ...extra };
}

function memberToken(request: Request): string | null {
  return request.headers.get("x-member-session");
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = (await request.json()) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function image(data: Uint8Array, mime: string): Response {
  return new Response(Buffer.from(data), {
    headers: { "content-type": mime, "content-length": String(data.byteLength), "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}

async function getHandler(request: Request, api: ApiSite, path: string[]): Promise<Response> {
  const { organizationId, site } = api;
  const db = tenantDb(organizationId);
  const url = new URL(request.url);
  const [head, a, b] = path;

  if (head === "site" && path.length === 1) return json(await siteJson(api));

  if (head === "posts" && path.length === 1) {
    const where: Prisma.WebPostWhereInput = { kind: "post" };
    const pub = url.searchParams.get("publication");
    const pubs = url.searchParams.get("publications");
    if (pub && UUID_RE.test(pub)) where.publicationId = pub;
    if (pubs) where.publicationId = { in: pubs.split(",").filter((id) => UUID_RE.test(id)).slice(0, 50) };
    const term = url.searchParams.get("term");
    if (term && UUID_RE.test(term)) where.terms = { some: { termId: term } };
    const type = url.searchParams.get("type");
    if (type && /^[a-z]{2,20}$/.test(type)) where.contentType = type;
    const access = url.searchParams.get("access");
    if (access) where.access = { in: access.split(",").filter((item) => ["public", "free", "members"].includes(item)) };
    if (url.searchParams.get("featured") === "1") where.featured = true;
    const exclude = url.searchParams.get("exclude");
    if (exclude && UUID_RE.test(exclude)) where.id = { not: exclude };
    const take = Math.min(60, Math.max(1, Number(url.searchParams.get("take")) || 20));
    const skip = Math.min(10_000, Math.max(0, Number(url.searchParams.get("skip")) || 0));
    const full = liveWhere(api, where);
    const [posts, total] = await Promise.all([db.webPost.findMany({ where: full, orderBy: { publishedAt: "desc" }, take, skip, select: CARD_SELECT }), db.webPost.count({ where: full })]);
    return json({ posts: posts.map(cardJson), total });
  }

  if (head === "posts" && a && path.length === 2) {
    if (!/^[a-z0-9-]{1,80}$/.test(a)) return notFound();
    const post = await db.webPost.findFirst({ where: { siteId: site.id, slug: a, deletedAt: null } });
    if (!post || !isLive(post, new Date())) return notFound();
    const member = await readMemberByToken(organizationId, site.id, memberToken(request));
    const decision = canRead(post, member ? { signedIn: true, access: member.access } : { signedIn: false });
    const html = bodyForSite(post.bodyHtml, site.slug);
    const terms = await db.webPostTerm.findMany({ where: { postId: post.id }, select: { term: { select: { name: true, slug: true, kind: true } } } });
    return json({
      post: {
        ...cardJson({ ...post, terms }),
        kind: post.kind,
        seoTitle: post.seoTitle,
        seoDescription: post.seoDescription,
        minutes: minutes(post.bodyHtml),
        html: decision.allowed ? html : teaserHtml(html, post.teaserBlocks),
      },
      access: decision,
    });
  }

  if (head === "ticker" && path.length === 1) {
    if (!site.showTicker) return json({ quotes: [] });
    return json({ quotes: await tickerQuotes(site.tickerText) }, 200, "public, max-age=60");
  }

  if (head === "terms" && (a === "category" || a === "tag") && b && path.length === 3) {
    if (!/^[a-z0-9-]{1,80}$/.test(b)) return notFound();
    const term = await db.webTerm.findFirst({ where: { siteId: site.id, kind: a, slug: b }, select: { id: true, name: true, slug: true, kind: true, description: true } });
    return term ? json({ term }) : notFound();
  }

  if (head === "me" && path.length === 1) {
    const member = await readMemberByToken(organizationId, site.id, memberToken(request));
    if (!member) return json({ member: null });
    const [products, signups] = await Promise.all([
      db.webProduct.findMany({ where: { siteId: site.id }, select: { id: true, name: true } }),
      db.webSignup.findMany({ where: { siteId: site.id, email: member.email, status: "subscribed" }, select: { publicationId: true } }),
    ]);
    return json({ member: { ...memberJson(member, new Map(products.map((product) => [product.id, product.name]))), signups: signups.map((row) => row.publicationId) } });
  }

  // Images (proxied by the site under the same paths).
  if (head === "media" && a && UUID_RE.test(a)) {
    const asset = await db.webAsset.findFirst({ where: { id: a, siteId: site.id } });
    if (!asset) return notFound();
    const response = image(asset.data, asset.mimeType);
    if (asset.mimeType === "application/pdf") response.headers.set("content-disposition", `inline; filename="${asset.filename.replace(/[^\w.-]+/g, "_")}"`);
    return response;
  }
  if (head === "logo") {
    const bg = url.searchParams.get("bg") === "light" ? "light" : "dark";
    const own = bg === "light" ? (site.logoLightAssetId ?? site.logoAssetId) : (site.logoAssetId ?? site.logoLightAssetId);
    if (own) {
      const asset = await db.webAsset.findFirst({ where: { id: own, siteId: site.id } });
      if (asset) return image(asset.data, asset.mimeType);
    }
    const branding = await db.pubBrandBranding.findFirst({ where: { brandId: site.brandId }, select: { logoMime: true, logoOnDarkMime: true } });
    const choice = logoFor(null, bg, { id: site.brandId, logos: { light: Boolean(branding?.logoMime), dark: Boolean(branding?.logoOnDarkMime) } });
    const found = choice ? await getImage(organizationId, choice.kind, site.brandId, site.brandId) : null;
    return found ? image(found.data, found.mime) : notFound();
  }
  if (head === "pub-logo" && a && UUID_RE.test(a)) {
    const pub = (await getPublications(organizationId, site.brandId, { activeOnly: true })).find((item) => item.id === a);
    const choice = pub ? logoFor(pub, url.searchParams.get("bg") === "light" ? "light" : "dark") : null;
    const found = choice ? await getImage(organizationId, choice.kind, a, site.brandId) : null;
    return found ? image(found.data, found.mime) : notFound();
  }
  if (head === "editor-photo" && a && UUID_RE.test(a)) {
    const editor = (await getEditors(organizationId, site.brandId, { activeOnly: true })).find((item) => item.id === a);
    const found = editor?.hasPhoto ? await getImage(organizationId, "editor-photo", a, site.brandId) : null;
    return found ? image(found.data, found.mime) : notFound();
  }
  return notFound();
}

async function postHandler(request: Request, api: ApiSite, path: string[]): Promise<Response> {
  const { organizationId, site } = api;
  const db = tenantDb(organizationId);
  const input = await body(request);
  if (!input) return bad("json_body_required");
  const route = path.join("/");

  if (route === "subscribe") {
    const email = normalizeEmail(input.email);
    if (!email) return bad("invalid_email");
    const wanted = new Set(Array.isArray(input.publicationIds) ? input.publicationIds.map(String) : []);
    const pubs = (await getPublications(organizationId, site.brandId, { activeOnly: true })).filter((pub) => isFreePublication(pub) && wanted.has(pub.id));
    if (!pubs.length) return bad("unknown_publication");
    if (site.status !== "live") return json({ ok: true, recorded: false });
    const ipHash = hashIp(typeof input.ip === "string" ? input.ip.slice(0, 64) : null);
    if (ipHash && (await db.webSignup.count({ where: { siteId: site.id, ipHash, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } })) >= 12) return json({ error: "rate_limited" }, 429);
    const member = (await db.webMember.findFirst({ where: { siteId: site.id, email }, select: { id: true } })) ?? (await db.webMember.create({ data: { organizationId, siteId: site.id, email }, select: { id: true } }));
    const source = typeof input.source === "string" ? input.source.slice(0, 500) : "";
    for (const pub of pubs) {
      const found = await db.webSignup.findFirst({ where: { siteId: site.id, email, publicationId: pub.id }, select: { id: true } });
      if (found) await db.webSignup.updateMany({ where: { id: found.id }, data: { status: "subscribed", memberId: member.id } });
      else await db.webSignup.create({ data: { organizationId, siteId: site.id, memberId: member.id, email, publicationId: pub.id, source, ipHash } });
    }
    return json({ ok: true, recorded: true });
  }

  if (route === "auth/link") {
    const email = normalizeEmail(input.email);
    if (!email) return bad("invalid_email");
    const returnTo = safeReturnPath(input.returnTo, "/my");
    const member = await db.webMember.findFirst({ where: { siteId: site.id, email, status: "active" } });
    // Same answer whether or not the email has an account.
    if (member && (await db.webMemberToken.count({ where: { memberId: member.id, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } })) < 5) {
      const origin = new URL(request.url).origin;
      await sendMemberSignInLink({ organizationId, orgSlug: "", site, member, origin, returnTo });
    }
    return json({ ok: true });
  }

  if (route === "auth/verify") {
    const opened = await redeemSignInToken(organizationId, site.id, typeof input.token === "string" ? input.token : "");
    return opened ? json({ session: opened.value, maxAge: opened.maxAge }) : json({ error: "expired" }, 401);
  }

  if (route === "auth/password") {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    if (!email || !password) return json({ error: "invalid" }, 401);
    const result = await passwordSignIn(organizationId, site.id, email, password, hashIp(typeof input.ip === "string" ? input.ip.slice(0, 64) : null));
    if (!result.ok) return json({ error: result.reason }, result.reason === "limited" ? 429 : 401);
    return json({ session: result.session.value, maxAge: result.session.maxAge });
  }

  if (route === "auth/set-password") {
    const result = await setMemberPassword(organizationId, site.id, memberToken(request), { password: input.password, currentPassword: input.currentPassword });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
  }

  if (route === "auth/sign-out") {
    await endSession(organizationId, site.id, typeof input.session === "string" ? input.session : undefined);
    return json({ ok: true });
  }
  return notFound();
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Ctx) {
  const api = await authenticate(request);
  if (!api) return json({ error: "unauthorized" }, 401);
  return getHandler(request, api, (await params).path);
}

export async function POST(request: Request, { params }: Ctx) {
  const api = await authenticate(request);
  if (!api) return json({ error: "unauthorized" }, 401);
  return postHandler(request, api, (await params).path);
}
