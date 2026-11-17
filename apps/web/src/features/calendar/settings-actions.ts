"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { guessFieldMap, isBaseId, maskToken, openToken, readFieldMap, sealToken, SYNC_FIELDS, type SyncEntity } from "../../../../../modules/editorial/airtable";
import { fromDay, isDay } from "../../../../../modules/editorial/dates";
import { isCubEmailKind, parseEmails, TEMPLATES } from "../../../../../modules/editorial/emails";
import { cleanOption, isOptionField, moveOption } from "../../../../../modules/editorial/options";
import { isTrashKind } from "../../../../../modules/editorial/trash";
import { AirtableError, authSecret, getConnection, loadSchema, syncConnection } from "./airtable-sync";
import { calendarAction, field, UUID, withMessage } from "./context";
import { loadOptions } from "./options";
import { findPromo, setPromoStage } from "./promos";
import { saveListMapping } from "./stats";
import { teachEvent, teachIssue } from "./teach";
import { marketConfigured, refreshTickerPrices, showsTickers } from "./tickers";
import { purgeFromTrash, restoreFromTrash, trashSeries } from "./trash";

const SETUP = "/editorial/setup";

// ── Email templates ─────────────────────────────────────────────────────────

export async function saveTemplateAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", `${SETUP}#emails`);
  const kind = field(formData, "kind", 40);
  if (!isCubEmailKind(kind)) redirect(SETUP);
  const back = `${SETUP}?tab=emails#${kind}`;
  const subject = field(formData, "subject", 250);
  const body = String(formData.get("body") ?? "").slice(0, 10_000);
  if (!subject || !body.trim()) redirect(withMessage(back, "error", "A template needs a subject and a body."));
  const recipients = TEMPLATES[kind].hasRecipientGroup ? parseEmails(field(formData, "recipients", 5000)) : { valid: [], invalid: [] };
  if (recipients.invalid.length) redirect(withMessage(back, "error", `These do not look like email addresses: ${recipients.invalid.slice(0, 5).join(", ")}.`));
  const enabled = formData.get("enabled") === "1";
  const db = tenantDb(ctx.resolved.id);
  const existing = await db.calendarEmailTemplate.findFirst({ where: { brandId: ctx.brand.id, kind } });
  const data = { subject, body, recipients: recipients.valid, enabled, updatedById: ctx.actorId };
  if (existing) await db.calendarEmailTemplate.updateMany({ where: { id: existing.id }, data });
  else await db.calendarEmailTemplate.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, kind, ...data } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.email_template.saved", targetType: "calendar_email_template", targetId: kind, metadata: { enabled, recipients: recipients.valid.length } });
  redirect(withMessage(back, "notice", `${TEMPLATES[kind].label} saved.`));
}

export async function resetTemplateAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", SETUP);
  const kind = field(formData, "kind", 40);
  if (!isCubEmailKind(kind)) redirect(SETUP);
  const db = tenantDb(ctx.resolved.id);
  const existing = await db.calendarEmailTemplate.findFirst({ where: { brandId: ctx.brand.id, kind } });
  // Keep the reviewer group; only the wording goes back to the default.
  if (existing) await db.calendarEmailTemplate.updateMany({ where: { id: existing.id }, data: { subject: TEMPLATES[kind].subject, body: TEMPLATES[kind].body, enabled: true, updatedById: ctx.actorId } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.email_template.reset", targetType: "calendar_email_template", targetId: kind });
  redirect(withMessage(`${SETUP}?tab=emails#${kind}`, "notice", "Back to the default wording."));
}

// ── Field options ───────────────────────────────────────────────────────────

/** Write a field's whole list in order (the first edit copies the defaults in). */
async function writeOptions(organizationId: string, brandId: string, fieldKey: string, values: string[]) {
  const db = tenantDb(organizationId);
  await db.calendarFieldOption.deleteMany({ where: { brandId, field: fieldKey } });
  for (const [i, value] of values.entries()) await db.calendarFieldOption.create({ data: { organizationId, brandId, field: fieldKey, value, sortOrder: i } });
}

export async function optionAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", SETUP);
  const fieldKey = field(formData, "field", 40);
  if (!isOptionField(fieldKey)) redirect(SETUP);
  const back = `${SETUP}?tab=options#${fieldKey}`;
  const op = field(formData, "op", 10);
  const value = cleanOption(field(formData, "value", 80));
  const current = (await loadOptions(ctx.resolved.id, ctx.brand.id))[fieldKey];
  let next = current;
  let message = "Saved.";
  if (op === "add") {
    if (!value) redirect(withMessage(back, "error", "Type the new option."));
    if (current.includes(value)) redirect(withMessage(back, "error", `${value} is already in the list.`));
    if (current.length >= 60) redirect(withMessage(back, "error", "A list holds up to 60 options."));
    next = [...current, value];
    message = `${value} added.`;
  } else if (op === "remove") {
    if (current.length <= 1) redirect(withMessage(back, "error", "Keep at least one option."));
    next = current.filter((v) => v !== value);
    message = `${value} removed. Records that use it keep it.`;
  } else if (op === "up" || op === "down") {
    next = moveOption(current, value, op === "up" ? -1 : 1);
  } else if (op === "rename") {
    const to = cleanOption(field(formData, "to", 80));
    if (!to || current.includes(to)) redirect(withMessage(back, "error", to ? `${to} is already in the list.` : "Type the new name."));
    next = current.map((v) => (v === value ? to : v));
    message = `${value} renamed to ${to}. Existing records keep the old value until edited.`;
  } else if (op === "reset") {
    await tenantDb(ctx.resolved.id).calendarFieldOption.deleteMany({ where: { brandId: ctx.brand.id, field: fieldKey } });
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.options.reset", targetType: "calendar_field_option", targetId: fieldKey });
    redirect(withMessage(back, "notice", "Back to the built-in list."));
  } else redirect(back);
  await writeOptions(ctx.resolved.id, ctx.brand.id, fieldKey, next);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.options.updated", targetType: "calendar_field_option", targetId: fieldKey, metadata: { op, count: next.length } });
  redirect(withMessage(back, "notice", message));
}

// ── Saved list mappings ─────────────────────────────────────────────────────

export async function saveListMappingAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/stats");
  const back = field(formData, "back", 200).startsWith("/editorial/stats") ? field(formData, "back", 200) : "/editorial/stats";
  const label = field(formData, "label", 200);
  const pubCode = field(formData, "pubCode", 40);
  if (!label) redirect(withMessage(back, "error", "Type the list label exactly as it appears in your export."));
  if (pubCode && !(await tenantDb(ctx.resolved.id).calendarPublication.findFirst({ where: { brandId: ctx.brand.id, code: pubCode } }))) {
    redirect(withMessage(back, "error", "Pick one of your publications, or Ignore."));
  }
  const id = await saveListMapping({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, label, pubCode, actorId: ctx.actorId });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.list_mapping.saved", targetType: "calendar_list_mapping", targetId: id, metadata: { pubCode: pubCode || "ignore" } });
  redirect(withMessage(back, "notice", `Saved: “${label}” ${pubCode ? `→ ${pubCode}` : "is ignored"}. Import the file again to use it.`));
}

export async function deleteListMappingAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/stats");
  const id = field(formData, "mappingId", 40);
  if (UUID.test(id)) await tenantDb(ctx.resolved.id).calendarListMapping.deleteMany({ where: { id, brandId: ctx.brand.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.list_mapping.deleted", targetType: "calendar_list_mapping", targetId: id });
  redirect(withMessage("/editorial/stats#mappings", "notice", "Mapping removed."));
}

// ── Trash ───────────────────────────────────────────────────────────────────

export async function trashSeriesAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write");
  const seriesId = field(formData, "seriesId", 40);
  if (!UUID.test(seriesId)) redirect("/editorial");
  const count = await trashSeries(ctx.resolved.id, ctx.brand.id, seriesId);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.series.trashed", targetType: "calendar_series", targetId: seriesId, metadata: { occurrences: count } });
  redirect(withMessage("/editorial", "notice", `The series and ${count} occurrences went to the trash. Restore them from Setup → Trash.`));
}

export async function restoreAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", `${SETUP}?tab=trash`);
  const kind = field(formData, "kind", 10);
  const id = field(formData, "id", 40);
  const back = `${SETUP}?tab=trash`;
  if (!isTrashKind(kind) || !UUID.test(id)) redirect(back);
  const result = await restoreFromTrash(ctx.resolved.id, ctx.brand.id, kind, id);
  if ("error" in result) redirect(withMessage(back, "error", result.error));
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: `calendar.${kind}.restored`, targetType: `calendar_${kind}`, targetId: id, metadata: { events: result.events.length } });
  after(async () => {
    for (const eventId of result.events.slice(0, 30)) await teachEvent({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, eventId, actorId: ctx.actorId });
    for (const issueId of result.issues) await teachIssue({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, issueId, actorId: ctx.actorId });
  });
  const target = kind === "issue" ? `/editorial/issues/${id}` : kind === "event" ? `/editorial/events/${id}` : result.events[0] ? `/editorial/events/${result.events[0]}` : back;
  redirect(withMessage(target, "notice", kind === "series" ? `Series restored with ${result.events.length} occurrences.` : "Restored."));
}

export async function purgeAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", `${SETUP}?tab=trash`);
  const kind = field(formData, "kind", 10);
  const id = field(formData, "id", 40);
  const back = `${SETUP}?tab=trash`;
  if (!isTrashKind(kind) || !UUID.test(id) || formData.get("confirm") !== "1") redirect(withMessage(back, "error", "Tick the box to confirm."));
  const count = await purgeFromTrash(ctx.resolved.id, ctx.brand.id, kind, id);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: `calendar.${kind}.purged`, targetType: `calendar_${kind}`, targetId: id, metadata: { count } });
  redirect(withMessage(back, "notice", count ? "Deleted for good." : "Nothing to delete."));
}

// ── Promo pipeline ──────────────────────────────────────────────────────────

export async function savePromoTrackAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/promos");
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, field(formData, "promoId", 40));
  if (!promo) redirect(withMessage("/editorial/promos", "error", "That promo no longer exists."));
  const options = await loadOptions(ctx.resolved.id, ctx.brand.id);
  const stage = field(formData, "stage", 60);
  const back = field(formData, "back", 100) === "board" ? "/editorial/promos" : `/editorial/promos?promo=${promo.id}`;
  if (!options["promo.stage"].includes(stage) && stage !== promo.stage) redirect(withMessage(back, "error", "Pick a stage from the list."));
  const launch = field(formData, "launchDate", 10);
  const from = await setPromoStage({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, promoId: promo.id, stage, actorId: ctx.actorId });
  if (formData.has("launchDate")) {
    await tenantDb(ctx.resolved.id).calendarPromoTrack.updateMany({
      where: { promoId: promo.id },
      data: {
        launchDate: isDay(launch) ? fromDay(launch) : null,
        launchEstimated: formData.get("launchEstimated") === "1",
        writers: field(formData, "writers", 600).split(",").map((w) => w.trim()).filter(Boolean).slice(0, 10),
        notes: field(formData, "notes", 4000) || null,
      },
    });
  }
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.promo.stage", targetType: "promo", targetId: promo.id, metadata: { from, to: stage } });
  redirect(withMessage(back, "notice", `${promo.title}: ${stage}.`));
}

// ── Airtable ────────────────────────────────────────────────────────────────

const AT = `${SETUP}?tab=airtable`;

export async function saveAirtableAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", AT);
  const baseId = field(formData, "baseId", 40);
  const token = field(formData, "token", 300);
  if (!isBaseId(baseId)) redirect(withMessage(AT, "error", "The base id starts with “app” (find it in the base's URL)."));
  const db = tenantDb(ctx.resolved.id);
  const existing = await getConnection(ctx.resolved.id, ctx.brand.id);
  if (!token && !existing) redirect(withMessage(AT, "error", "Paste a personal access token."));
  let tokenEnc: string | undefined;
  try {
    tokenEnc = token ? sealToken(token, authSecret()) : undefined;
  } catch (error) {
    redirect(withMessage(AT, "error", error instanceof Error ? error.message : "Could not store the token."));
  }
  const data = {
    baseId,
    eventsTable: field(formData, "eventsTable", 120) || null,
    issuesTable: field(formData, "issuesTable", 120) || null,
    readOnlyFields: field(formData, "readOnlyFields", 2000).split(/[,\n]/).map((f) => f.trim()).filter(Boolean).slice(0, 100),
    enabled: formData.get("enabled") === "1",
    updatedById: ctx.actorId,
  };
  if (existing) await db.calendarAirtableConnection.updateMany({ where: { id: existing.id }, data: { ...data, ...(tokenEnc ? { tokenEnc } : {}) } });
  else await db.calendarAirtableConnection.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data, tokenEnc: tokenEnc! } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.airtable.saved", targetType: "calendar_airtable_connection", targetId: ctx.brand.id, metadata: { baseId, token: token ? maskToken(token) : "unchanged", enabled: data.enabled } });
  redirect(withMessage(AT, "notice", "Connection saved. Read the tables next to map the fields."));
}

/** Read the base's tables and field types; guess a mapping for any table that has none. */
export async function readAirtableSchemaAction() {
  const ctx = await calendarAction("editorial.write", AT);
  const conn = await getConnection(ctx.resolved.id, ctx.brand.id);
  if (!conn) redirect(withMessage(AT, "error", "Save the connection first."));
  let message = "";
  try {
    const tables = await loadSchema(conn.baseId, openToken(conn.tokenEnc, authSecret()));
    const update: Record<string, Prisma.InputJsonValue> = {};
    for (const entity of ["event", "issue"] as SyncEntity[]) {
      const name = entity === "event" ? conn.eventsTable : conn.issuesTable;
      const table = tables.find((t) => t.name === name || t.id === name);
      if (!table) continue;
      const current = readFieldMap(entity === "event" ? conn.eventFields : conn.issueFields);
      const types = Object.fromEntries(table.fields.map((f) => [f.name, f.type]));
      const fields = Object.keys(current.fields).length ? current.fields : guessFieldMap(entity, table.fields.map((f) => f.name));
      const modifiedField = current.modifiedField ?? table.fields.find((f) => f.type === "lastModifiedTime")?.name ?? null;
      update[entity === "event" ? "eventFields" : "issueFields"] = { fields, modifiedField, types } as Prisma.InputJsonValue;
    }
    await tenantDb(ctx.resolved.id).calendarAirtableConnection.updateMany({ where: { id: conn.id }, data: { ...update, lastError: null } });
    message = `Read ${tables.length} table${tables.length === 1 ? "" : "s"}: ${tables.map((t) => t.name).slice(0, 8).join(", ")}.`;
  } catch (error) {
    redirect(withMessage(AT, "error", error instanceof AirtableError || error instanceof Error ? error.message : "Could not read the base."));
  }
  redirect(withMessage(AT, "notice", message));
}

export async function saveFieldMapAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", AT);
  const entity = field(formData, "entity", 10) === "issue" ? "issue" : "event";
  const conn = await getConnection(ctx.resolved.id, ctx.brand.id);
  if (!conn) redirect(withMessage(AT, "error", "Save the connection first."));
  const current = readFieldMap(entity === "event" ? conn.eventFields : conn.issueFields);
  const fields: Record<string, string> = {};
  for (const f of SYNC_FIELDS[entity]) {
    const name = field(formData, `f_${f.key}`, 120);
    if (name) fields[f.key] = name;
  }
  const modifiedField = field(formData, "modifiedField", 120) || null;
  const map = { fields, modifiedField, types: current.types };
  await tenantDb(ctx.resolved.id).calendarAirtableConnection.updateMany({ where: { id: conn.id }, data: entity === "event" ? { eventFields: map } : { issueFields: map } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.airtable.mapping", targetType: "calendar_airtable_connection", targetId: ctx.brand.id, metadata: { entity, mapped: Object.keys(fields).length } });
  redirect(withMessage(`${AT}#map-${entity}`, "notice", `${entity === "event" ? "Event" : "Issue"} field mapping saved.`));
}

export async function syncAirtableNowAction() {
  const ctx = await calendarAction("editorial.write", AT);
  const conn = await getConnection(ctx.resolved.id, ctx.brand.id);
  if (!conn) redirect(withMessage(AT, "error", "Save the connection first."));
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.airtable.sync", targetType: "calendar_airtable_connection", targetId: ctx.brand.id });
  after(() => syncConnection(conn).then(() => undefined));
  redirect(withMessage(AT, "notice", "Sync started. Refresh in a minute to see the result."));
}

export async function disconnectAirtableAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", AT);
  if (formData.get("confirm") !== "1") redirect(withMessage(AT, "error", "Tick the box to confirm."));
  await tenantDb(ctx.resolved.id).calendarAirtableConnection.deleteMany({ where: { brandId: ctx.brand.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.airtable.disconnected", targetType: "calendar_airtable_connection", targetId: ctx.brand.id });
  redirect(withMessage(AT, "notice", "Airtable disconnected. Calendar data stays as it is."));
}

// ── Tickers ─────────────────────────────────────────────────────────────────

export async function refreshTickersAction() {
  const ctx = await calendarAction("editorial.write", "/editorial/tickers");
  if (!showsTickers(ctx.brand)) redirect("/editorial");
  if (!marketConfigured()) redirect(withMessage("/editorial/tickers", "error", "Market data is not connected yet."));
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.tickers.refreshed", targetType: "calendar_ticker_price", targetId: ctx.brand.id });
  after(() => refreshTickerPrices(ctx.resolved.id, ctx.brand.id).then(() => undefined));
  redirect(withMessage("/editorial/tickers", "notice", "Refreshing prices. Reload in a minute."));
}

