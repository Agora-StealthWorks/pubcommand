import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { runPromoAnalysis } from "../promos/server";
import type { IntelBrand } from "../intel/context";
import { ispyDb } from "./db";
import { getCopy, getPromo, type Viewer } from "./read";

/**
 * Copy an ISpy promo (or copy) into this organization's Promo Analyzer and start the
 * analysis. Idempotent per organization: a second send opens the first promo.
 * The copy used is, in order: a transcript linked from the landing page, the landing
 * page text, else the email text.
 */
export async function sendIspyToAnalyzer(input: { viewer: Viewer & { orgId: string }; brand: IntelBrand; targetType: "PROMO" | "COPY"; targetId: string; actorId: string }): Promise<{ promoId: string; start: () => Promise<void> } | { error: string }> {
  const db = tenantDb(input.viewer.orgId);
  const existing = await db.ispyAnalyzerSend.findFirst({ where: { targetType: input.targetType, targetId: input.targetId } });
  if (existing) {
    const promo = await db.promo.findFirst({ where: { id: existing.promoId, deletedAt: null }, select: { id: true } });
    if (promo) return { promoId: promo.id, start: async () => undefined };
    await db.ispyAnalyzerSend.deleteMany({ where: { id: existing.id } });
  }
  let title: string;
  let sourceText: string;
  let publisher: string | null = null;
  let gurus: string[] = [];
  let product: string | null = null;
  if (input.targetType === "PROMO") {
    const found = await getPromo(input.viewer, input.targetId);
    if (!found) return { error: "That promo is not in your feed." };
    const firstCopy = found.copies[0] ? await getCopy(input.viewer, found.copies[0].id) : null;
    const landing = found.landing;
    const body = landing?.transcriptText?.trim() || landing?.text?.trim() || firstCopy?.text || "";
    if (body.length < 80) return { error: "There is too little text on this promo's page to analyze. Rip the video to get a transcript first." };
    publisher = found.promo.advertiserLabel ?? found.promo.advertiser.label;
    title = `${publisher}: ${found.promo.headline ?? found.promo.landingUrl}`.slice(0, 200);
    const source = landing?.transcriptText ? `transcript (${landing.transcriptUrl})` : landing?.text ? "landing page text" : "email text";
    sourceText = [`ISpy promo from ${publisher}. Landing page: ${found.promo.landingUrl}. First seen ${found.promo.firstSeenOn.toISOString().slice(0, 10)}, ${found.promo.daysDetected} days, ${found.promo.sendCount} sends. Copy below is the ${source}.`, "", body].join("\n");
    gurus = firstCopy?.copy.extraction?.gurus ?? [];
    product = firstCopy?.copy.extraction?.offer.product ?? null;
  } else {
    const found = await getCopy(input.viewer, input.targetId);
    if (!found) return { error: "That email is not in your feed." };
    if (found.text.trim().length < 80) return { error: "This email has too little text to analyze." };
    publisher = found.sends[0]?.publisher ?? null;
    title = `${publisher ?? "ISpy"}: ${found.copy.title}`.slice(0, 200);
    sourceText = [`ISpy email copy${publisher ? ` from ${publisher}` : ""}, sent ${found.sends.length} time(s), first ${found.sends[0]!.receivedAt.toISOString().slice(0, 10)}.`, `Subject: ${found.sends[0]!.subject}`, "", found.text].join("\n");
    gurus = found.copy.extraction?.gurus ?? [];
    product = found.copy.extraction?.offer.product ?? null;
  }
  const promo = await db.promo.create({
    data: {
      organizationId: input.viewer.orgId,
      brandId: input.brand.id,
      title,
      inputType: "text",
      sourceText: sourceText.slice(0, 400_000),
      publisher,
      gurus,
      product,
      source: `ispy-${input.targetType.toLowerCase()}:${input.targetId}`,
      analysisStatus: "QUEUED",
      uploadedById: input.actorId,
    },
    select: { id: true },
  });
  await db.ispyAnalyzerSend.create({ data: { organizationId: input.viewer.orgId, targetType: input.targetType, targetId: input.targetId, promoId: promo.id, createdById: input.actorId } });
  await appendOrgAudit(input.viewer.orgId, { actorId: input.actorId, action: "ispy.sent_to_analyzer", targetType: input.targetType === "PROMO" ? "ispy_promo" : "ispy_copy", targetId: input.targetId, metadata: { promoId: promo.id } });
  return { promoId: promo.id, start: () => runPromoAnalysis({ organizationId: input.viewer.orgId, promoId: promo.id, brand: input.brand, actorId: input.actorId }) };
}

/** The org's existing Analyzer promo for an ISpy item, if it was sent before. */
export async function analyzerPromoFor(orgId: string, targetType: "PROMO" | "COPY", targetId: string): Promise<string | null> {
  const row = await tenantDb(orgId).ispyAnalyzerSend.findFirst({ where: { targetType, targetId }, select: { promoId: true } });
  return row?.promoId ?? null;
}

export async function createReport(input: { kind: "NOT_A_PROMO" | "DUPLICATE"; targetType: "EMAIL" | "COPY" | "PROMO"; targetId: string; duplicateOfId: string | null; note: string | null; reporterId: string; reporterOrgId: string | null }): Promise<{ id: string }> {
  return ispyDb((tx) =>
    tx.ispyReport.create({
      data: { kind: input.kind, targetType: input.targetType, targetId: input.targetId, duplicateOfId: input.duplicateOfId, note: input.note?.slice(0, 1000) ?? null, reporterId: input.reporterId, reporterOrgId: input.reporterOrgId },
      select: { id: true },
    }),
  );
}
