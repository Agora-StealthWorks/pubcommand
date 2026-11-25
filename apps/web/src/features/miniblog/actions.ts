"use server";

import { appendOrgAudit, syncBrandLook, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { miniBlogPath } from "../../../../../modules/miniblog/paths";
import { RESERVED_POST_SLUGS, checkSite, isValidSlug, normalizeSlug } from "../../../../../modules/miniblog/site";
import { teachPost } from "./brain";
import { removePostFromCalendar, syncPostToCalendar } from "./calendar";
import { UUID_RE, loadMediums, orgTimezone } from "./data";
import { MAX_AD_CODE_LENGTH, acceptAdChoice, newAdCodeId, parseAdCodes, type AdCode, type AdNetwork, AD_NETWORKS } from "../../../../../modules/miniblog/ads";
import { acceptMedium, mediumsFromText } from "../../../../../modules/miniblog/mediums";
import { acceptCategory, categoriesFromText } from "../../../../../modules/miniblog/post-fields";
import { DEFAULT_THEME, isThemeId, themeById } from "../../../../../modules/miniblog/themes";
import { bool, color, int, optional, optionalColor, storeLogo, text, url, zoned } from "./form-input";
import { syncPostLinks } from "./links";
import { miniblogAction, miniblogWriteCtx, orgPublicUrl, withMessage, type MiniBlogCtx } from "./guard";
import { richFromInput } from "./sanitize";

function audit(ctx: MiniBlogCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, metadata });
}

async function ownSite(ctx: MiniBlogCtx, siteId: string) {
  const site = UUID_RE.test(siteId) ? await tenantDb(ctx.resolved.id).textSite.findFirst({ where: { id: siteId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!site) redirect(withMessage("/mini-blog", "error", "That Mini-Blog no longer exists."));
  return site;
}

async function uniqueSiteSlug(organizationId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = normalizeSlug(wanted) || "blog";
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.textSite.count({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

async function uniquePostSlug(organizationId: string, siteId: string, wanted: string, exceptId?: string): Promise<string> {
  let base = normalizeSlug(wanted) || "post";
  if ((RESERVED_POST_SLUGS as readonly string[]).includes(base)) base = `${base}-post`;
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.textPost.count({ where: { siteId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

export async function createSite(formData: FormData) {
  const ctx = await miniblogAction("/mini-blog", "miniblog.write");
  const name = text(formData, "name", 120) || "Mini-Blog";
  const db = tenantDb(ctx.resolved.id);
  const medium = acceptMedium(text(formData, "medium", 40), await loadMediums(ctx.resolved.id), null);
  const wantedCode = optional(formData, "calendarCode", 40);
  const calendarCode = wantedCode && (await db.calendarPublication.count({ where: { brandId: ctx.brand.id, code: wantedCode } })) ? wantedCode : null;
  const theme = themeById(DEFAULT_THEME);
  // Starts in the brand look (Settings → Brands): header and accent colors, logo and logo size,
  // kept in step with the branding until "Use the brand look" is turned off in its settings.
  const site = await db.textSite.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      name,
      slug: await uniqueSiteSlug(ctx.resolved.id, name),
      programName: name,
      companyName: ctx.brand.name,
      medium,
      calendarCode,
      // New Mini-Blogs start in the T-Letter look (and the brand's colors, below).
      theme: theme.id,
      headerBg: theme.headerBg,
      accentColor: theme.accent,
      logoHeight: 34,
      archivesEnabled: true,
      followBrand: true,
      createdById: ctx.actorId,
    },
  });
  await syncBrandLook(ctx.resolved.id, ctx.brand.id, { siteIds: [site.id] });
  await audit(ctx, "miniblog.site.created", "text_site", site.id, { medium });
  redirect(`/mini-blog/${site.id}?tab=settings`);
}

export async function saveSite(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const back = `/mini-blog/${siteId}?tab=settings`;
  const ctx = await miniblogAction(back, "miniblog.write");
  const site = await ownSite(ctx, siteId);
  const wanted = normalizeSlug(text(formData, "slug", 80));
  if (!isValidSlug(wanted)) redirect(withMessage(back, "error", "The link name must be lowercase letters, numbers and dashes."));
  const logo = await storeLogo(ctx.resolved.id, site.id, formData.get("logo"));
  if (logo && "error" in logo) redirect(withMessage(back, "error", logo.error));
  const wantedTheme = text(formData, "theme", 30);
  const theme = isThemeId(wantedTheme) ? wantedTheme : site.theme;
  const medium = acceptMedium(text(formData, "medium", 40), await loadMediums(ctx.resolved.id), site.medium);
  await tenantDb(ctx.resolved.id).textSite.updateMany({
    where: { id: site.id },
    data: {
      name: text(formData, "name", 120) || site.name,
      slug: await uniqueSiteSlug(ctx.resolved.id, wanted, site.id),
      tagline: text(formData, "tagline", 200),
      introHtml: richFromInput(text(formData, "introHtml", 20_000)),
      programName: text(formData, "programName", 120),
      companyName: text(formData, "companyName", 120),
      messageFrequency: text(formData, "messageFrequency", 120) || "Message frequency varies",
      helpContact: text(formData, "helpContact", 120),
      privacyUrl: url(formData, "privacyUrl"),
      termsUrl: url(formData, "termsUrl"),
      logoUrl: url(formData, "logoUrl"),
      logoHeight: int(formData, "logoHeight", site.logoHeight, 16, 120),
      headerBg: color(formData, "headerBg", site.headerBg),
      accentColor: color(formData, "accentColor", site.accentColor),
      // Empty = the theme's page color / the link color.
      pageBg: optionalColor(formData, "pageBg"),
      buttonColor: optionalColor(formData, "buttonColor"),
      theme,
      medium,
      postCategories: categoriesFromText(text(formData, "postCategories", 4000)),
      archivesEnabled: bool(formData, "archivesEnabled"),
      calendarCode: optional(formData, "calendarCode", 40),
      brainSyncEnabled: bool(formData, "brainSyncEnabled"),
      followBrand: bool(formData, "followBrand"),
      ...(logo && "id" in logo ? { logoAssetId: logo.id } : bool(formData, "removeLogo") ? { logoAssetId: null } : {}),
    },
  });
  // "Use the brand look": colors, logo and logo size come from Settings → Brands.
  if (bool(formData, "followBrand")) await syncBrandLook(ctx.resolved.id, ctx.brand.id, { siteIds: [site.id] });
  await audit(ctx, "miniblog.site.updated", "text_site", site.id);
  // A new medium is the issue type of this Mini-Blog's Calendar issues.
  if (medium !== site.medium && site.calendarCode) await tenantDb(ctx.resolved.id).calendarIssue.updateMany({ where: { brandId: site.brandId, issueType: site.medium, id: { in: (await tenantDb(ctx.resolved.id).textPost.findMany({ where: { siteId: site.id, calendarIssueId: { not: null } }, select: { calendarIssueId: true } })).map((post) => post.calendarIssueId!) } }, data: { issueType: medium } });
  redirect(withMessage(back, "notice", "Saved."));
}

export async function setSiteStatus(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const back = `/mini-blog/${siteId}?tab=settings`;
  const ctx = await miniblogAction(back, "miniblog.manage");
  const site = await ownSite(ctx, siteId);
  const live = text(formData, "intent", 20) === "live";
  if (live) {
    const result = checkSite(site);
    if (result.errors.length) redirect(withMessage(back, "error", `Fix ${result.errors.length === 1 ? "this" : "these"} first: ${result.errors.join(" ")}`));
  }
  await tenantDb(ctx.resolved.id).textSite.updateMany({ where: { id: site.id }, data: { status: live ? "live" : "draft" } });
  await audit(ctx, live ? "miniblog.site.published" : "miniblog.site.unpublished", "text_site", site.id);
  redirect(withMessage(back, "notice", live ? "The Mini-Blog is live." : "The Mini-Blog is offline. Its links now show “not found”."));
}

export async function deleteSite(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const ctx = await miniblogAction(`/mini-blog/${siteId}?tab=settings`, "miniblog.manage");
  const site = await ownSite(ctx, siteId);
  if (text(formData, "confirm", 200) !== site.name) redirect(withMessage(`/mini-blog/${site.id}?tab=settings`, "error", "Type the Mini-Blog name exactly to delete it."));
  await tenantDb(ctx.resolved.id).textSite.updateMany({ where: { id: site.id }, data: { deletedAt: new Date(), status: "draft", slug: `${site.slug.slice(0, 40)}-deleted-${Date.now().toString(36)}` } });
  await audit(ctx, "miniblog.site.deleted", "text_site", site.id);
  redirect(withMessage("/mini-blog", "notice", "Mini-Blog deleted. Its opt-in records are kept."));
}

export async function createPost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const ctx = await miniblogAction(`/mini-blog/${siteId}`, "miniblog.write");
  const site = await ownSite(ctx, siteId);
  const title = text(formData, "title", 200) || "Untitled post";
  const post = await tenantDb(ctx.resolved.id).textPost.create({
    data: { organizationId: ctx.resolved.id, siteId: site.id, title, slug: await uniquePostSlug(ctx.resolved.id, site.id, title), createdById: ctx.actorId },
  });
  await audit(ctx, "miniblog.post.created", "text_post", post.id);
  // On the Calendar from the start (as Drafting, on its publish date).
  let notice = "";
  if (ctx.subject.entitledModuleIds.includes("editorial")) {
    const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, miniBlogPath(site.slug, post.slug));
    const synced = await syncPostToCalendar({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId, publicUrl }).catch((error) => {
      console.error("[miniblog] calendar sync failed", post.id, error);
      return "skipped" as const;
    });
    if (synced === "created") notice = "Post created and added to the Calendar.";
  }
  redirect(notice ? withMessage(`/mini-blog/${site.id}/posts/${post.id}`, "notice", notice) : `/mini-blog/${site.id}/posts/${post.id}`);
}

export async function savePost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const postId = text(formData, "postId", 40);
  const back = `/mini-blog/${siteId}/posts/${postId}`;
  const intent = text(formData, "intent", 20);
  const publishing = intent === "publish";
  const ctx = await miniblogAction(back, publishing || intent === "unpublish" ? "miniblog.publish" : "miniblog.write");
  const site = await ownSite(ctx, siteId);
  const db = tenantDb(ctx.resolved.id);
  const post = UUID_RE.test(postId) ? await db.textPost.findFirst({ where: { id: postId, siteId: site.id, deletedAt: null } }) : null;
  if (!post) redirect(withMessage(`/mini-blog/${site.id}`, "error", "That post no longer exists."));
  const timeZone = await orgTimezone(ctx.resolved.id);
  const title = text(formData, "title", 200) || post.title;
  const slug = await uniquePostSlug(ctx.resolved.id, site.id, text(formData, "slug", 80) || title, post.id);
  const publishAt = zoned(formData, "publishAt", timeZone) ?? post.publishAt;
  const status = publishing ? "published" : intent === "unpublish" ? "draft" : post.status;
  const buttonText = optional(formData, "buttonText", 60);
  const buttonUrl = url(formData, "buttonUrl");
  const bodyHtml = richFromInput(text(formData, "bodyHtml", 100_000));
  const codes = parseAdCodes(site.adCodes);
  const topAd = acceptAdChoice(text(formData, "topAd", 60), codes);
  const contentAd = acceptAdChoice(text(formData, "contentAd", 60), codes);
  const topAdText = optional(formData, "topAdText", 400);
  const topAdLink = url(formData, "topAdLink");
  const contentAdText = optional(formData, "contentAdText", 400);
  const contentAdLink = url(formData, "contentAdLink");
  await db.textPost.updateMany({
    where: { id: post.id },
    data: {
      title,
      slug,
      publishAt,
      status,
      bodyHtml,
      actionToTake: optional(formData, "actionToTake", 1000),
      actionSecondary: optional(formData, "actionSecondary", 300),
      buttonText: buttonText && buttonUrl ? buttonText : null,
      buttonUrl: buttonText && buttonUrl ? buttonUrl : null,
      category: acceptCategory(text(formData, "category", 60), site.postCategories),
      tickers: optional(formData, "tickers", 120)?.toUpperCase() ?? null,
      topAd,
      topAdText,
      topAdLink,
      contentAd,
      contentAdText,
      contentAdLink,
    },
  });
  // Every link becomes a tracked link (click counts per post): body links, the button (CTA) and text-ad links (Ad).
  const adLinks = [
    ...(topAd === "text" ? [{ url: topAdLink, label: topAdText ?? "Top ad" }] : []),
    ...(contentAd === "text" ? [{ url: contentAdLink, label: contentAdText ?? "Content ad" }] : []),
  ];
  await syncPostLinks(ctx.resolved.id, { id: post.id, siteId: site.id, bodyHtml, buttonUrl: buttonText && buttonUrl ? buttonUrl : null, buttonText, adLinks }).catch((error: unknown) => console.error("[miniblog] link sync failed", post.id, error));
  await audit(ctx, publishing ? "miniblog.post.published" : intent === "unpublish" ? "miniblog.post.unpublished" : "miniblog.post.updated", "text_post", post.id);
  let notice = intent === "unpublish" ? "Moved back to draft." : "Saved.";
  if (status === "published") notice = publishAt > new Date() ? (publishing ? "Scheduled. It goes live at the publish time." : "Saved. Still scheduled.") : publishing ? "Published." : "Saved.";
  // Drafts are on the Calendar too (Drafting), on the publish date; saving keeps the issue in step.
  if (ctx.subject.entitledModuleIds.includes("editorial")) {
    const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, miniBlogPath(site.slug, slug));
    const synced = await syncPostToCalendar({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId, publicUrl }).catch((error) => {
      console.error("[miniblog] calendar sync failed", post.id, error);
      return "skipped" as const;
    });
    if (synced === "created") notice += " Added to the Calendar.";
    if (synced === "updated") notice += " Calendar issue updated.";
  }
  if (status === "published") after(() => teachPost({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId }));
  redirect(withMessage(back, "notice", notice));
}

export async function deletePost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const postId = text(formData, "postId", 40);
  const ctx = await miniblogAction(`/mini-blog/${siteId}`, "miniblog.write");
  const site = await ownSite(ctx, siteId);
  if (!UUID_RE.test(postId)) redirect(`/mini-blog/${site.id}`);
  const deleted = await tenantDb(ctx.resolved.id).textPost.updateMany({ where: { id: postId, siteId: site.id, deletedAt: null }, data: { deletedAt: new Date(), slug: `deleted-${postId.slice(0, 8)}-${Date.now().toString(36)}` } });
  const offCalendar = deleted.count ? await removePostFromCalendar(ctx.resolved.id, postId, ctx.actorId).catch(() => false) : false;
  await audit(ctx, "miniblog.post.deleted", "text_post", postId);
  redirect(withMessage(`/mini-blog/${site.id}`, "notice", `Post moved to the Recycle bin.${offCalendar ? " Its Calendar issue was removed." : ""}`));
}

/** Recycle bin → restore a deleted post with its status and stats (a fresh link name if its old one was taken), and put it back on the Calendar. */
export async function restorePost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const postId = text(formData, "postId", 40);
  const back = `/mini-blog/${siteId}?tab=trash`;
  const ctx = await miniblogAction(back, "miniblog.write");
  const site = await ownSite(ctx, siteId);
  const db = tenantDb(ctx.resolved.id);
  const post = UUID_RE.test(postId) ? await db.textPost.findFirst({ where: { id: postId, siteId: site.id, deletedAt: { not: null } } }) : null;
  if (!post) redirect(withMessage(back, "error", "That post is not in the Recycle bin."));
  const slug = await uniquePostSlug(ctx.resolved.id, site.id, post.title, post.id);
  await db.textPost.updateMany({ where: { id: post.id }, data: { deletedAt: null, slug } });
  await audit(ctx, "miniblog.post.restored", "text_post", post.id);
  if (ctx.subject.entitledModuleIds.includes("editorial")) {
    const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, miniBlogPath(site.slug, slug));
    await syncPostToCalendar({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId, publicUrl }).catch((error) => console.error("[miniblog] calendar sync failed", post.id, error));
  }
  redirect(withMessage(`/mini-blog/${site.id}/posts/${post.id}`, "notice", "Post restored."));
}

/** Restore a deleted Mini-Blog (offline, with a fresh link name). Its posts come back with it. */
export async function restoreSite(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const ctx = await miniblogAction("/mini-blog", "miniblog.manage");
  const db = tenantDb(ctx.resolved.id);
  const site = UUID_RE.test(siteId) ? await db.textSite.findFirst({ where: { id: siteId, brandId: ctx.brand.id, deletedAt: { not: null } } }) : null;
  if (!site) redirect(withMessage("/mini-blog", "error", "That Mini-Blog is not in the Recycle bin."));
  await db.textSite.updateMany({ where: { id: site.id }, data: { deletedAt: null, status: "draft", slug: await uniqueSiteSlug(ctx.resolved.id, site.name, site.id) } });
  await audit(ctx, "miniblog.site.restored", "text_site", site.id);
  redirect(withMessage(`/mini-blog/${site.id}?tab=settings`, "notice", "Mini-Blog restored. It is offline until you take it live again."));
}

/**
 * Ads tab: the Mini-Blog's ad network codes (AdSense, Taboola, Kevel, custom).
 * Raw HTML/script that runs on the public pages, so miniblog.manage only, and
 * every change is audited. Posts pick which code fills their top and content ads.
 */
export async function saveAdCodes(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const back = `/mini-blog/${siteId}?tab=ads`;
  const ctx = await miniblogAction(back, "miniblog.manage");
  const site = await ownSite(ctx, siteId);
  const current = parseAdCodes(site.adCodes);
  const intent = text(formData, "intent", 40);
  let next: AdCode[] = current;
  if (intent.startsWith("delete:")) {
    const id = intent.slice(7);
    next = current.filter((code) => code.id !== id);
  } else {
    const id = text(formData, "id", 40);
    const name = text(formData, "name", 80);
    const rawNetwork = text(formData, "network", 20);
    const network: AdNetwork = AD_NETWORKS.some((item) => item.id === rawNetwork) ? (rawNetwork as AdNetwork) : "custom";
    const code = String(formData.get("code") ?? "").trim().slice(0, MAX_AD_CODE_LENGTH);
    if (!name || !code) redirect(withMessage(back, "error", "Give the ad a name and paste its code."));
    const existing = current.find((item) => item.id === id);
    next = existing ? current.map((item) => (item.id === id ? { ...item, name, network, code } : item)) : [...current, { id: newAdCodeId(name, current), name, network, code }];
    next = parseAdCodes(next);
  }
  await tenantDb(ctx.resolved.id).textSite.updateMany({ where: { id: site.id }, data: { adCodes: next } });
  // Posts that pointed at a removed code fall back to no ad.
  const removed = current.filter((code) => !next.some((item) => item.id === code.id)).map((code) => `code:${code.id}`);
  if (removed.length) {
    const db = tenantDb(ctx.resolved.id);
    await db.textPost.updateMany({ where: { siteId: site.id, topAd: { in: removed } }, data: { topAd: "none" } });
    await db.textPost.updateMany({ where: { siteId: site.id, contentAd: { in: removed } }, data: { contentAd: "none" } });
  }
  await audit(ctx, "miniblog.ads.updated", "text_site", site.id, { codes: next.map((code) => ({ id: code.id, name: code.name, network: code.network, length: code.code.length })) });
  redirect(withMessage(back, "notice", intent.startsWith("delete:") ? "Ad code removed." : "Ad code saved."));
}

/** Mini-Blog → App settings: the mediums a Mini-Blog can be (Email, SMS, Push Notification by default). Admins only. */
export async function saveMediums(formData: FormData) {
  const ctx = await miniblogAction("/mini-blog/settings", "miniblog.manage");
  const mediums = mediumsFromText(text(formData, "mediums", 2000));
  await tenantDb(ctx.resolved.id).miniblogSettings.upsert({
    where: { organizationId: ctx.resolved.id },
    create: { organizationId: ctx.resolved.id, mediums, updatedById: ctx.actorId },
    update: { mediums, updatedById: ctx.actorId },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "miniblog.settings.updated", targetType: "miniblog_settings", targetId: ctx.resolved.id, metadata: { mediums } });
  redirect(withMessage("/mini-blog/settings", "notice", "Saved."));
}

/** Upload an image from the post editor. Stored on this Mini-Blog (funnel_assets, kind post_image) and served at /b/<site>/asset/<id>. */
export async function uploadPostImage(formData: FormData): Promise<{ ok: true; src: string } | { ok: false; error: string }> {
  const ctx = await miniblogWriteCtx();
  if (!ctx) return { ok: false, error: "You do not have permission to do that." };
  const siteId = text(formData, "siteId", 40);
  const site = UUID_RE.test(siteId) ? await tenantDb(ctx.resolved.id).textSite.findFirst({ where: { id: siteId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!site) return { ok: false, error: "That Mini-Blog no longer exists." };
  const stored = await storeLogo(ctx.resolved.id, site.id, formData.get("file"));
  if (!stored) return { ok: false, error: "Choose an image first." };
  if ("error" in stored) return { ok: false, error: stored.error };
  await tenantDb(ctx.resolved.id).funnelAsset.updateMany({ where: { id: stored.id }, data: { kind: "post_image" } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "miniblog.asset.uploaded", targetType: "funnel_asset", targetId: stored.id });
  return { ok: true, src: miniBlogPath(site.slug, `asset/${stored.id}`) };
}
