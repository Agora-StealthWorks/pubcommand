"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { zonedLocalToUtc } from "../../../../../modules/miniblog/time";
import {
  DEFAULT_THEME,
  ENTITLEMENT_SOURCES,
  ENTITLEMENT_STATUSES,
  excerptFrom,
  HOME_SECTIONS,
  homepageFrom,
  orderSections,
  isAccessLevel,
  isContentType,
  isHexColor,
  isValidSlug,
  normalizeEmail,
  normalizeSlug,
  addNavItems,
  applyNavForm,
  navItemsFrom,
  safePostSlug,
  statusForSave,
  teaserHtml,
} from "../../../../../modules/websites/content";
import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";
import { assetPath, orgTimezone, siteEditors, sitePublications } from "./data";
import { NEW_KEY_COOKIE, SITE_COOKIE, UUID_RE, ownSite, websitesAction, websitesWriteCtx, withMessage, type WebsitesCtx } from "./guard";
import { storeAsset } from "./media";
import { createApiKey, notifyExternalSite } from "./api";
import { adminSetMemberPassword, sendSetPasswordLink } from "./members";

// ---------------------------------------------------------------------------
// Form readers

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}
function bool(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}
function int(formData: FormData, key: string, fallback: number, min: number, max: number): number {
  const raw = text(formData, key, 20);
  const value = Number(raw);
  return raw === "" || !Number.isFinite(value) ? fallback : Math.max(min, Math.min(max, Math.round(value)));
}
function uuidOrNull(formData: FormData, key: string): string | null {
  const value = text(formData, key, 40);
  return UUID_RE.test(value) ? value : null;
}
function httpUrl(formData: FormData, key: string): string | null {
  const value = text(formData, key, 1000);
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return value.startsWith("/") && !value.startsWith("//") ? value : null;
  }
}

function audit(ctx: WebsitesCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, metadata });
}

/** Public pages are rendered per request; this drops any cached copy Next holds. */
function refreshPublic(siteSlug: string, external?: { organizationId: string; siteId: string }) {
  revalidatePath(`/sites/public/[slug]/w/${siteSlug}`, "layout");
  // A site running as its own app is told to refresh its cached pages (after the response).
  if (external) after(() => notifyExternalSite(external.organizationId, external.siteId));
}

async function uniqueSiteSlug(organizationId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = normalizeSlug(wanted, 60) || "site";
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.webSite.count({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

async function uniquePostSlug(organizationId: string, siteId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = safePostSlug(wanted);
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.webPost.count({ where: { siteId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 74)}-${n}`;
  return slug;
}

// ---------------------------------------------------------------------------
// Sites

const DEFAULT_MENU = [
  { label: "Latest", href: "/" },
  { label: "Publications", href: "/publications" },
  { label: "Free Newsletters", href: "/newsletters" },
  { label: "Our Research", href: "/research" },
  { label: "Editors", href: "/editors" },
];

export async function createSite(formData: FormData) {
  const ctx = await websitesAction("/websites", "websites.settings");
  const name = text(formData, "name", 120) || ctx.brand.name;
  const site = await tenantDb(ctx.resolved.id).webSite.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      name,
      slug: await uniqueSiteSlug(ctx.resolved.id, text(formData, "slug", 60) || name),
      theme: DEFAULT_THEME,
      menu: DEFAULT_MENU,
      footerText: `Independent research from ${ctx.brand.name}.`,
      createdById: ctx.actorId,
    },
  });
  await tenantDb(ctx.resolved.id).webTerm.create({ data: { organizationId: ctx.resolved.id, siteId: site.id, kind: "category", name: "Uncategorized", slug: "uncategorized" } });
  await audit(ctx, "websites.site.created", "web_site", site.id);
  (await cookies()).set(SITE_COOKIE, site.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect(withMessage("/websites/settings", "notice", "Website created. Set it up below, then take it live."));
}

export async function chooseSite(formData: FormData) {
  const ctx = await websitesAction("/websites");
  const site = await ownSite(ctx, text(formData, "siteId", 40));
  (await cookies()).set(SITE_COOKIE, site.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect(text(formData, "back", 200).startsWith("/websites") ? text(formData, "back", 200) : "/websites");
}

export async function saveSettings(formData: FormData) {
  const back = "/websites/settings";
  const ctx = await websitesAction(back, "websites.settings");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const wantedSlug = normalizeSlug(text(formData, "slug", 60), 60);
  if (!isValidSlug(wantedSlug)) redirect(withMessage(back, "error", "The site address must be lowercase letters, numbers and dashes."));
  const uploads: Record<string, string | null> = {};
  for (const [field, column, height] of [
    ["logo", "logoAssetId", 360],
    ["logoLight", "logoLightAssetId", 360],
    ["icon", "iconAssetId", 512],
  ] as const) {
    const stored = await storeAsset(ctx.resolved.id, site.id, formData.get(field), { actorId: ctx.actorId, alt: `${site.name} logo`, svgHeight: height });
    if (stored && "error" in stored) redirect(withMessage(back, "error", stored.error));
    if (stored) uploads[column] = stored.id;
    if (bool(formData, `${field}Remove`)) uploads[column] = null;
  }
  const theme = Object.fromEntries(
    (["primary", "accent", "accentOnLight", "cream", "ink"] as const).map((key) => {
      const value = text(formData, `theme_${key}`, 7);
      return [key, isHexColor(value) ? value.toLowerCase() : DEFAULT_THEME[key]];
    }),
  );
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const signupPublicationId = uuidOrNull(formData, "signupPublicationId");
  const status = text(formData, "status", 10) === "live" ? "live" : "draft";
  const slug = await uniqueSiteSlug(ctx.resolved.id, wantedSlug, site.id);
  await tenantDb(ctx.resolved.id).webSite.updateMany({
    where: { id: site.id },
    data: {
      name: text(formData, "name", 120) || site.name,
      slug,
      status,
      tagline: text(formData, "tagline", 200),
      logoHeight: int(formData, "logoHeight", site.logoHeight, 32, 160),
      theme,
      footerText: text(formData, "footerText", 600),
      disclaimer: text(formData, "disclaimer", 4000),
      signupPublicationId: signupPublicationId && pubs.free.some((pub) => pub.id === signupPublicationId) ? signupPublicationId : null,
      showTicker: bool(formData, "showTicker"),
      tickerText: text(formData, "tickerText", 2000),
      supportEmail: normalizeEmail(text(formData, "supportEmail", 254)),
      publicUrl: siteUrlFrom(text(formData, "publicUrl", 300)),
      ...uploads,
    },
  });
  await audit(ctx, "websites.site.saved", "web_site", site.id, { status });
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  if (slug !== site.slug) refreshPublic(slug);
  redirect(withMessage(back, "notice", status === "live" && site.status !== "live" ? "Saved. The website is live." : "Saved."));
}

/** Which stored menu a form edits: the header menu or the topic bar. */
function menuKey(formData: FormData): "menu" | "topics" {
  return text(formData, "menu", 10) === "topics" ? "topics" : "menu";
}

/** Menus → "Add to menu": ticked pages, categories, publications and built-in pages, or a custom link. */
export async function addMenuItems(formData: FormData) {
  const key = menuKey(formData);
  const back = `/websites/menus?menu=${key === "topics" ? "topics" : "header"}`;
  const ctx = await websitesAction(back, "websites.settings");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const picked = formData
    .getAll("item")
    .map(String)
    .map((value) => {
      const [kind = "custom", label = "", ...rest] = value.split("|");
      return { kind, label, href: rest.join("|") };
    });
  const customLabel = text(formData, "customLabel", 40);
  const customHref = text(formData, "customHref", 300);
  if (customLabel || customHref) {
    if (!customLabel || !(customHref.startsWith("/") || /^https?:\/\//i.test(customHref))) redirect(withMessage(back, "error", "A custom link needs a label and an address starting with / or https://."));
    picked.push({ kind: "custom", label: customLabel, href: customHref });
  }
  if (!picked.length) redirect(withMessage(back, "error", "Tick something to add, or fill in a custom link."));
  const items = addNavItems(navItemsFrom(site[key]), picked);
  await tenantDb(ctx.resolved.id).webSite.updateMany({ where: { id: site.id }, data: { [key]: items } });
  await audit(ctx, "websites.menu.items_added", "web_site", site.id, { menu: key, count: picked.length });
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  redirect(withMessage(back, "notice", "Added to the menu."));
}

/** Menus → "Save menu": labels, links, order, dropdown parents and removals. */
export async function saveMenu(formData: FormData) {
  const key = menuKey(formData);
  const back = `/websites/menus?menu=${key === "topics" ? "topics" : "header"}`;
  const ctx = await websitesAction(back, "websites.settings");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const items = navItemsFrom(site[key]);
  const rows = items.map((item) => ({
    id: item.id,
    label: text(formData, `label_${item.id}`, 40),
    href: text(formData, `href_${item.id}`, 300),
    position: int(formData, `pos_${item.id}`, 99, 0, 99),
    parent: text(formData, `parent_${item.id}`, 20) || null,
    remove: bool(formData, `remove_${item.id}`),
  }));
  const saved = applyNavForm(items, rows);
  await tenantDb(ctx.resolved.id).webSite.updateMany({ where: { id: site.id }, data: { [key]: saved } });
  await audit(ctx, "websites.menu.saved", "web_site", site.id, { menu: key, items: saved.length });
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  redirect(withMessage(back, "notice", "Menu saved."));
}

/** Homepage builder: section order and on/off, and the hero banner. */
export async function saveHomepage(formData: FormData) {
  const back = "/websites/homepage";
  const ctx = await websitesAction(back, "websites.settings");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const current = homepageFrom(site.homepage);
  const sections = orderSections(
    HOME_SECTIONS.map((section) => ({ key: section.key, on: bool(formData, `on_${section.key}`), position: int(formData, `pos_${section.key}`, 99, 0, 99) })),
  );
  const upload = await storeAsset(ctx.resolved.id, site.id, formData.get("heroImage"), { actorId: ctx.actorId, alt: "Homepage hero", svgHeight: 1600 });
  if (upload && "error" in upload) redirect(withMessage(back, "error", upload.error));
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const signupId = uuidOrNull(formData, "heroSignupPublicationId");
  const homepage = homepageFrom({
    sections,
    hero: {
      kicker: text(formData, "heroKicker", 60),
      headline: text(formData, "heroHeadline", 160),
      text: text(formData, "heroText", 600),
      imageAssetId: upload?.id ?? (bool(formData, "heroImageRemove") ? null : current.hero.imageAssetId),
      buttonLabel: text(formData, "heroButtonLabel", 40),
      buttonHref: text(formData, "heroButtonHref", 500),
      button2Label: text(formData, "heroButton2Label", 40),
      button2Href: text(formData, "heroButton2Href", 500),
      signupPublicationId: signupId && pubs.free.some((pub) => pub.id === signupId) ? signupId : null,
    },
  });
  if (homepage.sections.find((section) => section.key === "hero")?.on && !homepage.hero.headline) {
    redirect(withMessage(back, "error", "Give the hero banner a headline, or turn it off."));
  }
  await tenantDb(ctx.resolved.id).webSite.updateMany({ where: { id: site.id }, data: { homepage } });
  await audit(ctx, "websites.homepage.saved", "web_site", site.id, { order: homepage.sections.filter((section) => section.on).map((section) => section.key) });
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  redirect(withMessage(back, "notice", "Homepage saved. The live site updates within seconds."));
}

/** "https://freemarketsociety.org" (no path); anything else is dropped. */
function siteUrlFrom(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname.endsWith(".localhost") ? url.origin : null;
  } catch {
    return null;
  }
}

/** Make (or replace) the key the separate site app uses to read from PubCommand. */
export async function generateApiKey(formData: FormData) {
  const back = "/websites/settings";
  const ctx = await websitesAction(back, "websites.settings");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const { key, prefix } = await createApiKey(ctx.resolved.id, site.id);
  await audit(ctx, site.apiKeyHash ? "websites.api_key.replaced" : "websites.api_key.created", "web_site", site.id, { prefix });
  (await cookies()).set(NEW_KEY_COOKIE, key, { path: "/websites/settings", httpOnly: true, sameSite: "strict", secure: ctx.request.origin.startsWith("https://"), maxAge: 120 });
  redirect(withMessage(`${back}#api`, "notice", site.apiKeyHash ? "New key made. The old key stopped working." : "Key made."));
}

// ---------------------------------------------------------------------------
// Posts and pages

export async function savePost(formData: FormData) {
  const postId = text(formData, "postId", 40);
  const kind = text(formData, "kind", 10) === "page" ? "page" : "post";
  const list = kind === "page" ? "/websites/pages" : "/websites/posts";
  const back = postId ? `/websites/posts/${postId}` : kind === "page" ? "/websites/pages/new" : "/websites/posts/new";
  const ctx = await websitesAction(back, "websites.write");
  const site = await ownSite(ctx, text(formData, "siteId", 40), list);
  const db = tenantDb(ctx.resolved.id);
  const existing = postId ? (UUID_RE.test(postId) ? await db.webPost.findFirst({ where: { id: postId, siteId: site.id } }) : null) : null;
  if (postId && !existing) redirect(withMessage(list, "error", "That post no longer exists."));

  const timeZone = await orgTimezone(ctx.resolved.id);
  const now = new Date();
  const intent = text(formData, "intent", 20);
  const publishAt = zonedLocalToUtc(text(formData, "publishAt", 20), timeZone);
  const wasLive = existing?.status === "published" || existing?.status === "scheduled";
  // Writers without publish rights can draft and submit for review ("publish" becomes "pending"),
  // but cannot change or take down a live post.
  if (!ctx.canPublish && (wasLive || intent === "unpublish")) {
    redirect(withMessage(back, "error", "Only editors with publish rights can change or unpublish a live post."));
  }
  let next: { status: string; publishedAt: Date | null };
  if (intent === "unpublish") next = { status: "draft", publishedAt: existing?.publishedAt ?? null };
  else if (intent === "save") next = { status: existing?.status ?? "draft", publishedAt: existing && wasLive ? (publishAt ?? existing.publishedAt) : publishAt };
  else next = statusForSave({ wanted: intent, publishAt, canPublish: ctx.canPublish, now });
  if (next.status === "published" && !next.publishedAt) next.publishedAt = now;
  if (next.status === "scheduled" && (!next.publishedAt || next.publishedAt <= now)) next = { status: "published", publishedAt: next.publishedAt ?? now };

  const title = text(formData, "title", 300).replace(/\s+/g, " ") || "Untitled";
  const bodyHtml = sanitizeRichText(String(formData.get("bodyHtml") ?? ""), 400_000);
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const publicationId = uuidOrNull(formData, "publicationId");
  const access = text(formData, "access", 10);
  const contentType = text(formData, "contentType", 20);
  const featuredUpload = await storeAsset(ctx.resolved.id, site.id, formData.get("featuredFile"), { actorId: ctx.actorId, alt: title });
  if (featuredUpload && "error" in featuredUpload) redirect(withMessage(back, "error", featuredUpload.error));
  const pickedFeatured = uuidOrNull(formData, "featuredAssetId");
  const featuredAssetId = featuredUpload?.id ?? (bool(formData, "featuredRemove") ? null : pickedFeatured && (await db.webAsset.count({ where: { id: pickedFeatured, siteId: site.id } })) ? pickedFeatured : (existing?.featuredAssetId ?? null));
  const slug = await uniquePostSlug(ctx.resolved.id, site.id, text(formData, "slug", 100) || title, existing?.id);
  const editorId = uuidOrNull(formData, "authorEditorId");
  const editor = editorId ? (await siteEditors(ctx.resolved.id, ctx.brand.id)).find((item) => item.id === editorId) : undefined;

  const data = {
    kind,
    title,
    slug,
    // An automatic excerpt is shown to everyone (cards, meta tags), so a locked post's comes from its free teaser only.
    excerpt: text(formData, "excerpt", 600) || excerptFrom(isAccessLevel(access) && access !== "public" ? teaserHtml(bodyHtml, Math.max(1, int(formData, "teaserBlocks", 2, 0, 10))) : bodyHtml, 220),
    bodyHtml,
    featuredAssetId,
    status: next.status,
    publishedAt: next.publishedAt,
    publicationId: publicationId && pubs.all.some((pub) => pub.id === publicationId) ? publicationId : null,
    contentType: kind === "page" ? "article" : isContentType(contentType) ? contentType : "article",
    access: isAccessLevel(access) ? access : "public",
    teaserBlocks: int(formData, "teaserBlocks", 2, 0, 10),
    authorEditorId: editor?.id ?? null,
    authorName: text(formData, "authorName", 120) || editor?.name || "",
    featured: bool(formData, "featured"),
    seoTitle: text(formData, "seoTitle", 120),
    seoDescription: text(formData, "seoDescription", 300),
    updatedById: ctx.actorId,
  };

  let id = existing?.id;
  if (existing) await db.webPost.updateMany({ where: { id: existing.id }, data });
  else id = (await db.webPost.create({ data: { ...data, organizationId: ctx.resolved.id, siteId: site.id, createdById: ctx.actorId }, select: { id: true } })).id;

  // Categories (checked boxes) and tags (comma list; new tags are created).
  if (kind === "post" && id) {
    const categoryIds = formData.getAll("categoryIds").map(String).filter((value) => UUID_RE.test(value));
    const tagNames = [...new Set(text(formData, "tags", 1000).split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
    const termIds = new Set<string>();
    if (categoryIds.length) {
      for (const term of await db.webTerm.findMany({ where: { siteId: site.id, kind: "category", id: { in: categoryIds } }, select: { id: true } })) termIds.add(term.id);
    }
    for (const name of tagNames) {
      const tagSlug = normalizeSlug(name, 60);
      if (!tagSlug) continue;
      const found = await db.webTerm.findFirst({ where: { siteId: site.id, kind: "tag", slug: tagSlug }, select: { id: true } });
      const tag = found ?? (await db.webTerm.create({ data: { organizationId: ctx.resolved.id, siteId: site.id, kind: "tag", name: name.slice(0, 60), slug: tagSlug }, select: { id: true } }));
      termIds.add(tag.id);
    }
    await db.webPostTerm.deleteMany({ where: { postId: id } });
    for (const termId of termIds) await db.webPostTerm.create({ data: { organizationId: ctx.resolved.id, postId: id, termId } });
  }

  await audit(ctx, existing ? "websites.post.saved" : "websites.post.created", "web_post", id!, { status: next.status, intent });
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  const message =
    next.status === "published" ? (existing?.status === "published" ? "Updated." : "Published.") : next.status === "scheduled" ? "Scheduled." : next.status === "pending" ? "Submitted for review." : "Draft saved.";
  redirect(withMessage(`/websites/posts/${id}`, "notice", message));
}

export async function trashPost(formData: FormData) {
  const postId = text(formData, "postId", 40);
  const back = text(formData, "back", 200).startsWith("/websites") ? text(formData, "back", 200) : "/websites/posts";
  const ctx = await websitesAction(back, "websites.write");
  const db = tenantDb(ctx.resolved.id);
  const post = UUID_RE.test(postId) ? await db.webPost.findFirst({ where: { id: postId } }) : null;
  const site = post ? await db.webSite.findFirst({ where: { id: post.siteId, brandId: ctx.brand.id } }) : null;
  if (!post || !site) redirect(withMessage(back, "error", "That post no longer exists."));
  if ((post.status === "published" || post.status === "scheduled") && !ctx.canPublish) redirect(withMessage(back, "error", "Only editors with publish rights can remove a live post."));
  const restore = bool(formData, "restore");
  if (bool(formData, "forever")) {
    if (!post.deletedAt) redirect(withMessage(back, "error", "Move it to the trash first."));
    await db.webPost.deleteMany({ where: { id: post.id } });
  } else {
    await db.webPost.updateMany({ where: { id: post.id }, data: { deletedAt: restore ? null : new Date(), ...(restore ? {} : { featured: false }) } });
  }
  await audit(ctx, restore ? "websites.post.restored" : bool(formData, "forever") ? "websites.post.deleted" : "websites.post.trashed", "web_post", post.id);
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  redirect(withMessage(back, "notice", restore ? "Restored." : bool(formData, "forever") ? "Deleted for good." : "Moved to the trash."));
}

/** Image upload from the rich-text editor. Returns a site-relative address. */
export async function uploadEditorImage(formData: FormData): Promise<{ ok: true; src: string } | { ok: false; error: string }> {
  const ctx = await websitesWriteCtx();
  if (!ctx) return { ok: false, error: "You do not have permission to do that." };
  const siteId = text(formData, "siteId", 40);
  const site = UUID_RE.test(siteId) ? await tenantDb(ctx.resolved.id).webSite.findFirst({ where: { id: siteId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!site) return { ok: false, error: "That website no longer exists." };
  const stored = await storeAsset(ctx.resolved.id, site.id, formData.get("file"), { actorId: ctx.actorId, svgHeight: 1200 });
  if (!stored) return { ok: false, error: "Choose an image first." };
  if ("error" in stored) return { ok: false, error: stored.error };
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "websites.media.uploaded", targetType: "web_asset", targetId: stored.id });
  return { ok: true, src: assetPath(site.slug, stored.id) };
}

// ---------------------------------------------------------------------------
// Media

export async function uploadMedia(formData: FormData) {
  const back = "/websites/media";
  const ctx = await websitesAction(back, "websites.write");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const files = formData.getAll("files");
  let count = 0;
  for (const file of files.slice(0, 20)) {
    const stored = await storeAsset(ctx.resolved.id, site.id, file, { actorId: ctx.actorId, allowPdf: true, svgHeight: 1200 });
    if (stored && "error" in stored) redirect(withMessage(back, "error", `${file instanceof File ? file.name : "File"}: ${stored.error}`));
    if (stored) {
      count += 1;
      await audit(ctx, "websites.media.uploaded", "web_asset", stored.id);
    }
  }
  redirect(withMessage(back, count ? "notice" : "error", count ? `${count} file${count === 1 ? "" : "s"} uploaded.` : "Choose files to upload."));
}

export async function saveMedia(formData: FormData) {
  const back = "/websites/media";
  const ctx = await websitesAction(back, "websites.write");
  const assetId = text(formData, "assetId", 40);
  const db = tenantDb(ctx.resolved.id);
  const asset = UUID_RE.test(assetId) ? await db.webAsset.findFirst({ where: { id: assetId }, select: { id: true, siteId: true } }) : null;
  if (!asset || !(await db.webSite.count({ where: { id: asset.siteId, brandId: ctx.brand.id } }))) redirect(withMessage(back, "error", "That file no longer exists."));
  if (bool(formData, "delete")) {
    const used = await db.webPost.count({ where: { featuredAssetId: asset.id, deletedAt: null } });
    if (used) redirect(withMessage(back, "error", `That image is the featured image of ${used} post${used === 1 ? "" : "s"}. Change them first.`));
    await db.webAsset.deleteMany({ where: { id: asset.id } });
    await audit(ctx, "websites.media.deleted", "web_asset", asset.id);
    redirect(withMessage(back, "notice", "Deleted."));
  }
  await db.webAsset.updateMany({ where: { id: asset.id }, data: { alt: text(formData, "alt", 300) } });
  redirect(withMessage(back, "notice", "Saved."));
}

// ---------------------------------------------------------------------------
// Categories and tags

export async function saveTerm(formData: FormData) {
  const back = "/websites/terms";
  const ctx = await websitesAction(back, "websites.write");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const db = tenantDb(ctx.resolved.id);
  const termId = text(formData, "termId", 40);
  if (bool(formData, "delete") && UUID_RE.test(termId)) {
    await db.webTerm.deleteMany({ where: { id: termId, siteId: site.id } });
    await audit(ctx, "websites.term.deleted", "web_term", termId);
    refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
    redirect(withMessage(back, "notice", "Deleted."));
  }
  const kind = text(formData, "kind", 10) === "tag" ? "tag" : "category";
  const name = text(formData, "name", 60);
  if (!name) redirect(withMessage(back, "error", "Give it a name."));
  const slug = normalizeSlug(text(formData, "slug", 60) || name, 60);
  const clash = await db.webTerm.findFirst({ where: { siteId: site.id, kind, slug, ...(UUID_RE.test(termId) ? { id: { not: termId } } : {}) }, select: { id: true } });
  if (clash) redirect(withMessage(back, "error", `A ${kind} with the address "${slug}" already exists.`));
  const data = { name, slug, description: text(formData, "description", 500), sortOrder: int(formData, "sortOrder", 0, -999, 999) };
  if (UUID_RE.test(termId)) await db.webTerm.updateMany({ where: { id: termId, siteId: site.id }, data });
  else await db.webTerm.create({ data: { ...data, organizationId: ctx.resolved.id, siteId: site.id, kind } });
  await audit(ctx, "websites.term.saved", "web_term", termId || slug);
  refreshPublic(site.slug, { organizationId: ctx.resolved.id, siteId: site.id });
  redirect(withMessage(back, "notice", "Saved."));
}

// ---------------------------------------------------------------------------
// Products and access

export async function saveProduct(formData: FormData) {
  const back = "/websites/products";
  const ctx = await websitesAction(back, "websites.members");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const db = tenantDb(ctx.resolved.id);
  const productId = text(formData, "productId", 40);
  const existing = UUID_RE.test(productId) ? await db.webProduct.findFirst({ where: { id: productId, siteId: site.id } }) : null;
  if (bool(formData, "delete") && existing) {
    const holders = await db.webEntitlement.count({ where: { productId: existing.id, status: { not: "cancelled" } } });
    if (holders) redirect(withMessage(back, "error", `${holders} member${holders === 1 ? " has" : "s have"} this product. Turn it off instead, or cancel their access first.`));
    await db.webProduct.deleteMany({ where: { id: existing.id } });
    await audit(ctx, "websites.product.deleted", "web_product", existing.id);
    redirect(withMessage(back, "notice", "Product deleted."));
  }
  const name = text(formData, "name", 120);
  if (!name) redirect(withMessage(back, "error", "Give the product a name."));
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const known = new Set(pubs.all.map((pub) => pub.id));
  const publicationIds = formData.getAll("publicationIds").map(String).filter((id) => known.has(id));
  const data = {
    name,
    sku: text(formData, "sku", 80),
    priceLabel: text(formData, "priceLabel", 80),
    publicationIds,
    allPublications: bool(formData, "allPublications"),
    offerUrl: httpUrl(formData, "offerUrl"),
    active: !formData.has("activeShown") || bool(formData, "active"),
    sortOrder: int(formData, "sortOrder", existing?.sortOrder ?? 0, -999, 999),
  };
  if (existing) await db.webProduct.updateMany({ where: { id: existing.id }, data });
  else await db.webProduct.create({ data: { ...data, organizationId: ctx.resolved.id, siteId: site.id } });
  await audit(ctx, existing ? "websites.product.saved" : "websites.product.created", "web_product", existing?.id ?? name, { publications: publicationIds.length, all: data.allPublications });
  redirect(withMessage(back, "notice", "Saved. Members of this product see the change right away."));
}

/** One checkbox in the product grid. */
export async function toggleProductPublication(formData: FormData) {
  const back = "/websites/products";
  const ctx = await websitesAction(back, "websites.members");
  const db = tenantDb(ctx.resolved.id);
  const productId = text(formData, "productId", 40);
  const publicationId = text(formData, "publicationId", 40);
  const product = UUID_RE.test(productId) ? await db.webProduct.findFirst({ where: { id: productId } }) : null;
  if (!product || !(await db.webSite.count({ where: { id: product.siteId, brandId: ctx.brand.id } }))) redirect(withMessage(back, "error", "That product no longer exists."));
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  if (!pubs.all.some((pub) => pub.id === publicationId)) redirect(withMessage(back, "error", "That publication no longer exists."));
  const set = new Set(product.publicationIds);
  if (set.has(publicationId)) set.delete(publicationId);
  else set.add(publicationId);
  await db.webProduct.updateMany({ where: { id: product.id }, data: { publicationIds: [...set] } });
  await audit(ctx, "websites.product.access", "web_product", product.id, { publicationId, on: set.has(publicationId) });
  redirect(back);
}

// ---------------------------------------------------------------------------
// Members

export async function addMember(formData: FormData) {
  const back = "/websites/members";
  const ctx = await websitesAction(back, "websites.members");
  const site = await ownSite(ctx, text(formData, "siteId", 40), back);
  const email = normalizeEmail(text(formData, "email", 254));
  if (!email) redirect(withMessage(back, "error", "Enter a valid email address."));
  const db = tenantDb(ctx.resolved.id);
  const found = await db.webMember.findFirst({ where: { siteId: site.id, email }, select: { id: true } });
  const member = found ?? (await db.webMember.create({ data: { organizationId: ctx.resolved.id, siteId: site.id, email, name: text(formData, "name", 120) }, select: { id: true } }));
  if (!found) await audit(ctx, "websites.member.created", "web_member", member.id);
  redirect(withMessage(`/websites/members/${member.id}`, "notice", found ? "That member already exists." : "Member added. Grant access below."));
}

async function ownMember(ctx: WebsitesCtx, memberId: string, back: string) {
  const db = tenantDb(ctx.resolved.id);
  const member = UUID_RE.test(memberId) ? await db.webMember.findFirst({ where: { id: memberId } }) : null;
  const site = member ? await db.webSite.findFirst({ where: { id: member.siteId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!member || !site) redirect(withMessage(back, "error", "That member no longer exists."));
  return { member, site };
}

export async function saveMember(formData: FormData) {
  const memberId = text(formData, "memberId", 40);
  const back = `/websites/members/${memberId}`;
  const ctx = await websitesAction(back, "websites.members");
  const { member } = await ownMember(ctx, memberId, "/websites/members");
  const db = tenantDb(ctx.resolved.id);
  const status = text(formData, "status", 10) === "disabled" ? "disabled" : "active";
  await db.webMember.updateMany({ where: { id: member.id }, data: { name: text(formData, "name", 120), status } });
  if (status === "disabled") await db.webMemberSession.deleteMany({ where: { memberId: member.id } });
  await audit(ctx, "websites.member.saved", "web_member", member.id, { status });
  redirect(withMessage(back, "notice", "Saved."));
}

export async function grantAccess(formData: FormData) {
  const memberId = text(formData, "memberId", 40);
  const back = `/websites/members/${memberId}`;
  const ctx = await websitesAction(back, "websites.members");
  const { member, site } = await ownMember(ctx, memberId, "/websites/members");
  const db = tenantDb(ctx.resolved.id);
  const productId = text(formData, "productId", 40);
  const product = UUID_RE.test(productId) ? await db.webProduct.findFirst({ where: { id: productId, siteId: site.id } }) : null;
  if (!product) redirect(withMessage(back, "error", "Choose a product."));
  const timeZone = await orgTimezone(ctx.resolved.id);
  const endsOn = text(formData, "endsOn", 10);
  const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? zonedLocalToUtc(`${endsOn}T23:59`, timeZone) : null;
  const source = text(formData, "source", 20);
  const entitlement = await db.webEntitlement.create({
    data: {
      organizationId: ctx.resolved.id,
      memberId: member.id,
      productId: product.id,
      source: (ENTITLEMENT_SOURCES as readonly string[]).includes(source) ? source : "manual",
      status: "active",
      endsAt,
      reference: text(formData, "reference", 120),
      note: text(formData, "note", 500),
      grantedById: ctx.actorId,
    },
    select: { id: true },
  });
  await audit(ctx, "websites.access.granted", "web_entitlement", entitlement.id, { memberId: member.id, productId: product.id });
  redirect(withMessage(back, "notice", `Access to ${product.name} granted.`));
}

export async function updateAccess(formData: FormData) {
  const memberId = text(formData, "memberId", 40);
  const back = `/websites/members/${memberId}`;
  const ctx = await websitesAction(back, "websites.members");
  const { member } = await ownMember(ctx, memberId, "/websites/members");
  const db = tenantDb(ctx.resolved.id);
  const entitlementId = text(formData, "entitlementId", 40);
  const status = text(formData, "status", 20);
  if (!UUID_RE.test(entitlementId) || !(ENTITLEMENT_STATUSES as readonly string[]).includes(status)) redirect(withMessage(back, "error", "Choose a status."));
  const timeZone = await orgTimezone(ctx.resolved.id);
  const endsOn = text(formData, "endsOn", 10);
  const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? zonedLocalToUtc(`${endsOn}T23:59`, timeZone) : null;
  const changed = await db.webEntitlement.updateMany({ where: { id: entitlementId, memberId: member.id }, data: { status, endsAt } });
  if (!changed.count) redirect(withMessage(back, "error", "That access record no longer exists."));
  await audit(ctx, "websites.access.updated", "web_entitlement", entitlementId, { status });
  redirect(withMessage(back, "notice", "Access updated."));
}

export async function emailSignInLink(formData: FormData) {
  const memberId = text(formData, "memberId", 40);
  const back = `/websites/members/${memberId}`;
  const ctx = await websitesAction(back, "websites.members");
  const { member, site } = await ownMember(ctx, memberId, "/websites/members");
  const result = await sendSetPasswordLink({ organizationId: ctx.resolved.id, site, member, origin: ctx.request.origin });
  await audit(ctx, "websites.member.link_sent", "web_member", member.id, { status: result.status });
  redirect(withMessage(back, "notice", result.status === "sent" ? `Set-password link emailed to ${member.email}.` : result.status === "failed" ? "The email could not be sent. Try again later." : "Email is not set up yet (RESEND_API_KEY). The link was written to the server log."));
}

/** Staff set a member's password directly. The member is signed out everywhere. */
export async function setMemberPasswordByAdmin(formData: FormData) {
  const memberId = text(formData, "memberId", 40);
  const back = `/websites/members/${memberId}`;
  const ctx = await websitesAction(back, "websites.members");
  const { member } = await ownMember(ctx, memberId, "/websites/members");
  const password = formData.get("password");
  if (typeof password !== "string" || password !== formData.get("confirm")) redirect(withMessage(back, "error", "The two passwords do not match."));
  const result = await adminSetMemberPassword(ctx.resolved.id, member.id, password);
  if (!result.ok) redirect(withMessage(back, "error", result.error));
  await audit(ctx, "websites.member.password_set", "web_member", member.id);
  redirect(withMessage(back, "notice", `Password set for ${member.email}. Tell them yourself; nothing was emailed. They were signed out on every device.`));
}
