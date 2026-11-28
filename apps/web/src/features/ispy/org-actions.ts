"use server";

import { appendOrgAudit } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { canUsePromoAnalyzer } from "../intel/context";
import { drainVideoQueue, queueVideo } from "../intel/video";
import { deepAnalyzeCopy } from "./brain";
import { getCopy, getPromo } from "./read";
import { createReport, sendIspyToAnalyzer } from "./analyzer";
import { UUID, ispyOrgScope } from "./org-data";

function go(path: string, flash?: { error?: string; notice?: string }): never {
  const params = new URLSearchParams();
  if (flash?.error) params.set("error", flash.error);
  if (flash?.notice) params.set("notice", flash.notice);
  const query = params.toString();
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);
}

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/** Only same-app relative paths under /intel come back from a form. */
function safeBack(value: string): string {
  return /^\/intel(\/[A-Za-z0-9/_-]*)?(\?[^\s]*)?$/.test(value) ? value : "/intel";
}

export async function sendIspyToAnalyzerAction(formData: FormData) {
  const back = safeBack(text(formData, "back", 500));
  const targetType = text(formData, "targetType") === "COPY" ? "COPY" : "PROMO";
  const targetId = text(formData, "targetId", 40);
  if (!UUID.test(targetId)) go(back);
  const found = await ispyOrgScope(undefined, text(formData, "feed", 10), "write").catch(() => null);
  if (!found || !found.ok) go(back, { error: found && !found.ok ? found.error : "You cannot do that." });
  const { scope, viewer } = found.value;
  if (!(await canUsePromoAnalyzer())) go(back, { error: "Sending to Promo Analyzer needs Promo Analyzer turned on and promo.write." });
  const result = await sendIspyToAnalyzer({ viewer, brand: scope.brand, targetType, targetId, actorId: scope.actorId });
  if ("error" in result) go(back, { error: result.error });
  after(result.start);
  redirect(`/promo-studio/${result.promoId}`);
}

export async function reportIspyAction(formData: FormData) {
  const back = safeBack(text(formData, "back", 500));
  const found = await ispyOrgScope(undefined, text(formData, "feed", 10), "write").catch(() => null);
  if (!found || !found.ok) go(back, { error: found && !found.ok ? found.error : "You cannot do that." });
  const { scope } = found.value;
  const kind = text(formData, "kind") === "DUPLICATE" ? "DUPLICATE" : "NOT_A_PROMO";
  const rawType = text(formData, "targetType");
  const targetType = rawType === "EMAIL" || rawType === "COPY" ? rawType : "PROMO";
  const targetId = text(formData, "targetId", 40);
  const duplicateOfId = text(formData, "duplicateOfId", 40);
  if (!UUID.test(targetId)) go(back);
  if (kind === "DUPLICATE" && !UUID.test(duplicateOfId)) go(back, { error: "Pick what it duplicates first." });
  if (kind === "DUPLICATE" && duplicateOfId === targetId) go(back, { error: "Pick a different item: it can't duplicate itself." });
  const report = await createReport({ kind, targetType, targetId, duplicateOfId: kind === "DUPLICATE" ? duplicateOfId : null, note: text(formData, "note", 1000) || null, reporterId: scope.actorId, reporterOrgId: scope.organizationId });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "ispy.report.created", targetType: "ispy_report", targetId: report.id, metadata: { kind, targetType, targetId } });
  go(back, { notice: "Thanks: the report went to PubCommand staff. Once they apply it, it sticks for future mail." });
}

/** Rip the promo's VSL into the org's own Videos (My captures): transcript, keyframes, AI read. */
export async function ripPromoVideoAction(formData: FormData) {
  const back = safeBack(text(formData, "back", 500));
  const promoId = text(formData, "promoId", 40);
  if (!UUID.test(promoId)) go(back);
  const found = await ispyOrgScope(undefined, text(formData, "feed", 10), "write").catch(() => null);
  if (!found || !found.ok) go(back, { error: found && !found.ok ? found.error : "You cannot do that." });
  const { scope, viewer } = found.value;
  const promo = await getPromo(viewer, promoId);
  if (!promo) go(back, { error: "That promo is not in your feed." });
  const queued = await queueVideo({ organizationId: scope.organizationId, brandId: scope.brand.id, actorId: scope.actorId, url: promo.promo.landingUrl });
  if ("error" in queued) go(back, { error: queued.error });
  after(() => drainVideoQueue({ budgetMs: 45 * 60_000 }).then(() => undefined));
  go(`/intel/videos/${queued.id}`, { notice: "Video capture queued. When the transcript is ready, use Send transcript to Promo Analyzer." });
}

/** "Deep analyze" on a copy: one bigger AI call, on request only. */
export async function deepAnalyzeIspyAction(formData: FormData) {
  const back = safeBack(text(formData, "back", 500));
  const copyId = text(formData, "copyId", 40);
  if (!UUID.test(copyId)) go(back);
  const found = await ispyOrgScope(undefined, text(formData, "feed", 10), "write").catch(() => null);
  if (!found || !found.ok) go(back, { error: found && !found.ok ? found.error : "You cannot do that." });
  const { scope, viewer } = found.value;
  if (!(await getCopy(viewer, copyId))) go(back, { error: "That email is not in your feed." });
  const result = await deepAnalyzeCopy(copyId);
  if ("error" in result) go(back, { error: result.error });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "ispy.copy.deep_analyzed", targetType: "ispy_copy", targetId: copyId });
  go(back, { notice: "Deep analysis ready." });
}
