"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { teachBrain } from "../brain/teach";
import { ENTITY_KINDS, entityKey, planMerge, type EntityKind } from "../../../../../modules/promo-studio/entities";
import { LESSON_CATEGORIES } from "../../../../../modules/promo-studio/lessons";
import { PERFORMANCE_FIELDS, parseSheet, type ColumnMapping } from "../../../../../modules/promo-studio/performance";
import { BULK_MAX } from "../../../../../modules/promo-studio/queue";
import { promoAction } from "./guard";
import { overrideProblem, mappingToHeaders, parseTierOverride } from "../../../../../modules/promo-studio/imports";
import { SYNC_INTERVALS, cleanRange, encryptSecret, parseServiceAccount, parseSpreadsheetId } from "../../../../../modules/promo-studio/sheets";
import { cancelQueued, drainBulkQueue, enqueueBulk } from "./bulk-queue";
import { linkPerformanceRow, loadOverrides, retier, runBulkJob, runLessonClustering, runPerformanceImport, setTierOverride, teachLessons, teachPerformance, undoImport } from "./insights";
import { loadSheetSync, previewSheetHeaders, runSheetSync } from "./sheets";

const MAX_SHEET_BYTES = 10 * 1024 * 1024;
const PERF = "/promo-studio/performance";
const LESSONS = "/promo-studio/lessons";
const DIRECTORY = "/promo-studio/directory";

const field = (formData: FormData, key: string, max = 300) => String(formData.get(key) ?? "").trim().slice(0, max);
function go(path: string, kind: "notice" | "error", message: string, extra = ""): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}${extra}`);
}

// ---------------------------------------------------------------------------
// Performance

export async function uploadPerformanceSheet(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) go(PERF, "error", "Choose a .csv or .xlsx file.");
  const upload = file as File;
  if (upload.size > MAX_SHEET_BYTES) go(PERF, "error", "That file is over 10 MB.");
  const data = new Uint8Array(await upload.arrayBuffer());
  let headers: string[] = [];
  try {
    const table = parseSheet(upload.name, data);
    headers = (table[0] ?? []).map((h, i) => h || `Column ${i + 1}`);
    if (table.length < 2) throw new Error("The sheet needs a header row and at least one row of results.");
  } catch (error) {
    go(PERF, "error", error instanceof Error ? error.message : "That file could not be read.");
  }
  const row = await tenantDb(ctx.resolved.id).promoPerformanceImport.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      filename: upload.name.slice(0, 200),
      mimeType: upload.type || "application/octet-stream",
      size: upload.size,
      data,
      headers: headers.map((h) => h.slice(0, 120)),
      createdById: ctx.auth.user.id,
    },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.performance.uploaded", targetType: "promo_performance_import", targetId: row.id });
  redirect(`${PERF}?import=${row.id}`);
}

export async function confirmPerformanceImport(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const importId = field(formData, "importId", 40);
  const db = tenantDb(ctx.resolved.id);
  const upload = await db.promoPerformanceImport.findFirst({ where: { id: importId, brandId: ctx.brand.id, status: { in: ["MAPPING", "FAILED"] } } });
  if (!upload) go(PERF, "error", "That upload is gone. Upload the file again.");
  const mapping = {} as ColumnMapping;
  for (const item of PERFORMANCE_FIELDS) {
    const value = Number(field(formData, `map_${item.key}`, 6));
    mapping[item.key] = Number.isInteger(value) && value >= 0 && value < upload!.headers.length ? value : -1;
  }
  if (mapping.code < 0) go(PERF, "error", "Choose the column that holds the promo code.", `&import=${importId}`);
  if (mapping.orders < 0 && mapping.revenue < 0) go(PERF, "error", "Map orders or revenue; tiers rank on one of them.", `&import=${importId}`);
  await db.promoPerformanceImport.updateMany({ where: { id: importId }, data: { status: "IMPORTING", error: null } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.performance.imported", targetType: "promo_performance_import", targetId: importId });
  after(() => runPerformanceImport({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, importId, mapping }));
  redirect(`${PERF}?import=${importId}`);
}

export async function discardPerformanceImport(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  await tenantDb(ctx.resolved.id).promoPerformanceImport.deleteMany({ where: { id: field(formData, "importId", 40), brandId: ctx.brand.id, status: { in: ["MAPPING", "FAILED"] } } });
  go(PERF, "notice", "Upload discarded.");
}

export async function rematchPerformance() {
  const ctx = await promoAction("promo.write", PERF);
  const { matched, total } = await retier(ctx.resolved.id, ctx.brand.id);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.performance.rematched", targetType: "brand", targetId: ctx.brand.id });
  go(PERF, "notice", `Re-matched: ${matched} of ${total} codes are linked to a promo. Tiers recomputed.`);
}

export async function teachPerformanceBrain() {
  const ctx = await promoAction("promo.write", PERF);
  const count = await teachPerformance({ organizationId: ctx.resolved.id, brand: ctx.brand, actorId: ctx.auth.user.id });
  if (!count) go(PERF, "error", "Import results first.");
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.performance.taught", targetType: "brand", targetId: ctx.brand.id });
  go(PERF, "notice", `Taught ${ctx.brand.name}'s Brain the results summary (${count} codes).`);
}

// ---------------------------------------------------------------------------
// Lessons

export async function rebuildLessons() {
  const ctx = await promoAction("promo.write", LESSONS);
  const db = tenantDb(ctx.resolved.id);
  const busy = await db.promoLessonRun.findFirst({ where: { brandId: ctx.brand.id, status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } });
  if (busy) go(LESSONS, "error", "A rebuild is already running.");
  const run = await db.promoLessonRun.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, createdById: ctx.auth.user.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.lessons.rebuilt", targetType: "promo_lesson_run", targetId: run.id });
  after(() => runLessonClustering({ organizationId: ctx.resolved.id, runId: run.id, brand: ctx.brand, actorId: ctx.auth.user.id }));
  redirect(LESSONS);
}

async function ownLesson(ctx: Awaited<ReturnType<typeof promoAction>>, id: string) {
  const lesson = await tenantDb(ctx.resolved.id).promoLesson.findFirst({ where: { id, brandId: ctx.brand.id } });
  if (!lesson) go(LESSONS, "error", "That lesson no longer exists.");
  return lesson!;
}

export async function saveLesson(formData: FormData) {
  const ctx = await promoAction("promo.write", LESSONS);
  const id = field(formData, "lessonId", 40);
  const title = field(formData, "title", 120);
  const body = field(formData, "body", 1200);
  const categoryRaw = field(formData, "category", 40);
  const category = (LESSON_CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : "other";
  if (!title || !body) go(LESSONS, "error", "A lesson needs a title and text.");
  const db = tenantDb(ctx.resolved.id);
  if (id) {
    const lesson = await ownLesson(ctx, id);
    await db.promoLesson.updateMany({ where: { id: lesson.id }, data: { title, body, category, edited: true } });
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.lesson.updated", targetType: "promo_lesson", targetId: lesson.id });
  } else {
    const created = await db.promoLesson.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, title, body, category, origin: "manual", pinned: true } });
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.lesson.created", targetType: "promo_lesson", targetId: created.id });
  }
  await teachLessons({ organizationId: ctx.resolved.id, brand: ctx.brand, actorId: ctx.auth.user.id });
  go(LESSONS, "notice", "Lesson saved.");
}

export async function toggleLesson(formData: FormData) {
  const ctx = await promoAction("promo.write", LESSONS);
  const lesson = await ownLesson(ctx, field(formData, "lessonId", 40));
  const flag = field(formData, "flag", 10);
  if (flag !== "pinned" && flag !== "hidden") go(LESSONS, "error", "Unknown change.");
  const value = !lesson[flag as "pinned" | "hidden"];
  await tenantDb(ctx.resolved.id).promoLesson.updateMany({ where: { id: lesson.id }, data: { [flag]: value } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: `promo.lesson.${flag}.${value ? "on" : "off"}`, targetType: "promo_lesson", targetId: lesson.id });
  await teachLessons({ organizationId: ctx.resolved.id, brand: ctx.brand, actorId: ctx.auth.user.id });
  redirect(`${LESSONS}${field(formData, "back", 40) === "hidden" ? "?show=hidden" : ""}`);
}

export async function deleteLesson(formData: FormData) {
  const ctx = await promoAction("promo.write", LESSONS);
  const lesson = await ownLesson(ctx, field(formData, "lessonId", 40));
  await tenantDb(ctx.resolved.id).promoLesson.deleteMany({ where: { id: lesson.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.lesson.deleted", targetType: "promo_lesson", targetId: lesson.id });
  go(LESSONS, "notice", "Lesson deleted.");
}

/** Suggest a generic best practice (sent to the platform's main Brain, never shown to other brands). Requires the person to confirm. */
export async function shareLesson(formData: FormData) {
  const ctx = await promoAction("promo.write", LESSONS);
  const lesson = await ownLesson(ctx, field(formData, "lessonId", 40));
  if (formData.get("confirmGeneric") !== "on") go(LESSONS, "error", "Tick the box to confirm the lesson is a generic best practice with nothing private in it.");
  await teachBrain({
    organizationId: ctx.resolved.id,
    brandId: null,
    visibility: "SHARED",
    sourceRef: `promo-lesson:${lesson.id}`,
    title: `Copy lesson: ${lesson.title}`,
    body: `# ${lesson.title}\n\n${lesson.body}\n\n_Category: ${lesson.category}. A general copywriting best practice from Promo Analyzer._`,
    folder: "Copywriting best practices",
    source: "promo-analyzer",
    actorId: ctx.auth.user.id,
  });
  await tenantDb(ctx.resolved.id).promoLesson.updateMany({ where: { id: lesson.id }, data: { sharedAt: new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.lesson.shared", targetType: "promo_lesson", targetId: lesson.id });
  go(LESSONS, "notice", "Suggested as a best practice.");
}

// ---------------------------------------------------------------------------
// Directory

function kindOf(formData: FormData): EntityKind {
  const kind = field(formData, "kind", 20);
  return (ENTITY_KINDS as readonly string[]).includes(kind) ? (kind as EntityKind) : "publisher";
}

/** Rename, merge into another entry, or add an alias: all point one name at another. */
export async function mergeEntity(formData: FormData) {
  const ctx = await promoAction("promo.write", DIRECTORY);
  const kind = kindOf(formData);
  const back = `&kind=${kind}`;
  const from = field(formData, "from", 200);
  const into = field(formData, "into", 200);
  const overrides = await loadOverrides(ctx.resolved.id, ctx.brand.id);
  // Alias: the new spelling points at this entry (from = alias, into = entry).
  const plan = formData.get("mode") === "alias" ? planMerge(kind, into, from, overrides) : planMerge(kind, from, into, overrides);
  if (plan.error) go(DIRECTORY, "error", plan.error, back);
  const db = tenantDb(ctx.resolved.id);
  for (const change of plan.upsert) {
    const existing = await db.promoEntityOverride.findFirst({ where: { brandId: ctx.brand.id, kind, fromKey: change.fromKey } });
    if (existing) await db.promoEntityOverride.updateMany({ where: { id: existing.id }, data: { toName: change.toName } });
    else await db.promoEntityOverride.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, kind, fromKey: change.fromKey, fromName: change.fromName, toName: change.toName, createdById: ctx.auth.user.id } });
  }
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.entity.merged", targetType: "promo_entity", targetId: `${kind}:${entityKey(from)}` });
  go(DIRECTORY, "notice", "Saved. Promos show the new name; their detected values are kept.", back);
}

export async function toggleEntityHidden(formData: FormData) {
  const ctx = await promoAction("promo.write", DIRECTORY);
  const kind = kindOf(formData);
  const name = field(formData, "name", 200);
  const key = entityKey(name);
  if (!key) go(DIRECTORY, "error", "Missing name.", `&kind=${kind}`);
  const db = tenantDb(ctx.resolved.id);
  const existing = await db.promoEntityOverride.findFirst({ where: { brandId: ctx.brand.id, kind, fromKey: key } });
  if (existing) await db.promoEntityOverride.updateMany({ where: { id: existing.id }, data: { hidden: !existing.hidden } });
  else await db.promoEntityOverride.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, kind, fromKey: key, fromName: name, hidden: true, createdById: ctx.auth.user.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.entity.hidden.toggled", targetType: "promo_entity", targetId: `${kind}:${key}` });
  redirect(`${DIRECTORY}?kind=${kind}`);
}

export async function removeEntityOverride(formData: FormData) {
  const ctx = await promoAction("promo.write", DIRECTORY);
  const kind = kindOf(formData);
  const id = field(formData, "overrideId", 40);
  await tenantDb(ctx.resolved.id).promoEntityOverride.deleteMany({ where: { id, brandId: ctx.brand.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.entity.override.removed", targetType: "promo_entity_override", targetId: id });
  go(DIRECTORY, "notice", "Correction undone.", `&kind=${kind}`);
}

// ---------------------------------------------------------------------------
// Bulk re-analysis

export async function bulkReanalyze(formData: FormData) {
  const ctx = await promoAction("promo.write", "/promo-studio/bulk");
  const ids = [...new Set(formData.getAll("promoId").map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) go("/promo-studio/bulk", "error", "Select at least one promo.");
  if (ids.length > BULK_MAX) go("/promo-studio/bulk", "error", `Select at most ${BULK_MAX} promos at a time.`);
  const db = tenantDb(ctx.resolved.id);
  const promos = await db.promo.findMany({ where: { id: { in: ids }, brandId: ctx.brand.id, deletedAt: null, analysisStatus: { notIn: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (!promos.length) go("/promo-studio/bulk", "error", "Those promos are already queued.");
  const added = await enqueueBulk({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, promoIds: promos.map((p) => p.id), actorId: ctx.auth.user.id });
  for (const promoId of added) {
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.reanalyzed", targetType: "promo", targetId: promoId, metadata: { via: "bulk" } });
  }
  // Start now; the every-minute job picks up anything left (and anything a restart interrupted).
  after(() => drainBulkQueue({ run: runBulkJob, budgetMs: 10 * 60_000 }).then(() => undefined));
  go("/promo-studio/bulk", "notice", `Queued ${added.length} promo${added.length === 1 ? "" : "s"}. Two run at a time; the queue keeps going if the server restarts.`);
}

export async function cancelBulkQueue() {
  const ctx = await promoAction("promo.write", "/promo-studio/bulk");
  const count = await cancelQueued(ctx.resolved.id, ctx.brand.id);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.bulk.cancelled", targetType: "brand", targetId: ctx.brand.id, metadata: { count } });
  go("/promo-studio/bulk", "notice", count ? `Took ${count} waiting promo${count === 1 ? "" : "s"} out of the queue. Running ones finish.` : "Nothing was waiting.");
}

// ---------------------------------------------------------------------------
// Undo an import, tier overrides, hand links

export async function undoPerformanceImport(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const importId = field(formData, "importId", 40);
  const result = await undoImport({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, importId, actorId: ctx.auth.user.id });
  if ("error" in result) go(PERF, "error", result.error);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.performance.import_undone", targetType: "promo_performance_import", targetId: importId, metadata: result });
  const kept = result.kept ? ` ${result.kept} code${result.kept === 1 ? " was" : "s were"} changed by a later import and kept.` : "";
  go(PERF, "notice", `Import undone: ${result.removed} code${result.removed === 1 ? "" : "s"} removed, ${result.restored} put back to their earlier numbers. Tiers recomputed.${kept}`);
}

export async function overrideTier(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const performanceId = field(formData, "performanceId", 40);
  const clear = formData.get("clear") === "1";
  const tier = field(formData, "tier", 20);
  const reason = field(formData, "reason", 500);
  const back = `#row-${performanceId}`;
  if (!clear) {
    const problem = overrideProblem({ tier, reason });
    if (problem || !tier) go(PERF, "error", problem ?? "Pick a tier.", back);
  }
  const result = await setTierOverride({
    organizationId: ctx.resolved.id,
    brandId: ctx.brand.id,
    performanceId,
    tier: clear ? null : parseTierOverride(tier),
    reason: clear ? null : reason,
    actorId: ctx.auth.user.id,
  });
  if (!result) go(PERF, "error", "That results row no longer exists.");
  await appendOrgAudit(ctx.resolved.id, {
    actorId: ctx.auth.user.id,
    action: clear ? "promo.performance.tier_override_cleared" : "promo.performance.tier_overridden",
    targetType: "promo_performance",
    targetId: performanceId,
    metadata: { code: result.codeKey, from: result.from, to: result.to, computed: result.computed, reason: clear ? null : reason },
  });
  go(PERF, "notice", clear ? `${result.codeKey}: back to the tier the data gives.` : `${result.codeKey}: tier overridden. The reason is saved with it.`, back);
}

export async function linkPerformance(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const performanceId = field(formData, "performanceId", 40);
  const choice = field(formData, "target", 40);
  // "promo": the promo comes from the shared list, typed or picked as "Title (code) · <id>".
  const target = choice === "promo" ? (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(field(formData, "promo", 400))?.[0] ?? "") : choice;
  if (target !== "auto" && target !== "none" && !/^[0-9a-f-]{36}$/i.test(target)) go(PERF, "error", "Pick a promo from the list.", `#row-${performanceId}`);
  const result = await linkPerformanceRow({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, performanceId, target });
  if ("error" in result) go(PERF, "error", result.error ?? "That did not work.");
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.performance.linked", targetType: "promo_performance", targetId: performanceId, metadata: { code: result.codeKey, from: result.from, to: result.to, mode: target === "auto" || target === "none" ? target : "promo" } });
  const message = target === "auto" ? "Matched by promo code again." : target === "none" ? "Kept unlinked; re-matching will leave it alone." : "Linked. Re-matching by code will keep this link.";
  go(PERF, "notice", `${result.codeKey}: ${message}`, `#row-${performanceId}`);
}

// ---------------------------------------------------------------------------
// Google Sheets sync

const SHEET = `${PERF}?sheet=1`;

export async function saveSheetSync(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const spreadsheetId = parseSpreadsheetId(field(formData, "sheet", 500));
  if (!spreadsheetId) go(SHEET, "error", "Paste the Google Sheet's link (or its id).");
  const range = cleanRange(field(formData, "range", 120));
  const everyRaw = Number(field(formData, "everyHours", 4));
  const everyHours = (SYNC_INTERVALS as readonly number[]).includes(everyRaw) ? everyRaw : 6;
  const keyText = String(formData.get("credentials") ?? "").trim();
  const db = tenantDb(ctx.resolved.id);
  const existing = await loadSheetSync(ctx.resolved.id, ctx.brand.id);
  let secret: { credentials: string; clientEmail: string } | null = null;
  if (keyText) {
    const account = parseServiceAccount(keyText.slice(0, 20000));
    if ("error" in account) go(SHEET, "error", account.error);
    const authSecret = process.env.AUTH_SECRET ?? "";
    if (authSecret.length < 16) go(SHEET, "error", "AUTH_SECRET is not set on the server, so the key cannot be stored safely.");
    secret = { credentials: encryptSecret(keyText, authSecret), clientEmail: account.clientEmail };
  } else if (!existing?.credentials) {
    go(SHEET, "error", "Paste the service-account key (JSON) once. It is stored encrypted and never shown again.");
  }
  const changedSheet = !existing || existing.spreadsheetId !== spreadsheetId || existing.range !== range;
  const data = { spreadsheetId, range, everyHours, ...(secret ?? {}), ...(changedSheet ? { lastHash: null, headers: [] } : {}) };
  if (existing) await db.promoSheetSync.updateMany({ where: { id: existing.id }, data });
  else await db.promoSheetSync.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, createdById: ctx.auth.user.id, ...data, spreadsheetId: spreadsheetId! } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.sheet_sync.saved", targetType: "brand", targetId: ctx.brand.id, metadata: { keyReplaced: Boolean(secret) } });
  const preview = await previewSheetHeaders({ organizationId: ctx.resolved.id, brandId: ctx.brand.id });
  if ("error" in preview) go(SHEET, "error", `Saved, but the sheet could not be read yet: ${preview.error}`);
  go(SHEET, "notice", "Connected. Map the columns, then turn on the sync.");
}

export async function saveSheetMapping(formData: FormData) {
  const ctx = await promoAction("promo.write", PERF);
  const config = await loadSheetSync(ctx.resolved.id, ctx.brand.id);
  if (!config) go(SHEET, "error", "Connect a sheet first.");
  const mapping = {} as ColumnMapping;
  for (const item of PERFORMANCE_FIELDS) {
    const value = Number(field(formData, `map_${item.key}`, 6));
    mapping[item.key] = Number.isInteger(value) && value >= 0 && value < config!.headers.length ? value : -1;
  }
  if (mapping.code < 0) go(SHEET, "error", "Choose the column that holds the promo code.");
  if (mapping.orders < 0 && mapping.revenue < 0) go(SHEET, "error", "Map orders or revenue; tiers rank on one of them.");
  const enabled = formData.get("enabled") === "on";
  await tenantDb(ctx.resolved.id).promoSheetSync.updateMany({
    where: { id: config!.id },
    data: { mapping: mappingToHeaders(mapping, config!.headers) as unknown as Prisma.InputJsonValue, enabled, lastHash: null },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.sheet_sync.mapped", targetType: "brand", targetId: ctx.brand.id, metadata: { enabled } });
  if (formData.get("syncNow") === "1") {
    await tenantDb(ctx.resolved.id).promoSheetSync.updateMany({ where: { id: config!.id }, data: { status: "RUNNING" } });
    after(() => runSheetSync({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.auth.user.id, force: true }).then(() => undefined));
    go(SHEET, "notice", "Saved. Syncing now…");
  }
  go(SHEET, "notice", enabled ? "Saved. The sheet syncs on its schedule." : "Saved. The scheduled sync is off.");
}

export async function syncSheetNow() {
  const ctx = await promoAction("promo.write", PERF);
  const config = await loadSheetSync(ctx.resolved.id, ctx.brand.id);
  if (!config?.mapping) go(SHEET, "error", "Map the sheet's columns first.");
  await tenantDb(ctx.resolved.id).promoSheetSync.updateMany({ where: { id: config!.id }, data: { status: "RUNNING", lastError: null } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.sheet_sync.run", targetType: "brand", targetId: ctx.brand.id });
  after(() => runSheetSync({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.auth.user.id, force: true }).then(() => undefined));
  go(SHEET, "notice", "Syncing now…");
}

export async function disconnectSheet() {
  const ctx = await promoAction("promo.write", PERF);
  await tenantDb(ctx.resolved.id).promoSheetSync.deleteMany({ where: { brandId: ctx.brand.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "promo.sheet_sync.removed", targetType: "brand", targetId: ctx.brand.id });
  go(PERF, "notice", "Sheet disconnected and its key deleted. Results already imported stay.");
}
