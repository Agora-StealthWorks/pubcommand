"use server";

import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { fromDay, isDay } from "../../../../../modules/editorial/dates";
import { acceptOption, type OptionLists } from "../../../../../modules/editorial/options";
import { nameList, promoChanges, type PromoSnapshot } from "../../../../../modules/editorial/promos";
import { getPickerOptions } from "../pubsetup/read";
import { calendarAction, field, optional, url, UUID, withMessage, type CalendarCtx } from "./context";
import { loadOptions } from "./options";
import { findPromo, logPromoActivity, syncLaunchEvent, teachPromo, type LoadedPromo } from "./promos";

function day(formData: FormData, key: string): string | null {
  const value = field(formData, key, 10);
  return isDay(value) ? value : null;
}

async function promoInput(ctx: CalendarCtx, formData: FormData, options: OptionLists, current: LoadedPromo | null) {
  const picks = await getPickerOptions(ctx.resolved.id, ctx.brand.id);
  const product = field(formData, "product", 40);
  // Publication and editors come from Publication Setup; a value the promo already has is kept.
  const productOk = !product || picks.publications.some((p) => p.code === product) || product === current?.product;
  const gurus = formData.getAll("gurus").map((g) => String(g).trim()).filter((g) => g && (picks.editors.includes(g) || current?.gurus.includes(g)));
  return {
    name: field(formData, "name", 200),
    promoType: optional(formData, "promoType", 60),
    stage: acceptOption("promo.stage", field(formData, "stage", 60), options, current?.stage ?? null, options["promo.stage"][0] ?? "Idea"),
    format: optional(formData, "format", 80),
    product: productOk ? product || null : (current?.product ?? null),
    gurus: [...new Set(gurus)].slice(0, 20),
    writers: nameList(field(formData, "writers", 600)),
    notes: optional(formData, "notes", 10_000),
    targetedDate: day(formData, "targetedDate"),
    launchDate: day(formData, "launchDate"),
    launchEstimated: formData.get("launchEstimated") === "1",
    copyPlatformUrl: url(formData, "copyPlatformUrl"),
    hotlistPageUrl: url(formData, "hotlistPageUrl"),
    promoFileUrl: url(formData, "promoFileUrl"),
  };
}

type PromoInput = Awaited<ReturnType<typeof promoInput>>;

function snapshot(p: PromoInput | LoadedPromo): PromoSnapshot {
  return { name: p.name, stage: p.stage, promoType: p.promoType, format: p.format, product: p.product, writers: p.writers, gurus: p.gurus, launchDate: p.launchDate, launchEstimated: p.launchEstimated, targetedDate: p.targetedDate };
}

function savedLater(ctx: CalendarCtx, promoId: string) {
  after(() => teachPromo({ organizationId: ctx.resolved.id, promoId, actorId: ctx.actorId }));
}

export async function createPromoAction(formData: FormData) {
  const back = "/editorial/promos/new";
  const ctx = await calendarAction("editorial.write", back);
  const options = await loadOptions(ctx.resolved.id, ctx.brand.id);
  const data = await promoInput(ctx, formData, options, null);
  if (!data.name) redirect(withMessage(back, "error", "Give the promo a name."));
  const promo = await tenantDb(ctx.resolved.id).calendarPromo.create({
    data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data, targetedDate: fromDay(data.targetedDate), launchDate: fromDay(data.launchDate), createdById: ctx.actorId, updatedById: ctx.actorId },
    select: { id: true },
  });
  await logPromoActivity(ctx.resolved.id, promo.id, ctx.actorId, [{ kind: "created", toValue: data.stage }]);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.promo.created", targetType: "calendar_promo", targetId: promo.id });
  const launch = await syncLaunchEvent({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, promoId: promo.id, actorId: ctx.actorId, defaultEventStage: options["event.stage"][0] ?? "Idea" });
  savedLater(ctx, promo.id);
  redirect(withMessage(`/editorial/promos/${promo.id}`, "notice", launch ? "Promo saved. Its launch event is on the calendar." : "Promo saved."));
}

async function ownPromo(ctx: CalendarCtx, id: string): Promise<LoadedPromo> {
  const promo = UUID.test(id) ? await findPromo(ctx.resolved.id, ctx.brand.id, id) : null;
  if (!promo) redirect(withMessage("/editorial/promos", "error", "That promo no longer exists."));
  return promo;
}

export async function updatePromoAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/promos");
  const before = await ownPromo(ctx, field(formData, "promoId", 40));
  const back = `/editorial/promos/${before.id}/edit`;
  const options = await loadOptions(ctx.resolved.id, ctx.brand.id);
  const data = await promoInput(ctx, formData, options, before);
  if (!data.name) redirect(withMessage(back, "error", "Give the promo a name."));
  await tenantDb(ctx.resolved.id).calendarPromo.updateMany({
    where: { id: before.id },
    data: { ...data, targetedDate: fromDay(data.targetedDate), launchDate: fromDay(data.launchDate), updatedById: ctx.actorId },
  });
  const changes = promoChanges(snapshot(before), snapshot(data));
  await logPromoActivity(ctx.resolved.id, before.id, ctx.actorId, changes);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.promo.updated", targetType: "calendar_promo", targetId: before.id, metadata: { changed: changes.map((c) => c.field) } });
  const launch = await syncLaunchEvent({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, promoId: before.id, actorId: ctx.actorId, defaultEventStage: options["event.stage"][0] ?? "Idea" });
  savedLater(ctx, before.id);
  redirect(withMessage(`/editorial/promos/${before.id}`, "notice", launch ? "Saved. Its launch event is on the calendar." : "Saved."));
}

/** Move a promo to another stage (the board's quick control). */
export async function movePromoStageAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/promos");
  const before = await ownPromo(ctx, field(formData, "promoId", 40));
  const back = field(formData, "back", 20) === "detail" ? `/editorial/promos/${before.id}` : "/editorial/promos";
  const options = await loadOptions(ctx.resolved.id, ctx.brand.id);
  const wanted = field(formData, "stage", 60);
  if (!options["promo.stage"].includes(wanted) && wanted !== before.stage) redirect(withMessage(back, "error", "Pick a stage from the list."));
  if (wanted !== before.stage) {
    await tenantDb(ctx.resolved.id).calendarPromo.updateMany({ where: { id: before.id }, data: { stage: wanted, updatedById: ctx.actorId } });
    await logPromoActivity(ctx.resolved.id, before.id, ctx.actorId, [{ kind: "stage", field: "Stage", fromValue: before.stage, toValue: wanted }]);
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.promo.stage", targetType: "calendar_promo", targetId: before.id, metadata: { from: before.stage, to: wanted } });
    await syncLaunchEvent({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, promoId: before.id, actorId: ctx.actorId, defaultEventStage: options["event.stage"][0] ?? "Idea" });
    savedLater(ctx, before.id);
  }
  redirect(withMessage(back, "notice", `${before.name}: ${wanted}.`));
}

export async function deletePromoAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/promos");
  const promo = await ownPromo(ctx, field(formData, "promoId", 40));
  await tenantDb(ctx.resolved.id).calendarPromo.updateMany({ where: { id: promo.id }, data: { deletedAt: new Date(), updatedById: ctx.actorId } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.promo.deleted", targetType: "calendar_promo", targetId: promo.id });
  redirect(withMessage("/editorial/promos", "notice", `${promo.name} deleted. Events and issues keep their dates; their promo link is hidden.`));
}
