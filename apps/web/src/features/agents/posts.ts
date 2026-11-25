import { agentPublishOutcome, buildSiteUrl } from "@pubcommand/core";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { rootDomain } from "@/lib/auth";
import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";
import { miniBlogPath } from "../../../../../modules/miniblog/paths";
import { RESERVED_POST_SLUGS, normalizeSlug as miniSlug } from "../../../../../modules/miniblog/site";
import { excerptFrom, isAccessLevel, isContentType, normalizeSlug, safePostSlug, statusForSave, teaserHtml } from "../../../../../modules/websites/content";
import { teachPost } from "../miniblog/brain";
import { syncPostToCalendar } from "../miniblog/calendar";
import { syncPostLinks } from "../miniblog/links";
import { richFromInput } from "../miniblog/sanitize";
import { notifyExternalSite } from "../websites/api";
import { siteEditors } from "../websites/data";
import { agentSettings } from "./data";

/**
 * Writing posts for AI agents (MCP tools) and approving their posts (AI Agents → Approvals).
 * Same rules as the editors: sanitized HTML, unique slugs, audit entries, public cache refresh.
 * An agent's "publish" becomes "pending" when the organization turned off
 * "Allow publishing by AI agents" (or the agent has no publish right).
 */

export class PostError extends Error {}

// ── Websites ────────────────────────────────────────────────────────────────

async function uniqueWebSlug(organizationId: string, siteId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = safePostSlug(wanted);
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.webPost.count({ where: { siteId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 74)}-${n}`;
  return slug;
}

function refreshWebsite(organizationId: string, site: { id: string; slug: string }) {
  revalidatePath(`/sites/public/[slug]/w/${site.slug}`, "layout");
  after(() => notifyExternalSite(organizationId, site.id));
}

export type WebPostInput = {
  postId?: string | null;
  siteId: string;
  kind?: "post" | "page";
  title?: string;
  bodyHtml?: string;
  excerpt?: string;
  slug?: string;
  /** draft | publish | schedule | pending (unpublish is "draft" on a live post) */
  intent: "draft" | "publish" | "schedule" | "pending" | "save";
  publishAt?: Date | null;
  access?: string;
  contentType?: string;
  authorEditorId?: string | null;
  authorName?: string;
  tags?: string[];
  categories?: string[];
  seoTitle?: string;
  seoDescription?: string;
  featured?: boolean;
};

/** Create or update a website post as an agent. `canPublish` is the agent's websites.publish right. */
export async function saveWebPostAsAgent(input: {
  organizationId: string;
  brandId: string;
  actorId: string;
  canPublish: boolean;
  post: WebPostInput;
}): Promise<{ id: string; status: string; slug: string; heldForApproval: boolean }> {
  const { organizationId, brandId, actorId, post: wanted } = input;
  const db = tenantDb(organizationId);
  const site = await db.webSite.findFirst({ where: { id: wanted.siteId, brandId, deletedAt: null } });
  if (!site) throw new PostError("That website does not exist in this brand.");
  const existing = wanted.postId ? await db.webPost.findFirst({ where: { id: wanted.postId, siteId: site.id, deletedAt: null } }) : null;
  if (wanted.postId && !existing) throw new PostError("That post does not exist on this website.");

  const { allowPublishing } = await agentSettings(organizationId);
  const mayPublish = agentPublishOutcome({ allowPublishing, canPublish: input.canPublish }) === "publish";
  const wasLive = existing?.status === "published" || existing?.status === "scheduled";
  if (wasLive && !mayPublish) {
    throw new PostError(
      input.canPublish ? "This organization holds AI agent posts for approval, so agents cannot change a live post." : "You do not have publish rights, so you cannot change a live post.",
    );
  }
  const now = new Date();
  let next: { status: string; publishedAt: Date | null };
  if (wanted.intent === "save") next = { status: existing?.status ?? "draft", publishedAt: wanted.publishAt ?? existing?.publishedAt ?? null };
  else next = statusForSave({ wanted: wanted.intent, publishAt: wanted.publishAt ?? null, canPublish: mayPublish, now });
  if (next.status === "published" && !next.publishedAt) next.publishedAt = now;
  if (next.status === "scheduled" && (!next.publishedAt || next.publishedAt <= now)) next = { status: "published", publishedAt: next.publishedAt ?? now };
  const heldForApproval = (wanted.intent === "publish" || wanted.intent === "schedule") && next.status === "pending";

  const title = (wanted.title ?? existing?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "Untitled";
  const bodyHtml = wanted.bodyHtml !== undefined ? sanitizeRichText(wanted.bodyHtml, 400_000) : (existing?.bodyHtml ?? "");
  const kind = existing ? (existing.kind as "post" | "page") : wanted.kind === "page" ? "page" : "post";
  const access = wanted.access !== undefined ? (isAccessLevel(wanted.access) ? wanted.access : "public") : (existing?.access ?? "public");
  const contentType = kind === "page" ? "article" : wanted.contentType !== undefined ? (isContentType(wanted.contentType) ? wanted.contentType : "article") : (existing?.contentType ?? "article");
  const teaserBlocks = existing?.teaserBlocks ?? 2;
  const editorId = wanted.authorEditorId === undefined ? existing?.authorEditorId ?? null : wanted.authorEditorId;
  const editor = editorId ? (await siteEditors(organizationId, brandId)).find((item) => item.id === editorId) : undefined;
  if (editorId && !editor) throw new PostError("That editor (author_editor_id) does not exist in this brand. Call list_editors.");
  const slug = await uniqueWebSlug(organizationId, site.id, wanted.slug || (existing ? existing.slug : title), existing?.id);
  const excerpt =
    wanted.excerpt !== undefined
      ? wanted.excerpt.trim().slice(0, 600)
      : existing?.excerpt || excerptFrom(access !== "public" ? teaserHtml(bodyHtml, Math.max(1, teaserBlocks)) : bodyHtml, 220);

  const data = {
    kind,
    title,
    slug,
    excerpt,
    bodyHtml,
    status: next.status,
    publishedAt: next.publishedAt,
    contentType,
    access,
    teaserBlocks,
    authorEditorId: editor?.id ?? null,
    authorName: (wanted.authorName ?? (wanted.authorEditorId !== undefined ? "" : existing?.authorName ?? "")).trim().slice(0, 120) || editor?.name || "",
    featured: wanted.featured ?? existing?.featured ?? false,
    seoTitle: (wanted.seoTitle ?? existing?.seoTitle ?? "").slice(0, 120),
    seoDescription: (wanted.seoDescription ?? existing?.seoDescription ?? "").slice(0, 300),
    updatedById: actorId,
  };
  let id = existing?.id;
  if (existing) await db.webPost.updateMany({ where: { id: existing.id }, data });
  else id = (await db.webPost.create({ data: { ...data, organizationId, siteId: site.id, createdById: actorId }, select: { id: true } })).id;

  if (kind === "post" && id && (wanted.tags !== undefined || wanted.categories !== undefined)) {
    const keep = await db.webPostTerm.findMany({ where: { postId: id } });
    const current = await db.webTerm.findMany({ where: { id: { in: keep.map((row) => row.termId) } }, select: { id: true, kind: true } });
    const termIds = new Set<string>();
    // Keep the kind that was not sent.
    for (const term of current) if ((term.kind === "tag" && wanted.tags === undefined) || (term.kind === "category" && wanted.categories === undefined)) termIds.add(term.id);
    if (wanted.categories?.length) {
      const names = wanted.categories.map((name) => name.trim().toLowerCase()).filter(Boolean);
      for (const term of await db.webTerm.findMany({ where: { siteId: site.id, kind: "category" }, select: { id: true, name: true, slug: true } })) {
        if (names.includes(term.name.toLowerCase()) || names.includes(term.slug)) termIds.add(term.id);
      }
    }
    for (const name of [...new Set((wanted.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 30)) {
      const tagSlug = normalizeSlug(name, 60);
      if (!tagSlug) continue;
      const found = await db.webTerm.findFirst({ where: { siteId: site.id, kind: "tag", slug: tagSlug }, select: { id: true } });
      termIds.add((found ?? (await db.webTerm.create({ data: { organizationId, siteId: site.id, kind: "tag", name: name.slice(0, 60), slug: tagSlug }, select: { id: true } }))).id);
    }
    await db.webPostTerm.deleteMany({ where: { postId: id } });
    for (const termId of termIds) await db.webPostTerm.create({ data: { organizationId, postId: id, termId } });
  }

  await appendOrgAudit(organizationId, {
    actorId,
    action: existing ? "websites.post.saved" : "websites.post.created",
    targetType: "web_post",
    targetId: id!,
    metadata: { status: next.status, intent: wanted.intent, via: "ai_agent", ...(heldForApproval ? { heldForApproval: true } : {}) },
  });
  refreshWebsite(organizationId, site);
  return { id: id!, status: next.status, slug, heldForApproval };
}

/** Approve a pending website post: published now, or scheduled for its requested time. */
export async function approveWebPost(input: { organizationId: string; postId: string; actorId: string }): Promise<string> {
  const db = tenantDb(input.organizationId);
  const post = await db.webPost.findFirst({ where: { id: input.postId, status: "pending", deletedAt: null } });
  if (!post) throw new PostError("That post is no longer waiting for approval.");
  const site = await db.webSite.findFirst({ where: { id: post.siteId } });
  if (!site) throw new PostError("That website no longer exists.");
  const now = new Date();
  const next = statusForSave({ wanted: "publish", publishAt: post.publishedAt && post.publishedAt > now ? post.publishedAt : null, canPublish: true, now });
  await db.webPost.updateMany({ where: { id: post.id }, data: { status: next.status, publishedAt: next.publishedAt, updatedById: input.actorId } });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "agents.post.approved", targetType: "web_post", targetId: post.id, metadata: { status: next.status } });
  refreshWebsite(input.organizationId, site);
  return next.status;
}

// ── Mini-Blog ───────────────────────────────────────────────────────────────

async function uniqueTextSlug(organizationId: string, siteId: string, wanted: string, exceptId?: string): Promise<string> {
  let base = miniSlug(wanted) || "post";
  if ((RESERVED_POST_SLUGS as readonly string[]).includes(base)) base = `${base}-post`;
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.textPost.count({ where: { siteId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

function textPostUrl(host: string, orgSlug: string, siteSlug: string, postSlug: string) {
  return buildSiteUrl({ rootDomain: rootDomain(), requestHost: host, site: { kind: "org", slug: orgSlug }, pathname: miniBlogPath(siteSlug, postSlug) });
}

/** After a Mini-Blog post goes live: tracked links were synced on save; Calendar issue and Brain, as in the editor. */
async function afterTextPublish(input: { organizationId: string; orgSlug: string; host: string; postId: string; actorId: string; siteSlug: string; slug: string; editorialEntitled: boolean }) {
  if (input.editorialEntitled) {
    await syncPostToCalendar({ organizationId: input.organizationId, postId: input.postId, actorId: input.actorId, publicUrl: textPostUrl(input.host, input.orgSlug, input.siteSlug, input.slug) }).catch((error) =>
      console.error("[agents] calendar sync failed", input.postId, error),
    );
  }
  after(() => teachPost({ organizationId: input.organizationId, postId: input.postId, actorId: input.actorId }));
}

export type TextPostInput = {
  postId?: string | null;
  siteId: string;
  title?: string;
  bodyHtml?: string;
  slug?: string;
  intent: "draft" | "publish" | "save";
  publishAt?: Date | null;
  actionToTake?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
};

export async function saveTextPostAsAgent(input: {
  organizationId: string;
  orgSlug: string;
  host: string;
  brandId: string;
  actorId: string;
  canPublish: boolean;
  editorialEntitled: boolean;
  post: TextPostInput;
}): Promise<{ id: string; status: string; slug: string; heldForApproval: boolean }> {
  const { organizationId, brandId, actorId, post: wanted } = input;
  const db = tenantDb(organizationId);
  const site = await db.textSite.findFirst({ where: { id: wanted.siteId, brandId, deletedAt: null } });
  if (!site) throw new PostError("That Mini-Blog does not exist in this brand.");
  const existing = wanted.postId ? await db.textPost.findFirst({ where: { id: wanted.postId, siteId: site.id, deletedAt: null } }) : null;
  if (wanted.postId && !existing) throw new PostError("That post does not exist on this Mini-Blog.");
  const { allowPublishing } = await agentSettings(organizationId);
  const mayPublish = agentPublishOutcome({ allowPublishing, canPublish: input.canPublish }) === "publish";
  if (existing?.status === "published" && !mayPublish) {
    throw new PostError(input.canPublish ? "This organization holds AI agent posts for approval, so agents cannot change a live post." : "You do not have publish rights, so you cannot change a live post.");
  }
  const status = wanted.intent === "publish" ? (mayPublish ? "published" : "pending") : wanted.intent === "draft" ? "draft" : (existing?.status ?? "draft");
  const title = (wanted.title ?? existing?.title ?? "").trim().slice(0, 200) || "Untitled post";
  const slug = await uniqueTextSlug(organizationId, site.id, wanted.slug || (existing ? existing.slug : title), existing?.id);
  const bodyHtml = wanted.bodyHtml !== undefined ? richFromInput(wanted.bodyHtml.slice(0, 100_000)) : (existing?.bodyHtml ?? "");
  const buttonText = wanted.buttonText !== undefined ? (wanted.buttonText?.trim().slice(0, 60) || null) : (existing?.buttonText ?? null);
  let buttonUrl = wanted.buttonUrl !== undefined ? (wanted.buttonUrl?.trim().slice(0, 1000) || null) : (existing?.buttonUrl ?? null);
  if (buttonUrl && !/^https?:\/\//i.test(buttonUrl)) buttonUrl = null;
  const data = {
    title,
    slug,
    status,
    publishAt: wanted.publishAt ?? existing?.publishAt ?? new Date(),
    bodyHtml,
    actionToTake: wanted.actionToTake !== undefined ? (wanted.actionToTake?.trim().slice(0, 1000) || null) : (existing?.actionToTake ?? null),
    buttonText: buttonText && buttonUrl ? buttonText : null,
    buttonUrl: buttonText && buttonUrl ? buttonUrl : null,
  };
  let id = existing?.id;
  if (existing) await db.textPost.updateMany({ where: { id: existing.id }, data });
  else id = (await db.textPost.create({ data: { ...data, organizationId, siteId: site.id, createdById: actorId }, select: { id: true } })).id;
  await syncPostLinks(organizationId, { id: id!, siteId: site.id, bodyHtml, buttonUrl: data.buttonUrl, buttonText: data.buttonText }).catch((error: unknown) => console.error("[agents] link sync failed", id, error));
  const heldForApproval = wanted.intent === "publish" && status === "pending";
  await appendOrgAudit(organizationId, {
    actorId,
    action: existing ? (status === "published" && existing.status !== "published" ? "miniblog.post.published" : "miniblog.post.updated") : "miniblog.post.created",
    targetType: "text_post",
    targetId: id!,
    metadata: { status, via: "ai_agent", ...(heldForApproval ? { heldForApproval: true } : {}) },
  });
  if (status === "published") {
    await afterTextPublish({ organizationId, orgSlug: input.orgSlug, host: input.host, postId: id!, actorId, siteSlug: site.slug, slug, editorialEntitled: input.editorialEntitled });
  }
  return { id: id!, status, slug, heldForApproval };
}

export async function approveTextPost(input: { organizationId: string; orgSlug: string; host: string; postId: string; actorId: string; editorialEntitled: boolean }): Promise<string> {
  const db = tenantDb(input.organizationId);
  const post = await db.textPost.findFirst({ where: { id: input.postId, status: "pending", deletedAt: null } });
  if (!post) throw new PostError("That post is no longer waiting for approval.");
  const site = await db.textSite.findFirst({ where: { id: post.siteId } });
  if (!site) throw new PostError("That Mini-Blog no longer exists.");
  await db.textPost.updateMany({ where: { id: post.id }, data: { status: "published" } });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "agents.post.approved", targetType: "text_post", targetId: post.id });
  await afterTextPublish({ organizationId: input.organizationId, orgSlug: input.orgSlug, host: input.host, postId: post.id, actorId: input.actorId, siteSlug: site.slug, slug: post.slug, editorialEntitled: input.editorialEntitled });
  return post.publishAt > new Date() ? "scheduled" : "published";
}

/** Send a pending post back to draft (website or Mini-Blog). */
export async function rejectPendingPost(input: { organizationId: string; kind: "web" | "text"; postId: string; actorId: string; note?: string }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const result =
    input.kind === "web"
      ? await db.webPost.updateMany({ where: { id: input.postId, status: "pending" }, data: { status: "draft", updatedById: input.actorId } })
      : await db.textPost.updateMany({ where: { id: input.postId, status: "pending" }, data: { status: "draft" } });
  if (result.count === 0) throw new PostError("That post is no longer waiting for approval.");
  await appendOrgAudit(input.organizationId, {
    actorId: input.actorId,
    action: "agents.post.returned",
    targetType: input.kind === "web" ? "web_post" : "text_post",
    targetId: input.postId,
    metadata: input.note ? { note: input.note.slice(0, 500) } : undefined,
  });
}
