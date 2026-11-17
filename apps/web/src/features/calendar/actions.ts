"use server";

import { runText } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { writingAssist } from "../../../../../modules/editorial/assist";
import { isDay } from "../../../../../modules/editorial/dates";
import { normalizeScope } from "../../../../../modules/editorial/recurrence";
import { missingRequired, parseCsv } from "../../../../../modules/editorial/stats";
import { acceptOption, type OptionLists } from "../../../../../modules/editorial/options";
import { isHexColor, validateEventDates } from "../../../../../modules/editorial/stages";
import { parseTickers } from "../../../../../modules/editorial/tickers";
import { pushRecord } from "./airtable-sync";
import { loadOptions } from "./options";
import { findPromo } from "./promos";
import { calendarAction, field, int, list, money, optional, time, url, UUID, withMessage, type CalendarCtx } from "./context";
import { createEvent, deleteEvent, parseRepeat, updateEvent, type EventInput } from "./events";
import { logAiUsage } from "../ai/usage";
import { importStats, mappingFromForm } from "./stats";
import { teachEvent, teachIssue } from "./teach";
import { runWhatsWorking, WINDOW_DAYS } from "./whats-working";

function day(formData: FormData, key: string): string | null {
  const value = field(formData, key, 10);
  return isDay(value) ? value : null;
}

function eventInput(formData: FormData, options: OptionLists | null, current: string | null = null): EventInput {
  const stage = field(formData, "stage", 60);
  return {
    name: field(formData, "name", 200),
    eventType: optional(formData, "eventType", 80),
    format: optional(formData, "format", 80),
    stage: options ? acceptOption("event.stage", stage, options, current, options["event.stage"][0] ?? "Idea") : stage || "Idea",
    marketingStart: day(formData, "marketingStart"),
    eventDate: day(formData, "eventDate"),
    eventEnd: day(formData, "eventEnd"),
    marketingEnd: day(formData, "marketingEnd"),
    startTime: time(formData, "startTime"),
    endTime: time(formData, "endTime"),
    channels: list(formData, "channels"),
    hosts: list(formData, "hosts"),
    offer: optional(formData, "offer", 300),
    promoCode: optional(formData, "promoCode", 80),
    ctaLink: url(formData, "ctaLink"),
    registrationLink: url(formData, "registrationLink"),
    replayLink: url(formData, "replayLink"),
    notes: optional(formData, "notes", 10000),
    peakAttendance: int(formData, "peakAttendance"),
    avgAttendance: int(formData, "avgAttendance"),
    registrations: int(formData, "registrations"),
    newSubscribers: int(formData, "newSubscribers"),
    leads: int(formData, "leads"),
    orders: int(formData, "orders"),
    revenue: money(formData, "revenue"),
    messages: int(formData, "messages"),
  };
}

function teachEventsLater(ctx: CalendarCtx, ids: string[]) {
  after(async () => {
    for (const id of ids.slice(0, 30)) await teachEvent({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, eventId: id, actorId: ctx.actorId });
    // Airtable write-back (soft-fail, logged); the sync job retries anything left over.
    for (const id of ids.slice(0, 100)) await pushRecord({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, entity: "event", id });
  });
}

function issueSavedLater(ctx: CalendarCtx, issueId: string) {
  after(async () => {
    await teachIssue({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, issueId, actorId: ctx.actorId });
    await pushRecord({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, entity: "issue", id: issueId });
  });
}

/** The picked Promo Analyzer promo, if it belongs to this brand. "" clears the link. */
async function promoIdFrom(ctx: CalendarCtx, formData: FormData): Promise<string | null> {
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, field(formData, "promoId", 40));
  return promo?.id ?? null;
}

export async function createEventAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/events/new");
  const data = eventInput(formData, await loadOptions(ctx.resolved.id, ctx.brand.id));
  if (!data.name) redirect(withMessage("/editorial/events/new", "error", "Give the event a name."));
  const errors = validateEventDates(data);
  if (errors.length) redirect(withMessage("/editorial/events/new", "error", errors.join(" ")));
  const repeat = parseRepeat(field(formData, "repeat", 20));
  if (repeat && !data.eventDate) redirect(withMessage("/editorial/events/new", "error", "A repeating event needs an event date."));
  const { id, generated } = await createEvent({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId, data, repeat, until: day(formData, "repeatUntil") });
  const promoId = await promoIdFrom(ctx, formData);
  if (promoId) await tenantDb(ctx.resolved.id).calendarEvent.updateMany({ where: { id }, data: { promoId } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.event.created", targetType: "calendar_event", targetId: id });
  teachEventsLater(ctx, [id]);
  redirect(withMessage(`/editorial/events/${id}`, "notice", generated ? `Event saved with ${generated} more occurrences.` : "Event saved."));
}

export async function quickAddAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write");
  const kind = field(formData, "kind", 10);
  const title = field(formData, "title", 200);
  const date = day(formData, "date");
  if (!title) redirect(withMessage("/editorial", "error", "Type a name first."));
  const db = tenantDb(ctx.resolved.id);
  if (kind === "issue") {
    const code = field(formData, "publicationCode", 40);
    const pub = await db.calendarPublication.findFirst({ where: { brandId: ctx.brand.id, code } });
    if (!pub) redirect(withMessage("/editorial", "error", "Pick a publication for the issue (add one under Setup)."));
    const issue = await db.calendarIssue.create({
      data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, title, publicationCode: pub.code, mailDate: date ? new Date(`${date}T00:00:00Z`) : null, createdById: ctx.actorId, updatedById: ctx.actorId },
      select: { id: true },
    });
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.issue.created", targetType: "calendar_issue", targetId: issue.id });
    issueSavedLater(ctx, issue.id);
    redirect(withMessage(`/editorial/issues/${issue.id}`, "notice", "Issue added. Fill in the rest when you are ready."));
  }
  const { id } = await createEvent({
    organizationId: ctx.resolved.id,
    brandId: ctx.brand.id,
    actorId: ctx.actorId,
    data: { ...eventInput(new FormData(), null), name: title, eventDate: date, stage: (await loadOptions(ctx.resolved.id, ctx.brand.id))["event.stage"][0] ?? "Idea" },
    repeat: null,
    until: null,
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.event.created", targetType: "calendar_event", targetId: id });
  teachEventsLater(ctx, [id]);
  redirect(withMessage(`/editorial/events/${id}`, "notice", "Event added. Fill in the rest when you are ready."));
}

async function ownEvent(ctx: CalendarCtx, id: string) {
  const event = UUID.test(id) ? await tenantDb(ctx.resolved.id).calendarEvent.findFirst({ where: { id, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!event) redirect(withMessage("/editorial", "error", "That event no longer exists."));
  return event;
}

export async function updateEventAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write");
  const before = await ownEvent(ctx, field(formData, "eventId", 40));
  const scope = normalizeScope(field(formData, "scope", 20));
  const back = `/editorial/events/${before.id}/edit?scope=${scope}`;
  const data = eventInput(formData, await loadOptions(ctx.resolved.id, ctx.brand.id), before.stage);
  if (!data.name) redirect(withMessage(back, "error", "Give the event a name."));
  const errors = validateEventDates(data);
  if (errors.length) redirect(withMessage(back, "error", errors.join(" ")));
  // In single scope the cadence controls are hidden and ignored: one edit never reshapes the series.
  const repeat = parseRepeat(field(formData, "repeat", 20));
  const { touched, action } = await updateEvent({
    organizationId: ctx.resolved.id,
    brandId: ctx.brand.id,
    actorId: ctx.actorId,
    before,
    data,
    scope,
    repeat,
    until: day(formData, "repeatUntil"),
  });
  // The promo link belongs to this occurrence only.
  const promoId = await promoIdFrom(ctx, formData);
  if (promoId !== before.promoId) await tenantDb(ctx.resolved.id).calendarEvent.updateMany({ where: { id: before.id }, data: { promoId } });
  await appendOrgAudit(ctx.resolved.id, {
    actorId: ctx.actorId,
    action: "calendar.event.updated",
    targetType: "calendar_event",
    targetId: before.id,
    metadata: { scope, seriesAction: action, touched: touched.length },
  });
  teachEventsLater(ctx, touched);
  const message = touched.length > 1 ? `Saved this and ${touched.length - 1} later occurrences.` : "Saved.";
  redirect(withMessage(`/editorial/events/${before.id}`, "notice", message));
}

export async function deleteEventAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write");
  const event = await ownEvent(ctx, field(formData, "eventId", 40));
  const scope = normalizeScope(field(formData, "scope", 20));
  const count = await deleteEvent({ organizationId: ctx.resolved.id, event, scope });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.event.deleted", targetType: "calendar_event", targetId: event.id, metadata: { scope, count } });
  redirect(withMessage("/editorial", "notice", `${count > 1 ? `${count} occurrences` : "Event"} moved to the trash. Restore from Setup → Trash.`));
}

function issueData(formData: FormData, options: OptionLists, current: string | null = null) {
  const status = field(formData, "status", 60);
  return {
    title: field(formData, "title", 200),
    publicationCode: field(formData, "publicationCode", 40),
    mailDate: day(formData, "mailDate"),
    subjectLines: String(formData.get("subjectLines") ?? "")
      .split("\n")
      .map((line) => line.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 10),
    status: acceptOption("issue.status", status, options, current, options["issue.status"].includes("Planned") ? "Planned" : (options["issue.status"][0] ?? "Planned")),
    issueType: optional(formData, "issueType", 80),
    writer: optional(formData, "writer", 120),
    body: optional(formData, "body", 100_000),
    notes: optional(formData, "notes", 10_000),
    websiteLink: url(formData, "websiteLink"),
    ctaLink: url(formData, "ctaLink"),
    offer: optional(formData, "offer", 300),
    tickers: parseTickers(field(formData, "tickers", 400)),
  };
}

async function checkPublication(ctx: CalendarCtx, code: string, back: string) {
  const pub = code ? await tenantDb(ctx.resolved.id).calendarPublication.findFirst({ where: { brandId: ctx.brand.id, code } }) : null;
  if (!pub) redirect(withMessage(back, "error", "Pick a publication. Add publications under Setup."));
}

export async function createIssueAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/issues/new");
  const data = { ...issueData(formData, await loadOptions(ctx.resolved.id, ctx.brand.id)), promoId: await promoIdFrom(ctx, formData) };
  if (!data.title) redirect(withMessage("/editorial/issues/new", "error", "Give the issue a title."));
  await checkPublication(ctx, data.publicationCode, "/editorial/issues/new");
  const issue = await tenantDb(ctx.resolved.id).calendarIssue.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      ...data,
      mailDate: data.mailDate ? new Date(`${data.mailDate}T00:00:00Z`) : null,
      createdById: ctx.actorId,
      updatedById: ctx.actorId,
    },
    select: { id: true },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.issue.created", targetType: "calendar_issue", targetId: issue.id });
  issueSavedLater(ctx, issue.id);
  redirect(withMessage(`/editorial/issues/${issue.id}`, "notice", "Issue saved."));
}

async function ownIssue(ctx: CalendarCtx, id: string) {
  const issue = UUID.test(id) ? await tenantDb(ctx.resolved.id).calendarIssue.findFirst({ where: { id, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!issue) redirect(withMessage("/editorial", "error", "That issue no longer exists."));
  return issue;
}

export async function updateIssueAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write");
  const issue = await ownIssue(ctx, field(formData, "issueId", 40));
  const back = `/editorial/issues/${issue.id}/edit`;
  const data = { ...issueData(formData, await loadOptions(ctx.resolved.id, ctx.brand.id), issue.status), promoId: await promoIdFrom(ctx, formData) };
  if (!data.title) redirect(withMessage(back, "error", "Give the issue a title."));
  await checkPublication(ctx, data.publicationCode, back);
  await tenantDb(ctx.resolved.id).calendarIssue.updateMany({
    where: { id: issue.id },
    data: { ...data, mailDate: data.mailDate ? new Date(`${data.mailDate}T00:00:00Z`) : null, updatedById: ctx.actorId },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.issue.updated", targetType: "calendar_issue", targetId: issue.id });
  issueSavedLater(ctx, issue.id);
  redirect(withMessage(`/editorial/issues/${issue.id}`, "notice", "Saved."));
}

export async function deleteIssueAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write");
  const issue = await ownIssue(ctx, field(formData, "issueId", 40));
  await tenantDb(ctx.resolved.id).calendarIssue.updateMany({ where: { id: issue.id }, data: { deletedAt: new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.issue.deleted", targetType: "calendar_issue", targetId: issue.id });
  redirect(withMessage("/editorial", "notice", "Issue moved to the trash. Restore it from Setup → Trash."));
}

// Publications are owned by Publication Setup now (features/pubsetup/actions.ts):
// the calendar no longer creates, edits or deletes them.

export async function saveChannelAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/setup");
  const name = field(formData, "name", 80);
  const color = field(formData, "color", 7);
  if (!name) redirect(withMessage("/editorial/setup", "error", "Name the channel."));
  const db = tenantDb(ctx.resolved.id);
  if (await db.calendarChannel.findFirst({ where: { brandId: ctx.brand.id, name } })) redirect(withMessage("/editorial/setup", "error", `${name} already exists.`));
  const created = await db.calendarChannel.create({
    data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, name, color: isHexColor(color) ? color : "#27455c" },
    select: { id: true },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.channel.created", targetType: "calendar_channel", targetId: created.id });
  redirect(withMessage("/editorial/setup", "notice", `${name} added.`));
}

export async function deleteChannelAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/setup");
  const id = field(formData, "channelId", 40);
  if (!UUID.test(id)) redirect("/editorial/setup");
  await tenantDb(ctx.resolved.id).calendarChannel.deleteMany({ where: { id, brandId: ctx.brand.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.channel.deleted", targetType: "calendar_channel", targetId: id });
  redirect(withMessage("/editorial/setup", "notice", "Channel removed. Events keep the name they had."));
}

export type AssistState = { status: "idle" | "ok" | "unavailable" | "failed" | "todo"; text?: string; reason?: string };

/** Writing assist on an issue: the AI drafts from the editor's prompt. It never invents stats. */
export async function issueAssistAction(_prev: AssistState, formData: FormData): Promise<AssistState> {
  const ctx = await calendarAction("editorial.write");
  const issue = await ownIssue(ctx, field(formData, "issueId", 40));
  const prompt = field(formData, "prompt", 4000);
  const context = [brandPromptContext(brandProfile(ctx.brand)), issue.body ? `Current draft:\n${issue.body.slice(0, 12000)}` : ""].filter(Boolean).join("\n\n");
  const result = await writingAssist({ organizationId: ctx.resolved.id, issueTitle: issue.title, prompt: prompt ? `${context}\n\nRequest: ${prompt}` : "" }, runText);
  if (result.status === "ok") {
    await logAiUsage({ organizationId: ctx.resolved.id, moduleId: "editorial", feature: "calendar.issue.assist", actorId: ctx.actorId, usage: result.usage });
    return { status: "ok", text: result.text };
  }
  return { status: result.status, reason: result.reason };
}

const MAX_CSV_BYTES = 20 * 1024 * 1024;

export async function importStatsAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/stats");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(withMessage("/editorial/stats", "error", "Choose a CSV file."));
  if (file.size > MAX_CSV_BYTES) redirect(withMessage("/editorial/stats", "error", "That file is over 20 MB."));
  const csv = await file.text();
  const header = parseCsv(csv.slice(0, 200_000))[0] ?? [];
  const mapping = mappingFromForm(formData, header.length);
  const missing = missingRequired(mapping);
  if (missing.length) redirect(withMessage("/editorial/stats", "error", `Choose a column for: ${missing.join(", ")}.`));
  const rateFormat = field(formData, "rateFormat", 10) === "ratio" ? "ratio" : "percent";
  const result = await importStats({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId, filename: file.name, csv, mapping, rateFormat });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.stats.imported", targetType: "calendar_stat_import", targetId: result.id, metadata: { rows: result.rows, matched: result.matched } });
  after(async () => {
    for (const issueId of result.matchedIssueIds.slice(0, 300)) await teachIssue({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, issueId, actorId: ctx.actorId });
  });
  redirect(withMessage(`/editorial/stats?import=${result.id}`, "notice", `Matched ${result.matched} of ${result.rows} rows to issues.`));
}

export async function regenerateWhatsWorkingAction() {
  const ctx = await calendarAction("editorial.write", "/editorial/whats-working");
  const db = tenantDb(ctx.resolved.id);
  const busy = await db.calendarInsight.findFirst({ where: { brandId: ctx.brand.id, status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } });
  if (busy) redirect("/editorial/whats-working");
  const insight = await db.calendarInsight.create({
    data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, windowDays: WINDOW_DAYS, createdById: ctx.actorId },
    select: { id: true },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.whats-working.generated", targetType: "calendar_insight", targetId: insight.id });
  after(() => runWhatsWorking({ organizationId: ctx.resolved.id, brand: ctx.brand, insightId: insight.id, actorId: ctx.actorId }));
  redirect("/editorial/whats-working");
}
