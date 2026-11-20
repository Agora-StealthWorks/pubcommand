"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { miniBlogPath } from "../../../../../modules/miniblog/paths";
import { RESERVED_POST_SLUGS, checkSite, isValidSlug, normalizeSlug } from "../../../../../modules/miniblog/site";
import { teachPost } from "./brain";
import { syncPostToCalendar } from "./calendar";
import { UUID_RE, orgTimezone } from "./data";
import { bool, color, int, optional, storeLogo, text, url, zoned } from "./form-input";
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
  const site = await tenantDb(ctx.resolved.id).textSite.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      name,
      slug: await uniqueSiteSlug(ctx.resolved.id, name),
      programName: name,
      companyName: ctx.brand.name,
      createdById: ctx.actorId,
    },
  });
  await audit(ctx, "miniblog.site.created", "text_site", site.id);
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
      logoHeight: int(formData, "logoHeight", 36, 16, 120),
      headerBg: color(formData, "headerBg", "#111827"),
      accentColor: color(formData, "accentColor", "#1d4ed8"),
      archivesEnabled: bool(formData, "archivesEnabled"),
      calendarCode: optional(formData, "calendarCode", 40),
      brainSyncEnabled: bool(formData, "brainSyncEnabled"),
      ...(logo && "id" in logo ? { logoAssetId: logo.id } : bool(formData, "removeLogo") ? { logoAssetId: null } : {}),
    },
  });
  await audit(ctx, "miniblog.site.updated", "text_site", site.id);
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
  redirect(`/mini-blog/${site.id}/posts/${post.id}`);
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
  await db.textPost.updateMany({
    where: { id: post.id },
    data: {
      title,
      slug,
      publishAt,
      status,
      bodyHtml,
      actionToTake: optional(formData, "actionToTake", 1000),
      buttonText: buttonText && buttonUrl ? buttonText : null,
      buttonUrl: buttonText && buttonUrl ? buttonUrl : null,
    },
  });
  // Every link becomes a tracked link (click counts per post).
  await syncPostLinks(ctx.resolved.id, { id: post.id, siteId: site.id, bodyHtml, buttonUrl: buttonText && buttonUrl ? buttonUrl : null, buttonText }).catch((error: unknown) => console.error("[miniblog] link sync failed", post.id, error));
  await audit(ctx, publishing ? "miniblog.post.published" : intent === "unpublish" ? "miniblog.post.unpublished" : "miniblog.post.updated", "text_post", post.id);
  let notice = intent === "unpublish" ? "Moved back to draft." : "Saved.";
  if (status === "published") {
    notice = publishAt > new Date() ? (publishing ? "Scheduled. It goes live at the publish time." : "Saved. Still scheduled.") : publishing ? "Published." : "Saved.";
    const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, miniBlogPath(site.slug, slug));
    if (ctx.subject.entitledModuleIds.includes("editorial")) {
      const synced = await syncPostToCalendar({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId, publicUrl }).catch((error) => {
        console.error("[miniblog] calendar sync failed", post.id, error);
        return "skipped" as const;
      });
      if (synced === "created") notice += " Added to the Calendar.";
      if (synced === "updated") notice += " Calendar issue updated.";
    }
    after(() => teachPost({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId }));
  }
  redirect(withMessage(back, "notice", notice));
}

export async function deletePost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const postId = text(formData, "postId", 40);
  const ctx = await miniblogAction(`/mini-blog/${siteId}`, "miniblog.write");
  const site = await ownSite(ctx, siteId);
  if (!UUID_RE.test(postId)) redirect(`/mini-blog/${site.id}`);
  await tenantDb(ctx.resolved.id).textPost.updateMany({ where: { id: postId, siteId: site.id }, data: { deletedAt: new Date(), slug: `deleted-${postId.slice(0, 8)}-${Date.now().toString(36)}` } });
  await audit(ctx, "miniblog.post.deleted", "text_post", postId);
  redirect(withMessage(`/mini-blog/${site.id}`, "notice", "Post deleted."));
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
