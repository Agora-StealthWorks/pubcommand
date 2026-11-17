"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { RESERVED_POST_SLUGS, checkSite, isValidSlug, normalizeSlug } from "../../../../../modules/funnels/checks";
import { teachPost } from "./brain";
import { syncPostToCalendar } from "./calendar";
import { UUID_RE, orgTimezone } from "./data";
import { bool, color, int, optional, storeImage, text, url, zoned } from "./form-input";
import { funnelsAction, orgPublicUrl, withMessage, type FunnelsCtx } from "./guard";
import { richFromInput } from "./sanitize";

function audit(ctx: FunnelsCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, metadata });
}

async function ownSite(ctx: FunnelsCtx, siteId: string) {
  const site = UUID_RE.test(siteId) ? await tenantDb(ctx.resolved.id).textSite.findFirst({ where: { id: siteId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!site) redirect(withMessage("/funnels/text", "error", "That site no longer exists."));
  return site;
}

async function uniqueSiteSlug(organizationId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = normalizeSlug(wanted) || "texts";
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
  const ctx = await funnelsAction("/funnels/text", "funnels.write");
  const name = text(formData, "name", 120) || "Text alerts";
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
  await audit(ctx, "funnels.site.created", "text_site", site.id);
  redirect(`/funnels/text/${site.id}?tab=settings`);
}

export async function saveSite(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const back = `/funnels/text/${siteId}?tab=settings`;
  const ctx = await funnelsAction(back, "funnels.write");
  const site = await ownSite(ctx, siteId);
  const wanted = normalizeSlug(text(formData, "slug", 80));
  if (!isValidSlug(wanted)) redirect(withMessage(back, "error", "The link name must be lowercase letters, numbers and dashes."));
  const logo = await storeImage(ctx.resolved.id, site.id, "logo", formData.get("logo"));
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
  await audit(ctx, "funnels.site.updated", "text_site", site.id);
  redirect(withMessage(back, "notice", "Saved."));
}

export async function setSiteStatus(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const back = `/funnels/text/${siteId}?tab=settings`;
  const ctx = await funnelsAction(back, "funnels.publish");
  const site = await ownSite(ctx, siteId);
  const live = text(formData, "intent", 20) === "live";
  if (live) {
    const result = checkSite(site);
    if (result.errors.length) redirect(withMessage(back, "error", `Fix ${result.errors.length === 1 ? "this" : "these"} first: ${result.errors.join(" ")}`));
  }
  await tenantDb(ctx.resolved.id).textSite.updateMany({ where: { id: site.id }, data: { status: live ? "live" : "draft" } });
  await audit(ctx, live ? "funnels.site.published" : "funnels.site.unpublished", "text_site", site.id);
  redirect(withMessage(back, "notice", live ? "The site is live." : "The site is offline. Its links now show “not found”."));
}

export async function deleteSite(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const ctx = await funnelsAction(`/funnels/text/${siteId}?tab=settings`, "funnels.publish");
  const site = await ownSite(ctx, siteId);
  if (text(formData, "confirm", 200) !== site.name) redirect(withMessage(`/funnels/text/${site.id}?tab=settings`, "error", "Type the site name exactly to delete it."));
  await tenantDb(ctx.resolved.id).textSite.updateMany({ where: { id: site.id }, data: { deletedAt: new Date(), status: "draft", slug: `${site.slug.slice(0, 40)}-deleted-${Date.now().toString(36)}` } });
  await audit(ctx, "funnels.site.deleted", "text_site", site.id);
  redirect(withMessage("/funnels/text", "notice", "Site deleted. Its opt-in records are kept."));
}

export async function createPost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const ctx = await funnelsAction(`/funnels/text/${siteId}`, "funnels.write");
  const site = await ownSite(ctx, siteId);
  const title = text(formData, "title", 200) || "Untitled post";
  const post = await tenantDb(ctx.resolved.id).textPost.create({
    data: { organizationId: ctx.resolved.id, siteId: site.id, title, slug: await uniquePostSlug(ctx.resolved.id, site.id, title), createdById: ctx.actorId },
  });
  await audit(ctx, "funnels.post.created", "text_post", post.id);
  redirect(`/funnels/text/${site.id}/posts/${post.id}`);
}

export async function savePost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const postId = text(formData, "postId", 40);
  const back = `/funnels/text/${siteId}/posts/${postId}`;
  const intent = text(formData, "intent", 20);
  const publishing = intent === "publish";
  const ctx = await funnelsAction(back, publishing || intent === "unpublish" ? "funnels.publish" : "funnels.write");
  const site = await ownSite(ctx, siteId);
  const db = tenantDb(ctx.resolved.id);
  const post = UUID_RE.test(postId) ? await db.textPost.findFirst({ where: { id: postId, siteId: site.id, deletedAt: null } }) : null;
  if (!post) redirect(withMessage(`/funnels/text/${site.id}`, "error", "That post no longer exists."));
  const timeZone = await orgTimezone(ctx.resolved.id);
  const title = text(formData, "title", 200) || post.title;
  const slug = await uniquePostSlug(ctx.resolved.id, site.id, text(formData, "slug", 80) || title, post.id);
  const publishAt = zoned(formData, "publishAt", timeZone) ?? post.publishAt;
  const status = publishing ? "published" : intent === "unpublish" ? "draft" : post.status;
  const buttonText = optional(formData, "buttonText", 60);
  const buttonUrl = url(formData, "buttonUrl");
  await db.textPost.updateMany({
    where: { id: post.id },
    data: {
      title,
      slug,
      publishAt,
      status,
      bodyHtml: richFromInput(text(formData, "bodyHtml", 100_000)),
      actionToTake: optional(formData, "actionToTake", 1000),
      buttonText: buttonText && buttonUrl ? buttonText : null,
      buttonUrl: buttonText && buttonUrl ? buttonUrl : null,
    },
  });
  await audit(ctx, publishing ? "funnels.post.published" : intent === "unpublish" ? "funnels.post.unpublished" : "funnels.post.updated", "text_post", post.id);
  let notice = intent === "unpublish" ? "Moved back to draft." : "Saved.";
  if (status === "published") {
    notice = publishAt > new Date() ? (publishing ? "Scheduled. It goes live at the publish time." : "Saved. Still scheduled.") : publishing ? "Published." : "Saved.";
    const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, `/t/${site.slug}/${slug}`);
    if (ctx.subject.entitledModuleIds.includes("editorial")) {
      const synced = await syncPostToCalendar({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId, publicUrl }).catch((error) => {
        console.error("[funnels] calendar sync failed", post.id, error);
        return "skipped" as const;
      });
      if (synced === "created") notice += " Added to the Marketing Calendar.";
      if (synced === "updated") notice += " Marketing Calendar issue updated.";
    }
    after(() => teachPost({ organizationId: ctx.resolved.id, postId: post.id, actorId: ctx.actorId }));
  }
  redirect(withMessage(back, "notice", notice));
}

export async function deletePost(formData: FormData) {
  const siteId = text(formData, "siteId", 40);
  const postId = text(formData, "postId", 40);
  const ctx = await funnelsAction(`/funnels/text/${siteId}`, "funnels.write");
  const site = await ownSite(ctx, siteId);
  if (!UUID_RE.test(postId)) redirect(`/funnels/text/${site.id}`);
  await tenantDb(ctx.resolved.id).textPost.updateMany({ where: { id: postId, siteId: site.id }, data: { deletedAt: new Date(), slug: `deleted-${postId.slice(0, 8)}-${Date.now().toString(36)}` } });
  await audit(ctx, "funnels.post.deleted", "text_post", postId);
  redirect(withMessage(`/funnels/text/${site.id}`, "notice", "Post deleted."));
}
