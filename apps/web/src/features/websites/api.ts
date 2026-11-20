import { tenantDb } from "@pubcommand/db";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEditors, getPublications, type Editor, type Publication } from "@/features/pubsetup/read";
import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";
import { menuFrom, readingMinutes, themeFrom, type Access } from "../../../../../modules/websites/content";
import { isFreePublication, orgTimezone, type SiteRow } from "./data";
import type { SignedInMember } from "./members";

/**
 * API for a website that runs as its own app (separate repo and Railway project).
 * PubCommand stays the admin: the site reads content, members and sign-ins from here.
 *
 * Key: `pcw_<orgIdHex>_<siteIdHex>_<secret>`. The org and site ids route the lookup
 * through the tenant client (no cross-tenant query); only SHA-256(key) is stored.
 */

const KEY_RE = /^pcw_([0-9a-f]{32})_([0-9a-f]{32})_([A-Za-z0-9_-]{40,60})$/;

const hex = (uuid: string) => uuid.replace(/-/g, "");
const uuidOf = (value: string) => `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createApiKey(organizationId: string, siteId: string): Promise<{ key: string; prefix: string }> {
  const key = `pcw_${hex(organizationId)}_${hex(siteId)}_${randomBytes(32).toString("base64url")}`;
  const prefix = `${key.slice(0, 4)}…${key.slice(-6)}`;
  await tenantDb(organizationId).webSite.updateMany({ where: { id: siteId }, data: { apiKeyHash: sha256(key), apiKeyPrefix: prefix, apiKeyCreatedAt: new Date() } });
  return { key, prefix };
}

export type ApiSite = { organizationId: string; site: SiteRow };

/** The site a request's `Authorization: Bearer <key>` belongs to, or null. */
export async function authenticate(request: Request): Promise<ApiSite | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const match = KEY_RE.exec(key);
  if (!match) return null;
  const organizationId = uuidOf(match[1]!);
  const siteId = uuidOf(match[2]!);
  const site = await tenantDb(organizationId).webSite.findFirst({ where: { id: siteId, deletedAt: null } });
  if (!site?.apiKeyHash) return null;
  const given = Buffer.from(sha256(key), "hex");
  const stored = Buffer.from(site.apiKeyHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  return { organizationId, site };
}

/** Secret the site uses to check publish webhooks. Derived, so it changes when the key is replaced. */
export function webhookSecret(site: Pick<SiteRow, "id" | "apiKeyPrefix" | "apiKeyCreatedAt">): string {
  const secret = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`websites-webhook:${site.id}:${site.apiKeyPrefix ?? ""}:${site.apiKeyCreatedAt?.toISOString() ?? ""}`).digest("base64url");
}

export function signWebhook(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Tell the separate site app to refresh its cached pages. Best effort, never throws. */
export async function notifyExternalSite(organizationId: string, siteId: string): Promise<void> {
  try {
    const site = await tenantDb(organizationId).webSite.findFirst({ where: { id: siteId } });
    if (!site?.publicUrl || !site.apiKeyHash) return;
    const body = JSON.stringify({ siteId, at: new Date().toISOString() });
    await fetch(`${site.publicUrl.replace(/\/+$/, "")}/api/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pubcommand-signature": signWebhook(webhookSecret(site), body) },
      body,
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    console.warn("[websites] publish webhook failed", error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// What the site app receives. Images are site-relative paths it proxies back here.

const version = (date: Date | null | undefined) => (date ? date.getTime().toString(36) : "0");

export function publicationJson(pub: Publication) {
  return {
    id: pub.id,
    slug: pub.slug,
    code: pub.code,
    name: pub.name,
    tagline: pub.tagline,
    description: pub.description,
    longDescription: pub.longDescription,
    positioning: pub.positioning,
    frequency: pub.frequency,
    pubType: pub.pubType,
    tier: pub.tier,
    free: isFreePublication(pub),
    deliverables: pub.deliverables,
    signupUrl: pub.signupUrl,
    logo: pub.hasLogo ? `/pub-logo/${pub.id}?v=${version(pub.updatedAt)}` : null,
    editors: pub.editors.map((editor) => ({ id: editor.id, name: editor.name, slug: editor.slug })),
    sortOrder: pub.sortOrder,
  };
}

/** Public fields only: never an editor's email or internal notes. */
export function editorJson(editor: Editor) {
  return {
    id: editor.id,
    name: editor.name,
    slug: editor.slug,
    title: editor.title,
    shortBio: editor.shortBio,
    longBio: editor.longBio,
    photo: editor.hasPhoto ? `/editor-photo/${editor.id}?v=${version(editor.updatedAt)}` : null,
    publications: editor.publications.map((pub) => ({ id: pub.id, name: pub.name })),
  };
}

export async function siteJson({ organizationId, site }: ApiSite) {
  const db = tenantDb(organizationId);
  const [publications, editors, products, branding, timeZone] = await Promise.all([
    getPublications(organizationId, site.brandId, { activeOnly: true }),
    getEditors(organizationId, site.brandId, { activeOnly: true }),
    db.webProduct.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.pubBrandBranding.findFirst({ where: { brandId: site.brandId }, select: { logoMime: true, logoOnDarkMime: true } }),
    orgTimezone(organizationId),
  ]);
  const hasLogo = Boolean(site.logoAssetId || site.logoLightAssetId || branding?.logoMime || branding?.logoOnDarkMime);
  return {
    site: {
      id: site.id,
      name: site.name,
      status: site.status,
      tagline: site.tagline,
      theme: themeFrom(site.theme),
      menu: menuFrom(site.menu),
      topics: menuFrom(site.topics),
      footerText: site.footerText,
      disclaimer: site.disclaimer,
      signupPublicationId: site.signupPublicationId,
      showTicker: site.showTicker,
      tickerText: site.tickerText,
      supportEmail: site.supportEmail,
      logoHeight: site.logoHeight,
      logo: hasLogo ? `/logo?v=${version(site.updatedAt)}` : null,
      icon: site.iconAssetId ? `/media/${site.iconAssetId}` : null,
      timeZone,
    },
    publications: publications.map(publicationJson),
    editors: editors.map(editorJson),
    products: products.map((product) => ({ id: product.id, name: product.name, publicationIds: product.publicationIds, allPublications: product.allPublications, offerUrl: product.offerUrl, active: product.active })),
  };
}

type CardRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  featuredAssetId: string | null;
  publishedAt: Date | null;
  publicationId: string | null;
  contentType: string;
  access: string;
  authorName: string;
  authorEditorId: string | null;
  terms: { term: { name: string; slug: string; kind: string } }[];
};

export function cardJson(post: CardRow) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    image: post.featuredAssetId ? `/media/${post.featuredAssetId}` : null,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    publicationId: post.publicationId,
    contentType: post.contentType,
    access: post.access,
    authorName: post.authorName,
    authorEditorId: post.authorEditorId,
    terms: post.terms.map(({ term }) => term),
  };
}

/** Body HTML for the site: sanitized again, and image paths made site-relative. */
export function bodyForSite(html: string, siteSlug: string): string {
  return sanitizeRichText(html, 400_000).split(`/w/${siteSlug}/media/`).join("/media/");
}

export function minutes(html: string): number {
  return readingMinutes(html);
}

export function accessJson(access: Access) {
  return { all: access.all, paid: access.paid, publicationIds: [...access.publicationIds] };
}

export function memberJson(member: SignedInMember, productName: Map<string, string>) {
  return {
    id: member.id,
    email: member.email,
    name: member.name,
    createdAt: member.createdAt.toISOString(),
    access: accessJson(member.access),
    entitlements: member.entitlements.map((entitlement) => ({
      id: entitlement.id,
      productId: entitlement.productId,
      productName: productName.get(entitlement.productId) ?? "Subscription",
      status: entitlement.status,
      startsAt: entitlement.startsAt.toISOString(),
      endsAt: entitlement.endsAt?.toISOString() ?? null,
    })),
  };
}
