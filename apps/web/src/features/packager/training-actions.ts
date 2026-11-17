"use server";

import { brandProfile } from "@pubcommand/core";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { componentSpec } from "../../../../../modules/promo-studio/packager";
import { parseTags } from "../../../../../modules/promo-studio/training";
import { promoAction } from "../promos/guard";
import { syncBestPerformers } from "./training";

const LIB = "/promo-studio/training";
const field = (formData: FormData, key: string, max = 300) => String(formData.get(key) ?? "").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function go(kind: "notice" | "error", message: string, extra = ""): never {
  redirect(`${LIB}?${kind}=${encodeURIComponent(message)}${extra}`);
}

async function ownExample(ctx: Awaited<ReturnType<typeof promoAction>>, id: string) {
  if (!UUID.test(id)) go("error", "That example no longer exists.");
  const example = await tenantDb(ctx.resolved.id).promoTrainingExample.findFirst({ where: { id, brandId: ctx.brand.id } });
  if (!example) go("error", "That example no longer exists.");
  return example;
}

/** Add an example by hand, or edit one (an edited example is never refreshed automatically). */
export async function saveExample(formData: FormData) {
  const ctx = await promoAction("promo.write", LIB);
  const id = field(formData, "exampleId", 40);
  const kind = field(formData, "kind", 60);
  if (!componentSpec(kind)) go("error", "Pick the component type this example teaches.");
  const title = field(formData, "title", 200);
  const content = String(formData.get("content") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 60000);
  if (!title || content.length < 20) go("error", "An example needs a title and the copy itself.");
  const data = {
    kind,
    title,
    content,
    publication: field(formData, "publication", 120) || null,
    tags: parseTags(field(formData, "tags", 400)),
    note: field(formData, "note", 500) || null,
  };
  const db = tenantDb(ctx.resolved.id);
  if (id) {
    const example = await ownExample(ctx, id);
    await db.promoTrainingExample.updateMany({ where: { id: example.id }, data: { ...data, edited: true } });
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "packager.example.updated", targetType: "promo_training_example", targetId: example.id });
    go("notice", "Example saved. Automatic refreshes will leave your edits alone.", `&kind=${kind}`);
  }
  const created = await db.promoTrainingExample.create({
    data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data, niche: brandProfile(ctx.brand).niche, source: "manual", edited: true, createdById: ctx.auth.user.id },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "packager.example.created", targetType: "promo_training_example", targetId: created.id });
  go("notice", "Example added. New packages use it for this component type.", `&kind=${kind}`);
}

export async function toggleExample(formData: FormData) {
  const ctx = await promoAction("promo.write", LIB);
  const example = await ownExample(ctx, field(formData, "exampleId", 40));
  await tenantDb(ctx.resolved.id).promoTrainingExample.updateMany({ where: { id: example.id }, data: { enabled: !example.enabled } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: example.enabled ? "packager.example.disabled" : "packager.example.enabled", targetType: "promo_training_example", targetId: example.id });
  const kind = field(formData, "back", 60);
  redirect(`${LIB}${kind ? `?kind=${encodeURIComponent(kind)}` : ""}#ex-${example.id}`);
}

export async function deleteExample(formData: FormData) {
  const ctx = await promoAction("promo.write", LIB);
  const example = await ownExample(ctx, field(formData, "exampleId", 40));
  await tenantDb(ctx.resolved.id).promoTrainingExample.deleteMany({ where: { id: example.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "packager.example.deleted", targetType: "promo_training_example", targetId: example.id });
  go("notice", example.source === "manual" ? "Example deleted." : "Example deleted. It comes back only if its component is approved again.");
}

export async function syncBestPerformerExamples() {
  const ctx = await promoAction("promo.write", LIB);
  const result = await syncBestPerformers({ organizationId: ctx.resolved.id, brand: ctx.brand, actorId: ctx.auth.user.id });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "packager.examples.synced", targetType: "brand", targetId: ctx.brand.id, metadata: result });
  go("notice", `Best performers: ${result.added} added, ${result.updated} refreshed${result.retired ? `, ${result.retired} switched off (no longer best performers)` : ""}.`);
}
