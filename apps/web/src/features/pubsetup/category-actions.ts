"use server";

import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { categoryName, findCategory, moveCategory as reorder } from "../../../../../modules/pubsetup/categories";
import { UUID, pubsetupAction, withMessage, type PubsetupCtx } from "./guard";
import { refreshPublication } from "./teach";
import { notifyBrandSites } from "../websites/api";

const BACK = "/settings/publication-setup/categories";

function audit(ctx: PubsetupCtx, action: string, targetId: string, metadata?: Record<string, string | number | null>) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType: "pubsetup_category", targetId, ...(metadata ? { metadata } : {}) });
}

async function brandCategories(ctx: PubsetupCtx) {
  return tenantDb(ctx.resolved.id).pubCategory.findMany({ where: { brandId: ctx.brand.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, sortOrder: true } });
}

async function ownCategory(ctx: PubsetupCtx, id: string) {
  const category = UUID.test(id) ? await tenantDb(ctx.resolved.id).pubCategory.findFirst({ where: { id, brandId: ctx.brand.id }, select: { id: true, name: true } }) : null;
  if (!category) redirect(withMessage(BACK, "error", "That category no longer exists."));
  return category;
}

/** Websites and Brain notes show category names: refresh them after a change. */
function refresh(ctx: PubsetupCtx, publicationIds: string[]) {
  const base = { organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId };
  after(async () => {
    for (const publicationId of publicationIds) await refreshPublication({ ...base, publicationId });
    await notifyBrandSites(base.organizationId, base.brandId);
  });
}

async function publicationsIn(ctx: PubsetupCtx, categoryId: string): Promise<string[]> {
  const rows = await tenantDb(ctx.resolved.id).calendarPublication.findMany({ where: { brandId: ctx.brand.id, categoryId }, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function createCategory(formData: FormData) {
  const ctx = await pubsetupAction(BACK);
  const name = categoryName(formData.get("name"));
  if (!name) redirect(withMessage(BACK, "error", "Give the category a name (up to 60 characters)."));
  const existing = await brandCategories(ctx);
  const clash = findCategory(existing, name);
  if (clash) redirect(withMessage(BACK, "error", `There is already a category called ${clash.name}.`));
  if (existing.length >= 100) redirect(withMessage(BACK, "error", "Up to 100 categories."));
  const sortOrder = (existing.reduce((max, category) => Math.max(max, category.sortOrder), 0) || 0) + 10;
  const created = await tenantDb(ctx.resolved.id).pubCategory.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, name, sortOrder }, select: { id: true } });
  await audit(ctx, "pubsetup.category.created", created.id, { name });
  redirect(withMessage(BACK, "notice", `${name} added.`));
}

export async function renameCategory(formData: FormData) {
  const ctx = await pubsetupAction(BACK);
  const category = await ownCategory(ctx, String(formData.get("categoryId") ?? ""));
  const name = categoryName(formData.get("name"));
  if (!name) redirect(withMessage(BACK, "error", "Give the category a name (up to 60 characters)."));
  const clash = findCategory((await brandCategories(ctx)).filter((other) => other.id !== category.id), name);
  if (clash) redirect(withMessage(BACK, "error", `There is already a category called ${clash.name}.`));
  if (name === category.name) redirect(BACK);
  await tenantDb(ctx.resolved.id).pubCategory.updateMany({ where: { id: category.id }, data: { name } });
  await audit(ctx, "pubsetup.category.renamed", category.id, { from: category.name, to: name });
  refresh(ctx, await publicationsIn(ctx, category.id));
  redirect(withMessage(BACK, "notice", `Renamed to ${name}.`));
}

export async function moveCategory(formData: FormData) {
  const ctx = await pubsetupAction(BACK);
  const category = await ownCategory(ctx, String(formData.get("categoryId") ?? ""));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  const db = tenantDb(ctx.resolved.id);
  const order = reorder(await brandCategories(ctx), category.id, direction);
  for (const row of order) await db.pubCategory.updateMany({ where: { id: row.id, brandId: ctx.brand.id }, data: { sortOrder: row.sortOrder } });
  await audit(ctx, "pubsetup.category.moved", category.id, { direction });
  refresh(ctx, []);
  redirect(BACK);
}

/** Delete a category. Its publications move to another category, or become uncategorized. */
export async function deleteCategory(formData: FormData) {
  const ctx = await pubsetupAction(BACK);
  const category = await ownCategory(ctx, String(formData.get("categoryId") ?? ""));
  const db = tenantDb(ctx.resolved.id);
  const moveTo = String(formData.get("moveTo") ?? "none");
  const target = moveTo !== "none" ? await ownCategory(ctx, moveTo) : null;
  if (target?.id === category.id) redirect(withMessage(BACK, "error", "Pick a different category to move them to."));
  const pubs = await publicationsIn(ctx, category.id);
  if (pubs.length) await db.calendarPublication.updateMany({ where: { brandId: ctx.brand.id, categoryId: category.id }, data: { categoryId: target?.id ?? null, updatedById: ctx.actorId } });
  await db.pubCategory.deleteMany({ where: { id: category.id, brandId: ctx.brand.id } });
  await audit(ctx, "pubsetup.category.deleted", category.id, { name: category.name, moved: pubs.length, to: target?.name ?? null });
  refresh(ctx, pubs);
  const moved = pubs.length ? (target ? ` ${pubs.length} moved to ${target.name}.` : ` ${pubs.length} now uncategorized.`) : "";
  redirect(withMessage(BACK, "notice", `${category.name} deleted.${moved}`));
}
