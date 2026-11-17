"use server";

import { randomBytes } from "node:crypto";
import { Prisma, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { CALL_TYPES, CATEGORY_COLORS, FILE_ROLES } from "../../../../../modules/performance/archive";
import { parseSplitFactor } from "../../../../../modules/performance/gain";
import { pricesToCheck, storedProposal, PRICE_FIELDS } from "../../../../../modules/performance/backup-read";
import { IMPORT_COLUMNS, parseCsv, parseDate, parseMoney, validatePosition, type ImportPlan, type RawPosition } from "../../../../../modules/performance/positions";
import { editorForExpertName, expertForEditor } from "../../../../../modules/performance/attribution";
import { getEditor, getEditors } from "@/features/pubsetup/read";
import { AI_RUN_STALE_MS, runBackupRead } from "./backup-ai";
import { trackAccess, type TrackScope } from "./context";
import { closeWithFill, syncPositionFromFills } from "./fills";
import { applyImportPlan, planTable } from "./importer";
import { loadQuotes } from "./prices";
import { afterPositionsChanged, auditTrack, getPortfolio, listPortfolios, refreshCallHistory, refreshPositionHistory, teachWeeklySummary } from "./server";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function go(path: string, message?: { error?: string; notice?: string }): never {
  const query = message?.error ? `?error=${encodeURIComponent(message.error)}` : message?.notice ? `?notice=${encodeURIComponent(message.notice)}` : "";
  redirect(`${path}${path.includes("?") && query ? query.replace("?", "&") : query}`);
}

/** A live Publication Setup editor of this brand, or null ("" and unknown ids both mean none). */
async function brandEditorId(scope: TrackScope, raw: string): Promise<string | null> {
  if (!UUID.test(raw)) return null;
  const editor = await getEditor(scope.organizationId, scope.brandId, raw);
  return editor && !editor.archived ? editor.id : null;
}

async function writer(back = "/performance"): Promise<TrackScope> {
  const access = await trackAccess("performance.write");
  if (!access.ok) go(back, { error: access.error });
  return access.scope;
}

// ----------------------------------------------------------------------------- portfolios

export async function createPortfolio(formData: FormData) {
  const scope = await writer();
  const name = text(formData, "name", 120);
  if (!name) go("/performance", { error: "Give the portfolio a name." });
  const existing = await listPortfolios(scope);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) go("/performance", { error: `There is already a portfolio called ${name}.` });
  const portfolio = await tenantDb(scope.organizationId).trackPortfolio.create({
    data: {
      organizationId: scope.organizationId,
      brandId: scope.brandId,
      name,
      publication: text(formData, "publication", 120),
      description: text(formData, "description", 1000),
      createdById: scope.actorId,
    },
  });
  await auditTrack(scope, "trackrecord.portfolio.created", "track_portfolio", portfolio.id);
  go(`/performance/${portfolio.id}`, { notice: "Portfolio created. Add recommendations or import a CSV." });
}

export async function updatePortfolio(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const name = text(formData, "name", 120) || portfolio.name;
  const defaultEditorId = formData.has("defaultEditorId") ? await brandEditorId(scope, text(formData, "defaultEditorId", 40)) : portfolio.defaultEditorId;
  await tenantDb(scope.organizationId).trackPortfolio.updateMany({
    where: { id: portfolio.id },
    data: { name, publication: text(formData, "publication", 120), description: text(formData, "description", 1000), defaultEditorId },
  });
  await auditTrack(scope, "trackrecord.portfolio.updated", "track_portfolio", portfolio.id);
  go(`/performance/${portfolio.id}?tab=settings`, { notice: "Saved." });
}

export async function updatePublicLink(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const mode = text(formData, "mode", 20);
  const data =
    mode === "enable"
      ? { publicEnabled: true, publicToken: portfolio.publicToken ?? randomBytes(18).toString("base64url") }
      : mode === "rotate"
        ? { publicToken: randomBytes(18).toString("base64url") }
        : mode === "disable"
          ? { publicEnabled: false }
          : { publicIncludeOpen: formData.get("includeOpen") === "on" };
  await tenantDb(scope.organizationId).trackPortfolio.updateMany({ where: { id: portfolio.id }, data });
  await auditTrack(scope, `trackrecord.public.${mode || "settings"}`, "track_portfolio", portfolio.id);
  go(`/performance/${portfolio.id}?tab=public`, { notice: mode === "disable" ? "Public link turned off." : "Public link updated." });
}

/** The embeddable widget: on, rotate (the old embed stops working), off, or include open positions. */
export async function updateWidget(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const mode = text(formData, "mode", 20);
  const data =
    mode === "enable"
      ? { widgetEnabled: true, widgetToken: portfolio.widgetToken ?? randomBytes(18).toString("base64url") }
      : mode === "rotate"
        ? { widgetToken: randomBytes(18).toString("base64url") }
        : mode === "disable"
          ? { widgetEnabled: false }
          : { widgetIncludeOpen: formData.get("includeOpen") === "on" };
  await tenantDb(scope.organizationId).trackPortfolio.updateMany({ where: { id: portfolio.id }, data });
  await auditTrack(scope, `trackrecord.widget.${mode || "settings"}`, "track_portfolio", portfolio.id);
  go(`/performance/${portfolio.id}?tab=public`, { notice: mode === "disable" ? "Widget turned off. Existing embeds now show nothing." : mode === "rotate" ? "New widget link made. Update your embeds: the old one stopped working." : "Widget updated." });
}

export async function deletePortfolio(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  if (text(formData, "confirm", 120) !== portfolio.name) go(`/performance/${portfolio.id}?tab=settings`, { error: "Type the portfolio name exactly to delete it." });
  const db = tenantDb(scope.organizationId);
  const now = new Date();
  await db.trackPosition.updateMany({ where: { portfolioId: portfolio.id, deletedAt: null }, data: { deletedAt: now } });
  await db.trackPortfolio.updateMany({ where: { id: portfolio.id }, data: { deletedAt: now, publicEnabled: false, widgetEnabled: false } });
  await auditTrack(scope, "trackrecord.portfolio.deleted", "track_portfolio", portfolio.id);
  go("/performance", { notice: `${portfolio.name} was deleted.` });
}

// ----------------------------------------------------------------------------- positions

function rawFromForm(formData: FormData): RawPosition {
  const raw: RawPosition = {};
  for (const field of IMPORT_COLUMNS) {
    const value = formData.get(field);
    if (typeof value === "string") raw[field] = value.slice(0, 4000);
  }
  return raw;
}

export async function savePosition(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const positionId = text(formData, "positionId", 40);
  const back = positionId ? `/performance/${portfolio.id}/positions/${positionId}` : `/performance/${portfolio.id}/positions/new`;
  const result = validatePosition(rawFromForm(formData), new Date());
  if (!result.ok) go(back, { error: result.errors.join(" ") });
  const draft = result.draft;
  const recordedPrice = parseMoney(text(formData, "recordedPrice", 40));
  const recordedAt = parseDate(text(formData, "recordedAt", 20));
  const data = {
    symbol: draft.symbol,
    name: draft.name,
    assetType: draft.assetType,
    direction: draft.direction,
    optionRight: draft.optionRight,
    strike: draft.strike,
    expiry: draft.expiry,
    priceSymbol: draft.priceSymbol,
    entryDate: draft.entryDate,
    entryPrice: draft.entryPrice,
    stopPrice: draft.stopPrice,
    targetPrice: draft.targetPrice,
    exitDate: draft.exitDate,
    exitPrice: draft.exitPrice,
    status: draft.exitPrice != null ? "CLOSED" : "OPEN",
    weight: draft.weight,
    notes: draft.notes,
    recordedPrice: recordedPrice != null && recordedPrice > 0 ? recordedPrice : null,
    recordedAt: recordedAt instanceof Date ? recordedAt : null,
    ...(formData.has("editorId") ? { editorId: await brandEditorId(scope, text(formData, "editorId", 40)) } : {}),
    ...(draft.splitFactor != null ? { splitFactor: draft.splitFactor, splitSource: "manual" } : {}),
  };
  const db = tenantDb(scope.organizationId);
  let id = positionId;
  if (positionId) {
    const existing = await db.trackPosition.findFirst({ where: { id: positionId, portfolioId: portfolio.id, deletedAt: null } });
    if (!existing) go(`/performance/${portfolio.id}`, { error: "That recommendation no longer exists." });
    const clearSplit = draft.splitFactor == null && existing.splitSource === "manual" && formData.get("splitFactor") === "";
    await db.trackPosition.updateMany({
      where: { id: positionId },
      data: { ...data, peakCheckedAt: null, ...(clearSplit ? { splitFactor: 1, splitSource: "none" } : {}) },
    });
    // Fills are the record for a position tracked by fills: entry, exit and status come back from them.
    if (existing.fillCount > 0) await syncPositionFromFills(scope.organizationId, positionId);
    await auditTrack(scope, existing.status !== data.status && data.status === "CLOSED" ? "trackrecord.position.closed" : "trackrecord.position.updated", "track_position", positionId);
  } else {
    const created = await db.trackPosition.create({
      data: { organizationId: scope.organizationId, brandId: scope.brandId, portfolioId: portfolio.id, createdById: scope.actorId, ...data },
    });
    id = created.id;
    await auditTrack(scope, "trackrecord.position.created", "track_position", created.id);
  }
  after(() => afterPositionsChanged(scope, [portfolio.id], [id]));
  go(`/performance/${portfolio.id}`, { notice: `${draft.symbol} saved.` });
}

export async function closePosition(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const positionId = text(formData, "positionId", 40);
  const db = tenantDb(scope.organizationId);
  const position = UUID.test(positionId) ? await db.trackPosition.findFirst({ where: { id: positionId, portfolioId: portfolio.id, deletedAt: null } }) : null;
  if (!position) go(`/performance/${portfolio.id}`, { error: "That recommendation no longer exists." });
  const back = `/performance/${portfolio.id}/positions/${position.id}`;
  const exitPrice = parseMoney(text(formData, "exitPrice", 40));
  const exitDate = parseDate(text(formData, "exitDate", 20));
  if (exitPrice == null || Number.isNaN(exitPrice) || exitPrice <= 0) go(back, { error: "Enter the exit price." });
  if (!(exitDate instanceof Date)) go(back, { error: "Enter the exit date." });
  if (exitDate < position.entryDate) go(back, { error: "The exit date is before the entry date." });
  if (exitDate.getTime() > Date.now()) go(back, { error: "The exit date is in the future." });
  if (position.fillCount > 0) {
    const problem = await closeWithFill({ organizationId: scope.organizationId, position, exitPrice, exitDate, actorId: scope.actorId });
    if (problem) go(back, { error: problem });
  } else {
    await db.trackPosition.updateMany({ where: { id: position.id }, data: { status: "CLOSED", exitPrice, exitDate, peakCheckedAt: null } });
  }
  await auditTrack(scope, "trackrecord.position.closed", "track_position", position.id);
  after(() => afterPositionsChanged(scope, [portfolio.id], [position.id]));
  go(`/performance/${portfolio.id}`, { notice: `${position.symbol} closed.` });
}

export async function deletePosition(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const positionId = text(formData, "positionId", 40);
  if (!UUID.test(positionId)) go(`/performance/${portfolio.id}`);
  await tenantDb(scope.organizationId).trackPosition.updateMany({ where: { id: positionId, portfolioId: portfolio.id, deletedAt: null }, data: { deletedAt: new Date() } });
  await auditTrack(scope, "trackrecord.position.deleted", "track_position", positionId);
  after(() => afterPositionsChanged(scope, [portfolio.id], []));
  go(`/performance/${portfolio.id}`, { notice: "Recommendation deleted." });
}

export async function refreshPortfolioPrices(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const rows = await tenantDb(scope.organizationId).trackPosition.findMany({ where: { portfolioId: portfolio.id, deletedAt: null } });
  const symbols = rows.filter((row) => row.status !== "CLOSED" && row.priceSymbol).map((row) => row.priceSymbol as string);
  const quotes = await loadQuotes(scope.organizationId, symbols, { force: true });
  const history = await refreshPositionHistory(scope.organizationId, rows, { force: true });
  await teachWeeklySummary(scope, portfolio.id);
  const failed = [...new Set(symbols)].filter((symbol) => !quotes.get(symbol) || quotes.get(symbol)?.stale).length;
  const notice = `Prices refreshed for ${new Set(symbols).size - failed} symbol(s)${failed ? `; ${failed} could not be priced and show their last stored price` : ""}. History updated for ${history.updated}.`;
  go(`/performance/${portfolio.id}`, { notice });
}

export async function teachPortfolioWeek(formData: FormData) {
  const scope = await writer();
  const portfolio = await getPortfolio(scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const week = await teachWeeklySummary(scope, portfolio.id);
  go(`/performance/${portfolio.id}`, { notice: `This week's summary (${week}) was saved to the ${scope.brandName} Brain.` });
}

// ----------------------------------------------------------------------------- CSV import

export type ImportPreview = { ok: true; plan: ImportPlan; csv: string; defaultPortfolio: string } | { ok: false; error: string } | null;

async function csvFrom(formData: FormData): Promise<string> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) return "";
    return file.text();
  }
  return String(formData.get("csv") ?? "");
}

async function planFor(scope: TrackScope, csv: string, defaultPortfolio: string): Promise<ImportPlan> {
  return planTable(scope, parseCsv(csv), defaultPortfolio);
}

/** Dry run. Writes nothing. */
export async function previewImport(_previous: ImportPreview, formData: FormData): Promise<ImportPreview> {
  const access = await trackAccess("performance.write");
  if (!access.ok) return { ok: false, error: access.error };
  const csv = (await csvFrom(formData)).slice(0, 2_000_000);
  if (!csv.trim()) return { ok: false, error: "Paste CSV text or choose a CSV file (up to 5 MB)." };
  const defaultPortfolio = text(formData, "defaultPortfolio", 120);
  return { ok: true, plan: await planFor(access.scope, csv, defaultPortfolio), csv, defaultPortfolio };
}

export async function commitImport(formData: FormData) {
  const scope = await writer("/performance/import");
  const csv = String(formData.get("csv") ?? "").slice(0, 2_000_000);
  const defaultPortfolio = text(formData, "defaultPortfolio", 120);
  const plan = await planFor(scope, csv, defaultPortfolio);
  const work = plan.rows.filter((row) => (row.action === "create" || row.action === "close") && row.draft);
  if (!work.length) go("/performance/import", { error: "Nothing to import: every row was a duplicate or had an error." });
  const result = await applyImportPlan(scope, plan, "csv");
  after(() => afterPositionsChanged(scope, result.portfolioIds, result.positionIds.slice(0, 200)));
  const problems = result.problems.length ? ` ${result.problems.length} close(s) could not be applied: ${result.problems.slice(0, 3).join(" ")}` : "";
  go("/performance", { notice: `Imported ${result.created} new and closed ${result.closed} recommendation(s). Prices and history fill in shortly.${problems}` });
}

// ----------------------------------------------------------------------------- call archive

export async function saveExpert(formData: FormData) {
  const scope = await writer("/performance/archive/manage");
  const db = tenantDb(scope.organizationId);
  const id = text(formData, "expertId", 40);
  const name = text(formData, "name", 120);
  if (!name) go("/performance/archive/manage", { error: "Give the expert a name." });
  // The editor this expert is: "" = none, "auto" = match by name when unambiguous, or an editor id.
  const editorRaw = text(formData, "editorId", 40);
  const experts = await db.trackExpert.findMany({ where: { brandId: scope.brandId, deletedAt: null }, select: { id: true, name: true, editorId: true } });
  const others = experts.filter((e) => e.id !== id);
  let editorId: string | null | undefined;
  const current = experts.find((e) => e.id === id)?.editorId ?? null;
  if (!formData.has("editorId")) editorId = undefined;
  else if (current && editorRaw === current) editorId = current; // kept as is, even if that editor was archived
  else if (editorRaw === "auto") editorId = editorForExpertName(name, await getEditors(scope.organizationId, scope.brandId), others)?.id ?? null;
  else editorId = await brandEditorId(scope, editorRaw);
  if (editorId) {
    const taken = others.find((e) => e.editorId === editorId);
    if (taken) go("/performance/archive/manage", { error: `${taken.name} is already linked to that editor. Unlink it first.` });
  }
  const link = editorId === undefined ? {} : { editorId };
  if (id) {
    await db.trackExpert.updateMany({ where: { id, brandId: scope.brandId, deletedAt: null }, data: { name, bio: text(formData, "bio", 2000), ...link } });
    await auditTrack(scope, "trackrecord.expert.updated", "track_expert", id, { editorId: editorId ?? null });
  } else {
    const expert = await db.trackExpert.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, name, bio: text(formData, "bio", 2000), ...link } });
    await auditTrack(scope, "trackrecord.expert.created", "track_expert", expert.id, { editorId: editorId ?? null });
  }
  go("/performance/archive/manage", { notice: `${name} saved.` });
}

/**
 * The expert for a claim added from an editor's profile: the expert linked to that editor, else an unlinked
 * expert with the same (unambiguous) name, which is linked now, else a new expert linked to the editor.
 */
async function expertFromEditor(scope: TrackScope, editorId: string): Promise<string | null> {
  const db = tenantDb(scope.organizationId);
  const editor = UUID.test(editorId) ? await getEditor(scope.organizationId, scope.brandId, editorId) : null;
  if (!editor || editor.archived) return null;
  const [experts, editors] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: scope.brandId, deletedAt: null }, select: { id: true, name: true, editorId: true } }),
    getEditors(scope.organizationId, scope.brandId),
  ]);
  const found = expertForEditor(experts, editor, editors);
  if (found) {
    if (!found.editorId) {
      await db.trackExpert.updateMany({ where: { id: found.id, editorId: null }, data: { editorId: editor.id } });
      await auditTrack(scope, "trackrecord.expert.updated", "track_expert", found.id, { editorId: editor.id });
    }
    return found.id;
  }
  const created = await db.trackExpert.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, name: editor.name, editorId: editor.id } });
  await auditTrack(scope, "trackrecord.expert.created", "track_expert", created.id, { editorId: editor.id, via: "editor-profile" });
  return created.id;
}

export async function deleteExpert(formData: FormData) {
  const scope = await writer("/performance/archive/manage");
  const id = text(formData, "expertId", 40);
  const db = tenantDb(scope.organizationId);
  const calls = UUID.test(id) ? await db.trackCall.count({ where: { expertId: id, deletedAt: null } }) : 0;
  if (calls) go("/performance/archive/manage", { error: `That expert still has ${calls} call(s). Move or delete them first.` });
  await db.trackExpert.updateMany({ where: { id, brandId: scope.brandId }, data: { deletedAt: new Date() } });
  await auditTrack(scope, "trackrecord.expert.deleted", "track_expert", id);
  go("/performance/archive/manage", { notice: "Expert removed." });
}

export async function saveCategory(formData: FormData) {
  const scope = await writer("/performance/archive/manage");
  const db = tenantDb(scope.organizationId);
  const id = text(formData, "categoryId", 40);
  const name = text(formData, "name", 80);
  if (!name) go("/performance/archive/manage", { error: "Give the category a name." });
  const colorRaw = text(formData, "color", 7);
  const color = (CATEGORY_COLORS as readonly string[]).includes(colorRaw) ? colorRaw : CATEGORY_COLORS[0];
  const sortOrder = Math.max(0, Math.min(9999, Number(text(formData, "sortOrder", 6)) || 100));
  const data = { name, color, description: text(formData, "description", 500), sortOrder };
  if (id) {
    await db.trackCategory.updateMany({ where: { id, brandId: scope.brandId }, data });
    await auditTrack(scope, "trackrecord.category.updated", "track_category", id);
  } else {
    const category = await db.trackCategory.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, ...data } });
    await auditTrack(scope, "trackrecord.category.created", "track_category", category.id);
  }
  go("/performance/archive/manage", { notice: `${name} saved.` });
}

export async function deleteCategory(formData: FormData) {
  const scope = await writer("/performance/archive/manage");
  const id = text(formData, "categoryId", 40);
  if (!UUID.test(id)) go("/performance/archive/manage");
  const db = tenantDb(scope.organizationId);
  const tagged = await db.trackCall.findMany({ where: { brandId: scope.brandId, categoryIds: { has: id } }, select: { id: true, categoryIds: true } });
  for (const call of tagged) await db.trackCall.updateMany({ where: { id: call.id }, data: { categoryIds: call.categoryIds.filter((c) => c !== id) } });
  await db.trackCategory.deleteMany({ where: { id, brandId: scope.brandId } });
  await auditTrack(scope, "trackrecord.category.deleted", "track_category", id);
  go("/performance/archive/manage", { notice: "Category deleted. Calls in it were kept." });
}

export async function saveCall(formData: FormData) {
  const scope = await writer("/performance/archive");
  const db = tenantDb(scope.organizationId);
  const callId = text(formData, "callId", 40);
  const expertRaw = text(formData, "expertId", 60);
  // "editor:<id>" = added from an editor's profile; the expert is found or created once the form is valid.
  const fromEditor = !callId && expertRaw.startsWith("editor:") ? expertRaw.slice("editor:".length) : "";
  const back = callId ? `/performance/archive/${callId}` : fromEditor ? `/performance/archive/new?editor=${encodeURIComponent(fromEditor)}` : "/performance/archive/new";
  let expert = UUID.test(expertRaw) ? await db.trackExpert.findFirst({ where: { id: expertRaw, brandId: scope.brandId, deletedAt: null } }) : null;
  if (!expert && !(fromEditor && (await brandEditorId(scope, fromEditor)))) go(back, { error: "Pick the expert who made the call." });
  const title = text(formData, "title", 200);
  if (!title) go(back, { error: "Give the call a title." });
  const ticker = text(formData, "ticker", 24).toUpperCase().replace(/^\$/, "") || null;
  const priceSymbol = (text(formData, "priceSymbol", 40).toUpperCase() || ticker) ?? null;
  const callType = (CALL_TYPES as readonly string[]).includes(text(formData, "callType")) ? text(formData, "callType") : "Recommendation";
  const basisRaw = text(formData, "gainBasis", 10);
  const gainBasis = ["TODAY", "PEAK", "EXIT", "NONE"].includes(basisRaw) ? basisRaw : "TODAY";
  const errors: string[] = [];
  const money = (key: string, label: string) => {
    const value = parseMoney(text(formData, key, 40));
    if (value != null && (Number.isNaN(value) || value <= 0)) {
      errors.push(`${label} must be a positive number.`);
      return null;
    }
    return value;
  };
  const date = (key: string, label: string) => {
    const value = parseDate(text(formData, key, 20));
    if (value === "invalid") {
      errors.push(`${label} is not a date.`);
      return null;
    }
    return value;
  };
  const entryPrice = money("entryPrice", "Entry price");
  const exitPrice = money("exitPrice", "Exit price");
  const recordedPeak = money("recordedPeak", "Recorded peak");
  const recordedPrice = money("recordedPrice", "Last recorded price");
  const targetPrice = money("targetPrice", "Target");
  const callDate = date("callDate", "Call date");
  const exitDate = date("exitDate", "Exit date");
  const recordedPeakAt = date("recordedPeakAt", "Peak date");
  const recordedAt = date("recordedAt", "Recorded price date");
  if (gainBasis === "EXIT" && exitPrice == null) errors.push("Entry to exit needs an exit price.");
  // New backups for the AI to read: the entry price may come from its proposal, so it can wait until the review.
  const willRead = formData.get("aiRead") === "on" && formData.getAll("files").some((file) => file instanceof File && file.size > 0);
  if (gainBasis !== "NONE" && entryPrice == null && !willRead) errors.push("A gain needs the entry price from the backup.");
  const splitText = text(formData, "splitFactor", 20);
  const splitFactor = splitText ? parseSplitFactor(splitText) : null;
  if (splitText && splitFactor == null) errors.push("Split must look like 4:1 or 1:20.");
  if (errors.length) go(back, { error: errors.join(" ") });
  if (!expert) {
    const resolved = await expertFromEditor(scope, fromEditor);
    expert = resolved ? await db.trackExpert.findFirst({ where: { id: resolved, brandId: scope.brandId, deletedAt: null } }) : null;
    if (!expert) go(back, { error: "Pick the expert who made the call." });
  }
  const categories = await db.trackCategory.findMany({ where: { brandId: scope.brandId }, select: { id: true } });
  const allowed = new Set(categories.map((c) => c.id));
  const categoryIds = formData.getAll("categoryIds").map(String).filter((id) => allowed.has(id));
  const data = {
    expertId: expert.id,
    title,
    ticker,
    priceSymbol,
    callType,
    direction: text(formData, "direction") === "SHORT" ? "SHORT" : "LONG",
    callDate,
    source: text(formData, "source", 300),
    gainBasis,
    entryPrice,
    exitPrice,
    exitDate,
    recordedPeak,
    recordedPeakAt,
    recordedPrice,
    recordedAt,
    categoryIds,
    keyQuote: text(formData, "keyQuote", 4000),
    notes: text(formData, "notes", 8000),
    targetPrice,
    peakCheckedAt: null,
    ...(splitFactor != null ? { splitFactor, splitSource: "manual" } : {}),
  };
  let id = callId;
  if (callId) {
    const existing = UUID.test(callId) ? await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null } }) : null;
    if (!existing) go("/performance/archive", { error: "That call no longer exists." });
    const clearSplit = splitFactor == null && existing.splitSource === "manual";
    // Prices the AI read from a document stay flagged until a person changes them or marks them checked.
    const aiFields = formData.getAll("aiFields").map(String);
    const flagged = pricesToCheck(aiFields, storedProposal(existing.aiProposal), { entryPrice, targetPrice, exitPrice });
    const kept = existing.priceCheck.filter((field) => {
      const before = existing[field as (typeof PRICE_FIELDS)[number]];
      const after = { entryPrice, targetPrice, exitPrice }[field as (typeof PRICE_FIELDS)[number]];
      return (PRICE_FIELDS as readonly string[]).includes(field) && before != null && after != null && Math.abs(before - after) < 1e-9;
    });
    const priceCheck = [...new Set([...kept, ...flagged])];
    await db.trackCall.updateMany({ where: { id: callId }, data: { ...data, priceCheck, ...(formData.get("fromProposal") ? { aiStatus: "reviewed" } : {}), ...(clearSplit ? { splitFactor: 1, splitSource: "none" } : {}) } });
    await auditTrack(scope, "trackrecord.call.updated", "track_call", callId);
  } else {
    const created = await db.trackCall.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, createdById: scope.actorId, ...data } });
    id = created.id;
    await auditTrack(scope, "trackrecord.call.created", "track_call", created.id);
  }
  const files = formData.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
  const roleRaw = text(formData, "fileRole", 20);
  const role = (FILE_ROLES as readonly string[]).includes(roleRaw) ? roleRaw : "BACKUP";
  let skipped = 0;
  for (const file of files.slice(0, 20)) {
    if (file.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const createdFile = await db.trackCallFile.create({
      data: {
        organizationId: scope.organizationId,
        callId: id,
        role,
        filename: file.name.slice(0, 200) || "backup",
        mimeType: (file.type || "application/octet-stream").slice(0, 100),
        size: bytes.length,
        data: bytes,
        uploadedById: scope.actorId,
      },
    });
    await auditTrack(scope, "trackrecord.call.file.added", "track_call_file", createdFile.id);
  }
  const aiRead = formData.get("aiRead") === "on" && files.length - skipped > 0;
  if (aiRead) await db.trackCall.updateMany({ where: { id }, data: { aiStatus: "running", aiError: null, aiRunAt: new Date() } });
  after(async () => {
    const rows = await db.trackCall.findMany({ where: { id } });
    await refreshCallHistory(scope.organizationId, rows, { force: true });
    if (aiRead) await runBackupRead(scope, id);
  });
  go(
    `/performance/archive/${id}`,
    skipped ? { error: `Saved, but ${skipped} file(s) over 25 MB were skipped.` } : { notice: aiRead ? "Call saved. The AI is reading the new files." : "Call saved." },
  );
}

export async function deleteCall(formData: FormData) {
  const scope = await writer("/performance/archive");
  const callId = text(formData, "callId", 40);
  const db = tenantDb(scope.organizationId);
  const call = UUID.test(callId) ? await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null } }) : null;
  if (!call) go("/performance/archive");
  await db.trackCall.updateMany({ where: { id: call.id }, data: { deletedAt: new Date() } });
  await auditTrack(scope, "trackrecord.call.deleted", "track_call", call.id);
  go(`/performance/archive?expert=${call.expertId}`, { notice: "Call deleted." });
}

export async function deleteCallFile(formData: FormData) {
  const scope = await writer("/performance/archive");
  const callId = text(formData, "callId", 40);
  const fileId = text(formData, "fileId", 40);
  const db = tenantDb(scope.organizationId);
  const call = UUID.test(callId) ? await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null }, select: { id: true } }) : null;
  if (!call || !UUID.test(fileId)) go("/performance/archive");
  await db.trackCallFile.deleteMany({ where: { id: fileId, callId: call.id } });
  await auditTrack(scope, "trackrecord.call.file.deleted", "track_call_file", fileId);
  go(`/performance/archive/${call.id}`, { notice: "File removed." });
}

export async function refreshCall(formData: FormData) {
  const scope = await writer("/performance/archive");
  const callId = text(formData, "callId", 40);
  const db = tenantDb(scope.organizationId);
  const call = UUID.test(callId) ? await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null } }) : null;
  if (!call) go("/performance/archive");
  if (call.priceSymbol) await loadQuotes(scope.organizationId, [call.priceSymbol], { force: true });
  const errors = await refreshCallHistory(scope.organizationId, [call], { force: true });
  go(`/performance/archive/${call.id}`, errors.length ? { error: errors.join(" ") } : { notice: "Prices refreshed." });
}

// ----------------------------------------------------------------------------- AI read of backups

/** Start the AI read of a call's backups. It proposes fields; a person reviews them in the form. */
export async function readCallBackups(formData: FormData) {
  const scope = await writer("/performance/archive");
  const callId = text(formData, "callId", 40);
  const db = tenantDb(scope.organizationId);
  const call = UUID.test(callId) ? await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null } }) : null;
  if (!call) go("/performance/archive");
  const running = call.aiStatus === "running" && call.aiRunAt && Date.now() - call.aiRunAt.getTime() < AI_RUN_STALE_MS;
  if (running) go(`/performance/archive/${call.id}`, { notice: "The AI is already reading the backups." });
  if (!(await db.trackCallFile.count({ where: { callId: call.id } }))) go(`/performance/archive/${call.id}`, { error: "Add a screenshot, PDF or transcript first." });
  await db.trackCall.updateMany({ where: { id: call.id }, data: { aiStatus: "running", aiError: null, aiRunAt: new Date() } });
  await auditTrack(scope, "trackrecord.call.ai-read", "track_call", call.id);
  after(() => runBackupRead(scope, call.id));
  go(`/performance/archive/${call.id}`, { notice: "Reading the backups. The proposal appears here when it is ready." });
}

/** A person checked the AI-read prices against the backup. */
export async function markPricesChecked(formData: FormData) {
  const scope = await writer("/performance/archive");
  const callId = text(formData, "callId", 40);
  const db = tenantDb(scope.organizationId);
  const call = UUID.test(callId) ? await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null } }) : null;
  if (!call) go("/performance/archive");
  await db.trackCall.updateMany({ where: { id: call.id }, data: { priceCheck: [] } });
  await auditTrack(scope, "trackrecord.call.prices-checked", "track_call", call.id, { fields: call.priceCheck });
  go(`/performance/archive/${call.id}`, { notice: "Marked as checked against the backup." });
}

export async function dismissProposal(formData: FormData) {
  const scope = await writer("/performance/archive");
  const callId = text(formData, "callId", 40);
  if (!UUID.test(callId)) go("/performance/archive");
  await tenantDb(scope.organizationId).trackCall.updateMany({ where: { id: callId, brandId: scope.brandId }, data: { aiProposal: Prisma.DbNull, aiStatus: "none", aiError: null } });
  go(`/performance/archive/${callId}`, { notice: "Proposal dismissed." });
}
