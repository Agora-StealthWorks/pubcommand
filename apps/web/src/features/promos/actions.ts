"use server";

import { can } from "@pubcommand/core";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { PROMO_STATUSES, PROMO_TYPES } from "../../../../../modules/promo-studio/analysis";
import { extractSource, runPromoAnalysis } from "./server";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

async function promoContext(permission: "promo.read" | "promo.write") {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!ctx.subject.entitledModuleIds.includes("promo-studio") || !can(ctx.subject, permission, ctx.scope)) {
    redirect("/promo-studio?error=You do not have permission.");
  }
  if (!ctx.brand) redirect("/promo-studio?error=Add a brand in Settings first.");
  return { ...ctx, brand: ctx.brand };
}

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function details(formData: FormData) {
  const promoType = text(formData, "promoType");
  const promoStatus = text(formData, "promoStatus");
  const runStart = text(formData, "runStartDate");
  const price = Number(text(formData, "pricePoint").replace(/[$,]/g, ""));
  return {
    publisher: text(formData, "publisher") || null,
    gurus: text(formData, "gurus", 500).split(",").map((name) => name.trim()).filter(Boolean),
    product: text(formData, "product") || null,
    promoType: (PROMO_TYPES as readonly string[]).includes(promoType) ? promoType : null,
    promoStatus: (PROMO_STATUSES as readonly string[]).includes(promoStatus) ? promoStatus : null,
    promoCode: text(formData, "promoCode", 80) || null,
    runStartDate: /^\d{4}-\d{2}-\d{2}$/.test(runStart) ? new Date(`${runStart}T00:00:00Z`) : null,
    pricePoint: text(formData, "pricePoint") && Number.isFinite(price) && price >= 0 ? price : null,
  };
}

function startAnalysis(ctx: Awaited<ReturnType<typeof promoContext>>, promoId: string) {
  after(() =>
    runPromoAnalysis({
      organizationId: ctx.resolved.id,
      promoId,
      brand: ctx.brand,
      actorId: ctx.auth.user.id,
    }),
  );
}

export async function createPromo(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const file = formData.get("file");
  const upload = file instanceof File && file.size > 0 ? file : null;
  if (upload && upload.size > MAX_FILE_BYTES) redirect("/promo-studio?error=That file is over 50 MB.");
  const source = await extractSource(upload, String(formData.get("pasted") ?? ""));
  if ("error" in source) redirect(`/promo-studio?error=${encodeURIComponent(source.error)}`);
  const title = text(formData, "title", 200) || upload?.name.replace(/\.(docx|pdf|txt|md)$/i, "") || "Untitled promo";
  const db = tenantDb(ctx.resolved.id);
  const promo = await db.promo.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      title,
      filename: source.file?.filename ?? null,
      inputType: source.inputType,
      sourceText: source.text,
      analysisStatus: "QUEUED",
      uploadedById: ctx.auth.user.id,
      ...details(formData),
    },
  });
  if (source.file) {
    await db.promoFile.create({
      data: {
        organizationId: ctx.resolved.id,
        promoId: promo.id,
        kind: "source",
        filename: source.file.filename,
        mimeType: source.file.mimeType,
        size: source.file.data.length,
        data: new Uint8Array(source.file.data),
      },
    });
  }
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.created", targetType: "promo", targetId: promo.id });
  startAnalysis(ctx, promo.id);
  redirect(`/promo-studio/${promo.id}`);
}

async function ownPromo(ctx: Awaited<ReturnType<typeof promoContext>>, promoId: string) {
  const promo = await tenantDb(ctx.resolved.id).promo.findFirst({ where: { id: promoId, deletedAt: null } });
  if (!promo) redirect("/promo-studio?error=That promo no longer exists.");
  return promo;
}

export async function reanalyzePromo(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const promo = await ownPromo(ctx, text(formData, "promoId", 40));
  await tenantDb(ctx.resolved.id).promo.updateMany({ where: { id: promo.id }, data: { analysisStatus: "QUEUED", analysisError: null } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.reanalyzed", targetType: "promo", targetId: promo.id });
  startAnalysis(ctx, promo.id);
  redirect(`/promo-studio/${promo.id}`);
}

export async function updatePromoDetails(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const promo = await ownPromo(ctx, text(formData, "promoId", 40));
  const title = text(formData, "title", 200) || promo.title;
  await tenantDb(ctx.resolved.id).promo.updateMany({ where: { id: promo.id }, data: { title, ...details(formData) } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.updated", targetType: "promo", targetId: promo.id });
  redirect(`/promo-studio/${promo.id}?tab=details&notice=Saved.`);
}

export async function updatePromoTraining(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const promo = await ownPromo(ctx, text(formData, "promoId", 40));
  const score = (key: string) => {
    const value = Number(text(formData, key, 6));
    return text(formData, key, 6) && Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : null;
  };
  await tenantDb(ctx.resolved.id).promo.updateMany({
    where: { id: promo.id },
    data: {
      myScore: score("myScore"),
      performanceScore: score("performanceScore"),
      trainingNotes: text(formData, "trainingNotes", 4000) || null,
      isBestPerformer: formData.get("isBestPerformer") === "on",
    },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.training.updated", targetType: "promo", targetId: promo.id });
  redirect(`/promo-studio/${promo.id}?tab=training&notice=Training saved. Future analyses for this brand use it.`);
}

export async function deletePromo(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const promo = await ownPromo(ctx, text(formData, "promoId", 40));
  await tenantDb(ctx.resolved.id).promo.updateMany({ where: { id: promo.id }, data: { deletedAt: new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.deleted", targetType: "promo", targetId: promo.id });
  redirect("/promo-studio?notice=Promo deleted.");
}

export async function addPromoFile(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const promo = await ownPromo(ctx, text(formData, "promoId", 40));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`/promo-studio/${promo.id}?tab=files&error=Choose a file.`);
  if (file.size > MAX_FILE_BYTES) redirect(`/promo-studio/${promo.id}?tab=files&error=That file is over 50 MB.`);
  await tenantDb(ctx.resolved.id).promoFile.create({
    data: {
      organizationId: ctx.resolved.id,
      promoId: promo.id,
      kind: "supplemental",
      category: text(formData, "category", 60) || null,
      filename: file.name.slice(0, 200),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: new Uint8Array(await file.arrayBuffer()),
    },
  });
  redirect(`/promo-studio/${promo.id}?tab=files&notice=File added.`);
}

export async function removePromoFile(formData: FormData) {
  const ctx = await promoContext("promo.write");
  const promo = await ownPromo(ctx, text(formData, "promoId", 40));
  await tenantDb(ctx.resolved.id).promoFile.deleteMany({ where: { id: text(formData, "fileId", 40), promoId: promo.id, kind: "supplemental" } });
  redirect(`/promo-studio/${promo.id}?tab=files&notice=File removed.`);
}
