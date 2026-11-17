"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { isHttpUrl, isValidSlug, normalizeSlug } from "../../../../../modules/funnels/checks";
import { designAssetIds, normalizeDesign, remapDesignAssets } from "../../../../../modules/funnels/design";
import { NAV_KINDS, RESERVED_PAGE_SLUGS, TITLE_PLACEMENTS, moveItem } from "../../../../../modules/funnels/nav";
import { teachFunnel } from "./brain";
import { UUID_RE } from "./data";
import { bool, optional, optionalInt, pickOne, storeImage, text, url } from "./form-input";
import { funnelAction, funnelWriteCtx, withMessage, type FunnelsCtx } from "./guard";
import { richFromInput, sanitizeRich } from "./sanitize";
import { parseDesignDraft, parseHomeDraft } from "./site-data";
import { ownSmsFormId } from "./sms-data";

type Result = { ok: true } | { ok: false; error: string };

/** "No draft" is stored as an empty object (see `hasDraft`): Prisma.DbNull does not survive the tenant client. */
const NO_DRAFT: Prisma.InputJsonValue = {};

function audit(organizationId: string, actorId: string | null, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(organizationId, { actorId, action, targetType, targetId, metadata });
}

/**
 * Guard for actions the builder calls from the browser (JSON in, result out).
 * Same checks as `funnelAction` (org, entitlement, funnels.write or a delegate
 * of this funnel, brand, own funnel) but it returns an error instead of redirecting.
 */
async function writeAccess(funnelId: string) {
  if (!UUID_RE.test(funnelId)) return { error: "That funnel no longer exists." } as const;
  const ctx = await funnelWriteCtx(funnelId);
  if (!ctx) return { error: "You do not have permission to do that." } as const;
  const funnel = await tenantDb(ctx.resolved.id).funnel.findFirst({ where: { id: funnelId, brandId: ctx.brand.id, deletedAt: null } });
  if (!funnel) return { error: "That funnel no longer exists." } as const;
  return { organizationId: ctx.resolved.id, actorId: ctx.auth.user.id, funnel } as const;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const MAX_PAYLOAD = 400_000;

function tooBig(value: unknown): boolean {
  try {
    return JSON.stringify(value).length > MAX_PAYLOAD;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Home page (block builder)

/** The live preview: store the unsaved home page so the preview iframe can show it. Visitors never see it. */
export async function saveHomeDraft(funnelId: string, payload: unknown): Promise<Result> {
  const access = await writeAccess(funnelId);
  if ("error" in access) return { ok: false, error: access.error ?? "Not allowed." };
  if (tooBig(payload)) return { ok: false, error: "The page is too large to preview." };
  const draft = parseHomeDraft(payload, access.funnel);
  await tenantDb(access.organizationId).funnel.updateMany({ where: { id: access.funnel.id }, data: { homeBlocksDraft: json(draft), updatedAt: access.funnel.updatedAt } });
  return { ok: true };
}

/** Save the home page: blocks (validated, rich text sanitized), the shell option and the browser title. */
export async function saveHomePage(funnelId: string, payload: unknown): Promise<Result> {
  const access = await writeAccess(funnelId);
  if ("error" in access) return { ok: false, error: access.error ?? "Not allowed." };
  if (tooBig(payload)) return { ok: false, error: "The page is too large. Remove some blocks or images." };
  const draft = parseHomeDraft(payload, access.funnel);
  const db = tenantDb(access.organizationId);
  await db.funnel.updateMany({ where: { id: access.funnel.id }, data: { homeBlocks: json(draft.blocks), homeShell: draft.shell, homeTitle: draft.title, homeBlocksDraft: NO_DRAFT } });
  await audit(access.organizationId, access.actorId, "funnels.home.updated", "funnel", access.funnel.id, { blocks: draft.blocks.length });
  if (access.funnel.status === "published") after(() => teachFunnel({ organizationId: access.organizationId, funnelId: access.funnel.id, actorId: access.actorId }));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Design

export async function saveDesignDraft(funnelId: string, payload: unknown): Promise<Result> {
  const access = await writeAccess(funnelId);
  if ("error" in access) return { ok: false, error: access.error ?? "Not allowed." };
  if (tooBig(payload)) return { ok: false, error: "Too large." };
  const draft = parseDesignDraft(payload, access.funnel);
  await tenantDb(access.organizationId).funnel.updateMany({ where: { id: access.funnel.id }, data: { designDraft: json(draft), updatedAt: access.funnel.updatedAt } });
  return { ok: true };
}

/** Save the Design tab: design tokens plus logo, company, legal links, footer text and Forms theme. */
export async function saveDesign(funnelId: string, payload: unknown): Promise<Result> {
  const access = await writeAccess(funnelId);
  if ("error" in access) return { ok: false, error: access.error ?? "Not allowed." };
  if (tooBig(payload)) return { ok: false, error: "Too large." };
  const draft = parseDesignDraft(payload, access.funnel);
  const db = tenantDb(access.organizationId);
  // Only images this funnel owns may be referenced.
  const wanted = [...designAssetIds(draft.design), ...(draft.logoAssetId ? [draft.logoAssetId] : [])];
  const owned = new Set((await db.funnelAsset.findMany({ where: { id: { in: wanted }, ownerId: access.funnel.id }, select: { id: true } })).map((row) => row.id));
  const design = remapDesignAssets(draft.design, (id) => (owned.has(id) ? id : null));
  const theme = draft.formThemeId ? await db.formTheme.findFirst({ where: { id: draft.formThemeId, brandId: access.funnel.brandId, deletedAt: null }, select: { id: true } }) : null;
  await db.funnel.updateMany({
    where: { id: access.funnel.id },
    data: {
      design: json(design),
      designDraft: NO_DRAFT,
      // Keep the flat columns in step (older readers and the Brain use them).
      headerBg: design.header.bg,
      pageBg: design.page.bg,
      textColor: design.page.text,
      accentColor: design.page.accent,
      logoHeight: Math.min(120, design.header.logoHeight),
      logoAssetId: draft.logoAssetId && owned.has(draft.logoAssetId) ? draft.logoAssetId : null,
      logoUrl: draft.logoUrl,
      companyName: draft.companyName,
      privacyUrl: draft.privacyUrl,
      termsUrl: draft.termsUrl,
      footerHtml: sanitizeRich(draft.footerHtml),
      formThemeId: theme?.id ?? null,
    },
  });
  await audit(access.organizationId, access.actorId, "funnels.design.updated", "funnel", access.funnel.id);
  return { ok: true };
}

/** Throw away an unsaved preview draft (the design or the home page). */
export async function discardDrafts(funnelId: string, which: "design" | "home"): Promise<Result> {
  const access = await writeAccess(funnelId);
  if ("error" in access) return { ok: false, error: access.error ?? "Not allowed." };
  await tenantDb(access.organizationId).funnel.updateMany({
    where: { id: access.funnel.id },
    data: { ...(which === "design" ? { designDraft: NO_DRAFT } : { homeBlocksDraft: NO_DRAFT }), updatedAt: access.funnel.updatedAt },
  });
  return { ok: true };
}

const UPLOAD_KINDS = ["logo", "header_bg", "page_bg", "footer_logo", "block", "host", "nav_thumb"] as const;

/** Upload one image for the builder (design images, block images). Returns its id and public address. */
export async function uploadFunnelImage(formData: FormData): Promise<{ ok: true; id: string; src: string } | { ok: false; error: string }> {
  const access = await writeAccess(text(formData, "funnelId", 40));
  if ("error" in access) return { ok: false, error: access.error ?? "Not allowed." };
  const kind = pickOne(formData, "kind", UPLOAD_KINDS, "block");
  const stored = await storeImage(access.organizationId, access.funnel.id, kind === "logo" ? "logo" : "thumb", formData.get("file"));
  if (!stored) return { ok: false, error: "Choose an image first." };
  if ("error" in stored) return { ok: false, error: stored.error };
  if (kind !== "logo") await tenantDb(access.organizationId).funnelAsset.updateMany({ where: { id: stored.id }, data: { kind } });
  await audit(access.organizationId, access.actorId, "funnels.asset.uploaded", "funnel_asset", stored.id, { kind });
  return { ok: true, id: stored.id, src: `/l/${access.funnel.slug}/asset/${stored.id}` };
}

/** Copy the whole design (and its images) from another funnel of this brand. */
export async function copyDesignFrom(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=design`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const db = tenantDb(ctx.resolved.id);
  const sourceId = text(formData, "sourceId", 40);
  const [target, source] = await Promise.all([
    UUID_RE.test(funnelId) ? db.funnel.findFirst({ where: { id: funnelId, brandId: ctx.brand.id, deletedAt: null } }) : null,
    UUID_RE.test(sourceId) ? db.funnel.findFirst({ where: { id: sourceId, brandId: ctx.brand.id, deletedAt: null } }) : null,
  ]);
  if (!target) redirect(withMessage("/funnels", "error", "That funnel no longer exists."));
  if (!source || source.id === target.id) redirect(withMessage(back, "error", "Pick another funnel to copy from."));
  const design = normalizeDesign(source.design, source);
  const ids = [...designAssetIds(design), ...(source.logoAssetId ? [source.logoAssetId] : [])];
  const assets = ids.length ? await db.funnelAsset.findMany({ where: { id: { in: ids }, ownerId: source.id } }) : [];
  const map = new Map<string, string>();
  for (const asset of assets) {
    const copy = await db.funnelAsset.create({
      data: { organizationId: ctx.resolved.id, ownerId: target.id, kind: asset.kind, filename: asset.filename, mimeType: asset.mimeType, size: asset.size, data: asset.data },
      select: { id: true },
    });
    map.set(asset.id, copy.id);
  }
  const copied = remapDesignAssets(design, (id) => map.get(id) ?? null);
  await db.funnel.updateMany({
    where: { id: target.id },
    data: {
      design: json(copied),
      designDraft: NO_DRAFT,
      headerBg: source.headerBg,
      pageBg: source.pageBg,
      textColor: source.textColor,
      accentColor: source.accentColor,
      logoHeight: source.logoHeight,
      logoAssetId: source.logoAssetId ? map.get(source.logoAssetId) ?? null : null,
      logoUrl: source.logoUrl,
      formThemeId: source.formThemeId,
      companyName: source.companyName,
      privacyUrl: source.privacyUrl,
      termsUrl: source.termsUrl,
      footerHtml: sanitizeRich(source.footerHtml),
    },
  });
  await audit(ctx.resolved.id, ctx.actorId, "funnels.design.copied", "funnel", target.id, { from: source.id });
  redirect(withMessage(back, "notice", `Copied the design of “${source.name}”.`));
}

// ---------------------------------------------------------------------------
// Hosts

async function ownFunnel(ctx: FunnelsCtx, funnelId: string, back: string) {
  const funnel = UUID_RE.test(funnelId) ? await tenantDb(ctx.resolved.id).funnel.findFirst({ where: { id: funnelId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!funnel) redirect(withMessage(back.startsWith("/funnels/") ? "/funnels" : back, "error", "That funnel no longer exists."));
  return funnel;
}

export async function addHost(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=hosts`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const count = await db.funnelHost.count({ where: { funnelId: funnel.id } });
  if (count >= 12) redirect(withMessage(back, "error", "A funnel can have at most 12 hosts."));
  const host = await db.funnelHost.create({ data: { organizationId: ctx.resolved.id, funnelId: funnel.id, position: count + 1, name: "New host" } });
  await audit(ctx.resolved.id, ctx.actorId, "funnels.host.created", "funnel_host", host.id);
  redirect(`${back}&host=${host.id}#host-${host.id}`);
}

export async function saveHost(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const hostId = text(formData, "hostId", 40);
  const back = `/funnels/${funnelId}?tab=hosts&host=${hostId}`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const host = UUID_RE.test(hostId) ? await db.funnelHost.findFirst({ where: { id: hostId, funnelId: funnel.id } }) : null;
  if (!host) redirect(withMessage(`/funnels/${funnel.id}?tab=hosts`, "error", "That host no longer exists."));
  const photo = await storeImage(ctx.resolved.id, funnel.id, "thumb", formData.get("photo"));
  if (photo && "error" in photo) redirect(withMessage(back, "error", photo.error));
  if (photo && "id" in photo) await db.funnelAsset.updateMany({ where: { id: photo.id }, data: { kind: "host" } });
  await db.funnelHost.updateMany({
    where: { id: host.id },
    data: {
      name: text(formData, "name", 120),
      title: text(formData, "title", 160),
      bioHtml: richFromInput(text(formData, "bioHtml", 20_000)),
      photoUrl: url(formData, "photoUrl"),
      ...(photo && "id" in photo ? { photoAssetId: photo.id } : bool(formData, "removePhoto") ? { photoAssetId: null } : {}),
    },
  });
  await db.funnel.updateMany({ where: { id: funnel.id }, data: { updatedAt: new Date() } });
  await audit(ctx.resolved.id, ctx.actorId, "funnels.host.updated", "funnel_host", host.id);
  redirect(withMessage(`${back}#host-${host.id}`, "notice", "Host saved."));
}

async function renumberHosts(organizationId: string, funnelId: string, ids: string[]) {
  const db = tenantDb(organizationId);
  for (const [index, id] of ids.entries()) await db.funnelHost.updateMany({ where: { id, funnelId }, data: { position: index + 1 } });
}

export async function moveHost(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=hosts`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const rows = await tenantDb(ctx.resolved.id).funnelHost.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" }, select: { id: true } });
  const hostId = text(formData, "hostId", 40);
  const next = moveItem(rows.map((row) => row.id), hostId, text(formData, "direction", 6) === "up" ? -1 : 1);
  await renumberHosts(ctx.resolved.id, funnel.id, next);
  await audit(ctx.resolved.id, ctx.actorId, "funnels.host.moved", "funnel_host", hostId);
  redirect(back);
}

export async function deleteHost(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=hosts`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const hostId = text(formData, "hostId", 40);
  const db = tenantDb(ctx.resolved.id);
  if (UUID_RE.test(hostId)) {
    const removed = await db.funnelHost.deleteMany({ where: { id: hostId, funnelId: funnel.id } });
    if (removed.count) {
      const rest = await db.funnelHost.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" }, select: { id: true } });
      await renumberHosts(ctx.resolved.id, funnel.id, rest.map((row) => row.id));
      await audit(ctx.resolved.id, ctx.actorId, "funnels.host.deleted", "funnel_host", hostId);
    }
  }
  redirect(withMessage(back, "notice", "Host removed."));
}

// ---------------------------------------------------------------------------
// Pages & links

async function uniquePageSlug(organizationId: string, funnelId: string, wanted: string, exceptId?: string): Promise<string> {
  let base = normalizeSlug(wanted) || "page";
  if ((RESERVED_PAGE_SLUGS as readonly string[]).includes(base)) base = `${base}-page`;
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.funnelNavItem.count({ where: { funnelId, kind: "page", slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

export async function addNavItem(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=pages`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const kind = pickOne(formData, "kind", NAV_KINDS, "page");
  const count = await db.funnelNavItem.count({ where: { funnelId: funnel.id } });
  if (count >= 30) redirect(withMessage(back, "error", "A funnel can have at most 30 pages and links."));
  const label = kind === "page" ? "New page" : kind === "link" ? "New link" : "Coming soon";
  const item = await db.funnelNavItem.create({
    data: {
      organizationId: ctx.resolved.id,
      funnelId: funnel.id,
      kind,
      label,
      title: kind === "page" ? label : "",
      slug: kind === "page" ? await uniquePageSlug(ctx.resolved.id, funnel.id, "new-page") : "",
      sort: count,
      afterModule: null,
    },
  });
  await audit(ctx.resolved.id, ctx.actorId, "funnels.navitem.created", "funnel_nav_item", item.id, { kind });
  redirect(`${back}&item=${item.id}#item-${item.id}`);
}

export async function saveNavItem(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const itemId = text(formData, "itemId", 40);
  const back = `/funnels/${funnelId}?tab=pages&item=${itemId}`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const item = UUID_RE.test(itemId) ? await db.funnelNavItem.findFirst({ where: { id: itemId, funnelId: funnel.id } }) : null;
  if (!item) redirect(withMessage(`/funnels/${funnel.id}?tab=pages`, "error", "That item no longer exists."));
  const thumb = await storeImage(ctx.resolved.id, funnel.id, "thumb", formData.get("thumb"));
  if (thumb && "error" in thumb) redirect(withMessage(back, "error", thumb.error));
  const place = text(formData, "afterModule", 6);
  const data: Prisma.FunnelNavItemUpdateManyMutationInput = {
    label: text(formData, "label", 60),
    afterModule: place === "" ? null : optionalInt(formData, "afterModule", 0, 100),
    showInNav: bool(formData, "showInNav"),
    thumbUrl: url(formData, "thumbUrl"),
    ...(thumb && "id" in thumb ? { thumbAssetId: thumb.id } : bool(formData, "removeThumb") ? { thumbAssetId: null } : {}),
  };
  if (item.kind === "page") {
    const wanted = normalizeSlug(text(formData, "slug", 80));
    if (!isValidSlug(wanted)) redirect(withMessage(back, "error", "The page link name must be lowercase letters, numbers and dashes."));
    const optinMode = pickOne(formData, "optinMode", ["none", "email", "form", "sms"] as const, "none");
    const formSlug = text(formData, "optinFormSlug", 80);
    const form = optinMode === "form" && formSlug ? await db.form.findFirst({ where: { slug: formSlug, brandId: ctx.brand.id, deletedAt: null }, select: { slug: true } }) : null;
    const smsFormId = optinMode === "sms" ? await ownSmsFormId(ctx.resolved.id, funnel.id, text(formData, "smsFormId", 40)) : null;
    Object.assign(data, {
      title: text(formData, "title", 160),
      slug: await uniquePageSlug(ctx.resolved.id, funnel.id, wanted, item.id),
      contentMode: pickOne(formData, "contentMode", ["rich", "html"] as const, "rich"),
      titlePlacement: pickOne(formData, "titlePlacement", TITLE_PLACEMENTS, "outside"),
      bodyHtml: richFromInput(text(formData, "bodyHtml", 100_000)),
      // Raw HTML only ever renders inside a sandboxed iframe.
      html: String(formData.get("html") ?? "").slice(0, 100_000),
      optinMode: optinMode === "sms" && !smsFormId ? "none" : optinMode,
      optinFormSlug: form?.slug ?? null,
      smsFormId,
    });
  } else if (item.kind === "link") {
    const link = text(formData, "url", 1000);
    if (link && !isHttpUrl(link)) redirect(withMessage(back, "error", "The link must be a web address starting with https://."));
    Object.assign(data, { url: link, newTab: bool(formData, "newTab") });
  } else {
    Object.assign(data, {
      title: text(formData, "title", 160),
      showLock: bool(formData, "showLock"),
      faded: bool(formData, "faded"),
      showInAgenda: bool(formData, "showInAgenda"),
      agendaWhen: text(formData, "agendaWhen", 120),
      agendaDesc: optional(formData, "agendaDesc", 600) ?? "",
    });
  }
  await db.funnelNavItem.updateMany({ where: { id: item.id }, data });
  await db.funnel.updateMany({ where: { id: funnel.id }, data: { updatedAt: new Date() } });
  await audit(ctx.resolved.id, ctx.actorId, "funnels.navitem.updated", "funnel_nav_item", item.id);
  if (funnel.status === "published") after(() => teachFunnel({ organizationId: ctx.resolved.id, funnelId: funnel.id, actorId: ctx.actorId }));
  redirect(withMessage(`${back}#item-${item.id}`, "notice", "Saved."));
}

export async function moveNavItem(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=pages`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const db = tenantDb(ctx.resolved.id);
  const rows = await db.funnelNavItem.findMany({ where: { funnelId: funnel.id }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const itemId = text(formData, "itemId", 40);
  const next = moveItem(rows.map((row) => row.id), itemId, text(formData, "direction", 6) === "up" ? -1 : 1);
  for (const [index, id] of next.entries()) await db.funnelNavItem.updateMany({ where: { id, funnelId: funnel.id }, data: { sort: index } });
  await audit(ctx.resolved.id, ctx.actorId, "funnels.navitem.moved", "funnel_nav_item", itemId);
  redirect(back);
}

export async function deleteNavItem(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = `/funnels/${funnelId}?tab=pages`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId, back);
  const itemId = text(formData, "itemId", 40);
  if (UUID_RE.test(itemId)) {
    const removed = await tenantDb(ctx.resolved.id).funnelNavItem.deleteMany({ where: { id: itemId, funnelId: funnel.id } });
    if (removed.count) await audit(ctx.resolved.id, ctx.actorId, "funnels.navitem.deleted", "funnel_nav_item", itemId);
  }
  redirect(withMessage(back, "notice", "Removed."));
}
