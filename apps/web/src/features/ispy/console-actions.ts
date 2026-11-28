"use server";

import { buildSiteUrl } from "@pubcommand/core";
import { appendPlatformAudit, type Prisma } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { buildAuthUrl, signState } from "../../../../../modules/intel/index";
import { EMAIL_TYPES, FEEDS, INBOX_LEVELS, isOneOf, LIST_CATEGORIES, PUBLISHER_TYPES, regexError } from "../../../../../modules/ispy/index";
import { ensureConsoleOrganization } from "@/lib/console-workspace";
import { rootDomain } from "@/lib/auth";
import { currentRequest } from "@/lib/request";
import { authSecret, gmailEnv, gmailRedirectUri } from "../intel/gmail";
import { applyReport, approveCandidate, createInbox, mergeCandidate, mergeCopies, rejectCandidate, rerouteEmails } from "./admin";
import { decideCopyType, syncCopyNote } from "./brain";
import { requireIspyStaff } from "./console-auth";
import { backPath, checked, list, optional, readConditionRows, text, uuidOrNull } from "./console-form";
import { ispyDb } from "./db";
import { afterIngest } from "./pipeline";
import { blockPromo, mergePromos } from "./promos";
import { ISPY_GMAIL_STATE_SLUG, syncIspyGmail } from "./providers/gmail";
import { ensureMachineMailWebhook, machineMailConfig } from "./providers/machinemail";
import { readIspySettings, sealSecret, writeIspySettings, isSlackWebhookUrl } from "./settings";

/** Admin → ISpy console actions. Every one re-checks platform.ispy.manage and is audited. */

function go(path: string, flash: { error?: string; notice?: string }): never {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  if (flash.error) params.set("error", flash.error);
  if (flash.notice) params.set("notice", flash.notice);
  const search = params.toString();
  redirect(search ? `${base}?${search}` : base!);
}

async function audit(actorId: string, action: string, targetType: string, targetId: string | null, metadata?: Prisma.InputJsonValue) {
  await appendPlatformAudit({ actorId, action, targetType, targetId, ...(metadata ? { metadata } : {}) });
}

// ── Publishers, publications, lists ──────────────────────────────────────

export async function savePublisher(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/publications");
  const id = uuidOrNull(formData.get("id"));
  const name = text(formData, "name", 200);
  if (!name) go(back, { error: "Give the publisher a name." });
  const type = text(formData, "type");
  const feed = text(formData, "feed");
  if (!isOneOf(PUBLISHER_TYPES, type)) go(back, { error: "Pick a publisher type." });
  if (!isOneOf(FEEDS, feed)) go(back, { error: "Pick a feed." });
  const parentId = uuidOrNull(formData.get("parentId"));
  if (parentId && parentId === id) go(back, { error: "A publisher cannot be its own group." });
  const linkedOrganizationId = uuidOrNull(formData.get("linkedOrganizationId"));
  let linkedBrandId = uuidOrNull(formData.get("linkedBrandId"));
  if (linkedBrandId && linkedOrganizationId) {
    const brand = await ispyDb((tx) => tx.brand.findUnique({ where: { id: linkedBrandId! }, select: { organizationId: true } }));
    if (brand?.organizationId !== linkedOrganizationId) linkedBrandId = null;
  } else if (!linkedOrganizationId) linkedBrandId = null;
  const data = {
    name,
    type,
    feed,
    parentId,
    domains: list(formData, "domains", { lower: true }).map((d) => d.replace(/^@/, "")),
    fromAddresses: list(formData, "fromAddresses", { lower: true }),
    website: optional(formData, "website", 300),
    notes: optional(formData, "notes", 4000),
    excludeBrands: list(formData, "excludeBrands", { lower: true }).map((b) => b.replace(/[^a-z0-9]/g, "")).filter(Boolean),
    linkedOrganizationId,
    linkedBrandId,
    hideFromOtherOrgs: checked(formData, "hideFromOtherOrgs"),
    isConfirmed: true,
  };
  const row = id
    ? await ispyDb((tx) => tx.ispyPublisher.update({ where: { id }, data, select: { id: true } }))
    : await ispyDb((tx) => tx.ispyPublisher.create({ data, select: { id: true } }));
  await audit(staff.userId, id ? "ispy.publisher.updated" : "ispy.publisher.created", "ispy_publisher", row.id, { type, feed, linked: Boolean(linkedOrganizationId) });
  if (!id && checked(formData, "catchAll")) {
    const made = await createInbox({ level: "PUBLISHER_CATCHALL", publisherId: row.id, name, feed });
    if ("error" in made) go(back, { notice: `${name} saved.`, error: made.error });
    await audit(staff.userId, "ispy.inbox.created", "ispy_inbox", made.id, { level: "PUBLISHER_CATCHALL" });
  }
  go(back, { notice: `${name} saved.` });
}

export async function deletePublisher(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/publications");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown publisher." });
  await ispyDb((tx) => tx.ispyPublisher.update({ where: { id }, data: { deletedAt: new Date() } }));
  await audit(staff.userId, "ispy.publisher.deleted", "ispy_publisher", id);
  go(back, { notice: "Publisher removed. Its emails stay in the feed." });
}

export async function savePublication(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/publications");
  const id = uuidOrNull(formData.get("id"));
  const publisherId = uuidOrNull(formData.get("publisherId"));
  const name = text(formData, "name", 200);
  if (!publisherId || !name) go(back, { error: "A publication needs a publisher and a name." });
  const linkedBrandId = uuidOrNull(formData.get("linkedBrandId"));
  const linkedCalendarPublicationId = uuidOrNull(formData.get("linkedCalendarPublicationId"));
  const brand = linkedBrandId ? await ispyDb((tx) => tx.brand.findUnique({ where: { id: linkedBrandId }, select: { organizationId: true } })) : null;
  if (linkedCalendarPublicationId) {
    const cal = await ispyDb((tx) => tx.calendarPublication.findUnique({ where: { id: linkedCalendarPublicationId }, select: { brandId: true } }));
    if (!cal || cal.brandId !== linkedBrandId) go(back, { error: "That Publication Setup record belongs to another brand." });
    const taken = await ispyDb((tx) => tx.ispyPublication.findFirst({ where: { linkedCalendarPublicationId, ...(id ? { NOT: { id } } : {}) }, select: { name: true } }));
    if (taken) go(back, { error: `That Publication Setup record is already linked to ${taken.name}.` });
  }
  const data = {
    publisherId,
    name,
    aliases: list(formData, "aliases"),
    notes: optional(formData, "notes", 4000),
    linkedBrandId: brand ? linkedBrandId : null,
    linkedOrganizationId: brand?.organizationId ?? null,
    linkedCalendarPublicationId: brand ? linkedCalendarPublicationId : null,
  };
  const row = id
    ? await ispyDb((tx) => tx.ispyPublication.update({ where: { id }, data, select: { id: true } }))
    : await ispyDb((tx) => tx.ispyPublication.create({ data, select: { id: true } }));
  await audit(staff.userId, id ? "ispy.publication.updated" : "ispy.publication.created", "ispy_publication", row.id, { linked: Boolean(brand) });
  if (!id && checked(formData, "createInbox")) {
    const publisher = await ispyDb((tx) => tx.ispyPublisher.findUnique({ where: { id: publisherId }, select: { feed: true } }));
    const made = await createInbox({ level: "PUBLICATION", publisherId, publicationId: row.id, name, feed: publisher?.feed ?? "FINPUB" });
    if ("error" in made) go(back, { notice: `${name} saved.`, error: made.error });
    await audit(staff.userId, "ispy.inbox.created", "ispy_inbox", made.id, { level: "PUBLICATION" });
  }
  go(back, { notice: `${name} saved.` });
}

export async function deletePublication(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/publications");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown publication." });
  await ispyDb((tx) => tx.ispyPublication.update({ where: { id }, data: { deletedAt: new Date(), linkedCalendarPublicationId: null } }));
  await audit(staff.userId, "ispy.publication.deleted", "ispy_publication", id);
  go(back, { notice: "Publication removed." });
}

export async function saveList(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/publications");
  const id = uuidOrNull(formData.get("id"));
  const publisherId = uuidOrNull(formData.get("publisherId"));
  const publicationId = uuidOrNull(formData.get("publicationId"));
  const name = text(formData, "name", 200);
  const category = text(formData, "category");
  if (!publisherId || !name) go(back, { error: "A list needs a publisher and a name." });
  if (!isOneOf(LIST_CATEGORIES, category)) go(back, { error: "Pick a list type." });
  const data = {
    publisherId,
    publicationId,
    name,
    category,
    synonyms: list(formData, "synonyms"),
    isIgnored: checked(formData, "isIgnored"),
    editorialPubCode: optional(formData, "editorialPubCode", 60),
    dedicatedPubCode: optional(formData, "dedicatedPubCode", 60),
    notes: optional(formData, "notes", 4000),
  };
  const row = id
    ? await ispyDb((tx) => tx.ispyList.update({ where: { id }, data, select: { id: true } }))
    : await ispyDb((tx) => tx.ispyList.create({ data, select: { id: true } }));
  await audit(staff.userId, id ? "ispy.list.updated" : "ispy.list.created", "ispy_list", row.id, { category });
  if (!id && checked(formData, "createInbox")) {
    const publisher = await ispyDb((tx) => tx.ispyPublisher.findUnique({ where: { id: publisherId }, select: { feed: true, type: true } }));
    const made = await createInbox({ level: "LIST", publisherId, publicationId, listId: row.id, name, feed: publisher?.feed ?? "FINPUB", affiliateSeed: publisher?.type === "AFFILIATE" });
    if ("error" in made) go(back, { notice: `${name} saved.`, error: made.error });
    await audit(staff.userId, "ispy.inbox.created", "ispy_inbox", made.id, { level: "LIST" });
  }
  go(back, { notice: `${name} saved.` });
}

export async function deleteList(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/publications");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown list." });
  await ispyDb((tx) => tx.ispyList.update({ where: { id }, data: { deletedAt: new Date() } }));
  await audit(staff.userId, "ispy.list.deleted", "ispy_list", id);
  go(back, { notice: "List removed. Its emails stay in the feed." });
}

// ── Inboxes ──────────────────────────────────────────────────────────────

export async function createInboxAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const level = text(formData, "level");
  if (!isOneOf(INBOX_LEVELS, level) || level === "LEGACY") go(back, { error: "Pick an inbox level." });
  const publisherId = uuidOrNull(formData.get("publisherId"));
  const publicationId = uuidOrNull(formData.get("publicationId"));
  const listId = uuidOrNull(formData.get("listId"));
  const name = text(formData, "name", 120);
  if (!name) go(back, { error: "Give the inbox a name." });
  const publisher = publisherId ? await ispyDb((tx) => tx.ispyPublisher.findUnique({ where: { id: publisherId }, select: { feed: true, type: true } })) : null;
  const made = await createInbox({ level: level as "PUBLISHER_CATCHALL" | "PUBLICATION" | "LIST", publisherId, publicationId, listId, name, feed: publisher?.feed ?? "FINPUB", affiliateSeed: checked(formData, "affiliateSeed") || (level === "LIST" && publisher?.type === "AFFILIATE") });
  if ("error" in made) go(back, { error: made.error });
  await audit(staff.userId, "ispy.inbox.created", "ispy_inbox", made.id, { level });
  go(back, { notice: `Created ${made.address}. Subscribe this address to the list.` });
}

export async function setInboxStatus(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const id = uuidOrNull(formData.get("id"));
  const status = text(formData, "status");
  if (!id || !["ACTIVE", "PENDING_SIGNUP", "RETIRED"].includes(status)) go(back, { error: "Unknown inbox or status." });
  await ispyDb((tx) => tx.ispyInbox.update({ where: { id }, data: { status } }));
  await audit(staff.userId, `ispy.inbox.${status.toLowerCase()}`, "ispy_inbox", id);
  go(back, { notice: status === "RETIRED" ? "Inbox retired. Its mail stays in the feed." : "Inbox updated." });
}

export async function setInboxAffiliate(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/affiliates");
  const id = uuidOrNull(formData.get("id"));
  const publisherId = uuidOrNull(formData.get("publisherId"));
  const listId = uuidOrNull(formData.get("listId"));
  if (!id) go(back, { error: "Unknown inbox." });
  const seed = checked(formData, "affiliateSeed");
  await ispyDb((tx) => tx.ispyInbox.update({ where: { id }, data: { affiliateSeed: seed, ...(seed ? { publisherId, listId } : {}) } }));
  await audit(staff.userId, seed ? "ispy.inbox.seed_set" : "ispy.inbox.seed_cleared", "ispy_inbox", id);
  go(back, { notice: seed ? "Inbox is now an affiliate seed." : "Inbox is no longer an affiliate seed." });
}

export async function connectGmail(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const env = gmailEnv();
  if (!env) go(back, { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on this server." });
  const feed = text(formData, "feed") === "HEALTH" ? "HEALTH" : "FINPUB";
  const organizationId = await ensureConsoleOrganization();
  const request = await currentRequest();
  const state = signState({ organizationId, brandId: feed, userId: staff.userId, orgSlug: ISPY_GMAIL_STATE_SLUG, returnTo: "/intel" }, authSecret());
  const loginHint = optional(formData, "loginHint", 200) ?? undefined;
  await audit(staff.userId, "ispy.inbox.gmail_connect_started", "ispy_inbox", null, { feed });
  redirect(buildAuthUrl({ clientId: env.clientId, redirectUri: gmailRedirectUri(request.host), state, loginHint }));
}

export async function syncGmailNow(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown inbox." });
  await audit(staff.userId, "ispy.inbox.sync_requested", "ispy_inbox", id);
  after(async () => {
    const out = await syncIspyGmail(id);
    if (out.emailIds.length) await afterIngest(out.emailIds, out.copyIds);
  });
  go(back, { notice: "Sync started. New mail appears in a few minutes." });
}

// ── Routing rules ────────────────────────────────────────────────────────

export async function saveRule(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const id = uuidOrNull(formData.get("id"));
  const conditions = readConditionRows(formData);
  if (!conditions.length) go(back, { error: "Add at least one condition." });
  const bad = conditions.find((c) => c.op === "matches" && regexError(c.value));
  if (bad) go(back, { error: `That pattern is not valid: ${regexError(bad.value)}` });
  const action = text(formData, "action");
  if (!["ROUTE", "AFFILIATE", "IGNORE"].includes(action)) go(back, { error: "Pick what the rule does." });
  const listId = uuidOrNull(formData.get("listId"));
  if (action !== "IGNORE" && !listId) go(back, { error: "Pick the list this rule sends mail to." });
  const priority = Math.max(1, Math.min(10_000, Number(formData.get("priority")) || 100));
  const data = {
    publisherId: uuidOrNull(formData.get("publisherId")),
    publicationId: uuidOrNull(formData.get("publicationId")),
    priority,
    conditions: conditions as unknown as Prisma.InputJsonValue,
    action,
    listId: action === "IGNORE" ? null : listId,
    enabled: !checked(formData, "disabled"),
  };
  const row = id
    ? await ispyDb((tx) => tx.ispyRoutingRule.update({ where: { id }, data, select: { id: true } }))
    : await ispyDb((tx) => tx.ispyRoutingRule.create({ data: { ...data, origin: "STAFF", createdById: staff.userId }, select: { id: true } }));
  await audit(staff.userId, id ? "ispy.routing_rule.updated" : "ispy.routing_rule.created", "ispy_routing_rule", row.id, { action, conditions: conditions.length });
  go(back, { notice: "Rule saved. Press Re-route history to apply it to past mail." });
}

export async function toggleRule(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown rule." });
  const rule = await ispyDb((tx) => tx.ispyRoutingRule.findUnique({ where: { id }, select: { enabled: true } }));
  await ispyDb((tx) => tx.ispyRoutingRule.update({ where: { id }, data: { enabled: !rule?.enabled } }));
  await audit(staff.userId, rule?.enabled ? "ispy.routing_rule.disabled" : "ispy.routing_rule.enabled", "ispy_routing_rule", id);
  go(back, { notice: rule?.enabled ? "Rule disabled." : "Rule enabled." });
}

export async function deleteRule(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown rule." });
  await ispyDb((tx) => tx.ispyRoutingRule.delete({ where: { id } }));
  await audit(staff.userId, "ispy.routing_rule.deleted", "ispy_routing_rule", id);
  go(back, { notice: "Rule deleted." });
}

export async function rerouteAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const publisherId = uuidOrNull(formData.get("publisherId"));
  const publicationId = uuidOrNull(formData.get("publicationId"));
  const result = await rerouteEmails({ publisherId, publicationId });
  await audit(staff.userId, "ispy.routing_rule.rerouted", "ispy_routing_rule", null, { checked: result.checked, moved: result.moved });
  go(back, { notice: `Re-routed: checked ${result.checked} emails, moved ${result.moved}.` });
}

export async function assignEmailList(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/inboxes");
  const emailId = uuidOrNull(formData.get("emailId"));
  const listId = uuidOrNull(formData.get("listId"));
  if (!emailId || !listId) go(back, { error: "Pick a list." });
  await ispyDb(async (tx) => {
    const list = await tx.ispyList.findUnique({ where: { id: listId }, select: { publisherId: true, publicationId: true, inboxes: { where: { level: "LIST", status: { not: "RETIRED" } }, select: { id: true }, take: 1 } } });
    if (!list) return;
    await tx.ispyEmail.update({
      where: { id: emailId },
      data: { listId, publisherId: list.publisherId, publicationId: list.publicationId, routeStatus: "ROUTED", routeReason: "Sorted by hand in the console.", routedByRuleId: null, ...(list.inboxes[0] ? { inboxId: list.inboxes[0].id } : {}) },
    });
  });
  await audit(staff.userId, "ispy.email.assigned", "ispy_email", emailId, { listId });
  go(back, { notice: "Email sorted. Add a rule so the next one sorts itself." });
}

// ── New lists ────────────────────────────────────────────────────────────

export async function approveCandidateAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/approvals");
  const candidateId = uuidOrNull(formData.get("candidateId"));
  if (!candidateId) go(back, { error: "Unknown candidate." });
  const result = await approveCandidate({ candidateId, name: text(formData, "name", 120), category: text(formData, "category"), conditions: readConditionRows(formData), actorId: staff.userId, createListInbox: checked(formData, "createInbox") });
  if ("error" in result) go(back, { error: result.error });
  await audit(staff.userId, "ispy.list_candidate.approved", "ispy_list_candidate", candidateId, { listId: result.listId, moved: result.moved, inbox: Boolean(result.inbox) });
  go(back, { notice: `List created${result.inbox ? ` with inbox ${result.inbox}` : ""}; ${result.moved} email(s) moved.`, ...(result.inboxError ? { error: result.inboxError } : {}) });
}

export async function mergeCandidateAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/approvals");
  const candidateId = uuidOrNull(formData.get("candidateId"));
  const listId = uuidOrNull(formData.get("listId"));
  if (!candidateId || !listId) go(back, { error: "Pick the list to merge into." });
  const result = await mergeCandidate({ candidateId, listId, conditions: readConditionRows(formData), actorId: staff.userId });
  if ("error" in result) go(back, { error: result.error });
  await audit(staff.userId, "ispy.list_candidate.merged", "ispy_list_candidate", candidateId, { listId, moved: result.moved });
  go(back, { notice: `Merged; ${result.moved} email(s) moved.` });
}

export async function rejectCandidateAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/approvals");
  const candidateId = uuidOrNull(formData.get("candidateId"));
  if (!candidateId) go(back, { error: "Unknown candidate." });
  await rejectCandidate(candidateId, staff.userId);
  await audit(staff.userId, "ispy.list_candidate.rejected", "ispy_list_candidate", candidateId);
  go(back, { notice: "Rejected. Its mail stays Unsorted." });
}

export async function assignCandidatePublisher(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/approvals");
  const candidateId = uuidOrNull(formData.get("candidateId"));
  const publisherId = uuidOrNull(formData.get("publisherId"));
  const publicationId = uuidOrNull(formData.get("publicationId"));
  if (!candidateId || !publisherId) go(back, { error: "Pick a publisher." });
  await ispyDb((tx) => tx.ispyListCandidate.update({ where: { id: candidateId }, data: { publisherId, publicationId } }));
  await audit(staff.userId, "ispy.list_candidate.assigned", "ispy_list_candidate", candidateId);
  go(back, { notice: "Publisher set." });
}

// ── Gurus ────────────────────────────────────────────────────────────────

export async function saveGuru(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/gurus");
  const id = uuidOrNull(formData.get("id"));
  const name = text(formData, "name", 120);
  const feed = text(formData, "feed");
  if (!name) go(back, { error: "Give the guru a name." });
  if (!isOneOf(FEEDS, feed)) go(back, { error: "Pick a feed." });
  const data = { name, feed, aliases: list(formData, "aliases"), publisherId: uuidOrNull(formData.get("publisherId")), notes: optional(formData, "notes", 4000), isIgnored: checked(formData, "isIgnored"), isSecondaryVoice: checked(formData, "isSecondaryVoice") };
  const clash = await ispyDb((tx) => tx.ispyGuru.findFirst({ where: { feed, name, ...(id ? { NOT: { id } } : {}) }, select: { id: true } }));
  if (clash) go(back, { error: `${name} is already a guru in this feed.` });
  const row = id ? await ispyDb((tx) => tx.ispyGuru.update({ where: { id }, data, select: { id: true } })) : await ispyDb((tx) => tx.ispyGuru.create({ data, select: { id: true } }));
  await audit(staff.userId, id ? "ispy.guru.updated" : "ispy.guru.created", "ispy_guru", row.id);
  go(back, { notice: `${name} saved.` });
}

export async function linkGuruPublication(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/gurus");
  const guruId = uuidOrNull(formData.get("guruId"));
  const publicationId = uuidOrNull(formData.get("publicationId"));
  const role = text(formData, "role") || "lead";
  if (!guruId || !publicationId) go(back, { error: "Pick a guru and a publication." });
  if (!["lead", "co-editor", "contributor", "analyst", "guest"].includes(role)) go(back, { error: "Pick a role." });
  await ispyDb((tx) => tx.ispyGuruPublication.upsert({ where: { guruId_publicationId: { guruId, publicationId } }, create: { guruId, publicationId, role }, update: { role } }));
  await audit(staff.userId, "ispy.guru.linked", "ispy_guru", guruId, { publicationId, role });
  go(back, { notice: "Guru linked." });
}

export async function unlinkGuruPublication(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/gurus");
  const guruId = uuidOrNull(formData.get("guruId"));
  const publicationId = uuidOrNull(formData.get("publicationId"));
  if (!guruId || !publicationId) go(back, { error: "Unknown link." });
  await ispyDb((tx) => tx.ispyGuruPublication.deleteMany({ where: { guruId, publicationId } }));
  await audit(staff.userId, "ispy.guru.unlinked", "ispy_guru", guruId, { publicationId });
  go(back, { notice: "Guru unlinked." });
}

export async function linkGuruList(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/gurus");
  const guruId = uuidOrNull(formData.get("guruId"));
  const listId = uuidOrNull(formData.get("listId"));
  if (!guruId || !listId) go(back, { error: "Pick a guru and a list." });
  const list = await ispyDb((tx) => tx.ispyList.findUnique({ where: { id: listId }, select: { category: true, publisher: { select: { type: true } } } }));
  if (list?.publisher.type === "AFFILIATE") go(back, { error: "Gurus are never members of an affiliate's list: bylines there are who the promo is for." });
  await ispyDb((tx) => tx.ispyGuruList.upsert({ where: { guruId_listId: { guruId, listId } }, create: { guruId, listId, isPrimary: checked(formData, "isPrimary") }, update: { isPrimary: checked(formData, "isPrimary"), isIgnored: false } }));
  await audit(staff.userId, "ispy.guru.list_linked", "ispy_guru", guruId, { listId });
  go(back, { notice: "Guru added to the list." });
}

export async function unlinkGuruList(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/gurus");
  const guruId = uuidOrNull(formData.get("guruId"));
  const listId = uuidOrNull(formData.get("listId"));
  if (!guruId || !listId) go(back, { error: "Unknown link." });
  await ispyDb((tx) => tx.ispyGuruList.deleteMany({ where: { guruId, listId } }));
  await audit(staff.userId, "ispy.guru.list_unlinked", "ispy_guru", guruId, { listId });
  go(back, { notice: "Guru removed from the list." });
}

// ── Reports, promos, copies ──────────────────────────────────────────────

export async function applyReportAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/reports");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown report." });
  const result = await applyReport(id, staff.userId);
  if ("error" in result) go(back, { error: result.error });
  await audit(staff.userId, "ispy.report.applied", "ispy_report", id);
  go(back, { notice: "Applied. Future mail follows it." });
}

export async function dismissReport(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/reports");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown report." });
  await ispyDb((tx) => tx.ispyReport.updateMany({ where: { id, status: "OPEN" }, data: { status: "DISMISSED", decidedById: staff.userId, decidedAt: new Date() } }));
  await audit(staff.userId, "ispy.report.dismissed", "ispy_report", id);
  go(back, { notice: "Report dismissed." });
}

export async function blockPromoAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/promos");
  const id = uuidOrNull(formData.get("id"));
  if (!id) go(back, { error: "Unknown promo." });
  await blockPromo(id, staff.userId);
  await audit(staff.userId, "ispy.promo.blocked", "ispy_promo", id);
  go(back, { notice: "Removed as not a promo. Its page is skipped from now on." });
}

export async function mergePromoAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/promos");
  const fromId = uuidOrNull(formData.get("id"));
  const intoId = uuidOrNull(String(formData.get("intoId") ?? "").trim().split("/").pop());
  if (!fromId || !intoId) go(back, { error: "Paste the id (or link) of the promo to merge into." });
  if (fromId === intoId) go(back, { error: "Pick a different promo." });
  const target = await ispyDb((tx) => tx.ispyPromo.findUnique({ where: { id: intoId }, select: { id: true, mergedIntoId: true } }));
  if (!target || target.mergedIntoId) go(back, { error: "That promo does not exist (or was merged)." });
  await mergePromos(fromId, intoId);
  await audit(staff.userId, "ispy.promo.merged", "ispy_promo", fromId, { intoId });
  go(back, { notice: "Merged. Its URLs now count as the same promo." });
}

export async function setCopyType(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/copies");
  const id = uuidOrNull(formData.get("id"));
  const type = text(formData, "emailType");
  if (!id) go(back, { error: "Unknown copy." });
  if (type === "AUTO") {
    await ispyDb((tx) => tx.ispyCopy.update({ where: { id }, data: { typeOverridden: false } }));
  } else {
    if (!isOneOf(EMAIL_TYPES, type)) go(back, { error: "Pick a type." });
    await ispyDb((tx) => tx.ispyCopy.update({ where: { id }, data: { emailType: type, typeOverridden: true } }));
  }
  await decideCopyType(id);
  await syncCopyNote(id).catch(() => undefined);
  await audit(staff.userId, "ispy.copy.type_set", "ispy_copy", id, { type });
  go(back, { notice: type === "AUTO" ? "Type is automatic again." : "Type saved for every send of this copy." });
}

export async function mergeCopyAction(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/copies");
  const fromId = uuidOrNull(formData.get("id"));
  const intoId = uuidOrNull(String(formData.get("intoId") ?? "").trim().split("/").pop());
  if (!fromId || !intoId || fromId === intoId) go(back, { error: "Paste the id of a different copy to merge into." });
  const target = await ispyDb((tx) => tx.ispyCopy.findUnique({ where: { id: intoId }, select: { mergedIntoId: true } }));
  if (!target || target.mergedIntoId) go(back, { error: "That copy does not exist (or was merged)." });
  await mergeCopies(fromId, intoId);
  await audit(staff.userId, "ispy.copy.merged", "ispy_copy", fromId, { intoId });
  go(back, { notice: "Merged: its sends now belong to the other copy." });
}

// ── Access, import, settings ─────────────────────────────────────────────

export async function setFeedAccess(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/access");
  const orgId = uuidOrNull(formData.get("orgId"));
  const feed = text(formData, "feed");
  const mode = text(formData, "mode");
  if (!orgId || !isOneOf(FEEDS, feed) || !["ALLOWED", "BLOCKED", "RESET"].includes(mode)) go(back, { error: "Unknown access change." });
  if (mode === "RESET") await ispyDb((tx) => tx.ispyFeedAccess.deleteMany({ where: { orgId, feed } }));
  else await ispyDb((tx) => tx.ispyFeedAccess.upsert({ where: { orgId_feed: { orgId, feed } }, create: { orgId, feed, mode, updatedById: staff.userId }, update: { mode, updatedById: staff.userId } }));
  await audit(staff.userId, `ispy.feed_access.${mode.toLowerCase()}`, "ispy_feed_access", orgId, { feed });
  go(back, { notice: mode === "RESET" ? "Back to the niche default." : mode === "ALLOWED" ? "Feed granted." : "Feed blocked." });
}

export async function requestImport(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/import");
  if (!process.env.ISPY_LEGACY_DATABASE_URL) go(back, { error: "Set ISPY_LEGACY_DATABASE_URL on the server first." });
  const apply = text(formData, "apply") === "true";
  await ispyDb((tx) => tx.ispySetting.upsert({ where: { key: "import_request" }, create: { key: "import_request", value: { apply, requestedAt: new Date().toISOString() } }, update: { value: { apply, requestedAt: new Date().toISOString() } } }));
  await audit(staff.userId, apply ? "ispy.setting.import_requested" : "ispy.setting.dry_run_requested", "ispy_setting", null);
  go(back, { notice: `${apply ? "Import" : "Dry run"} queued. It starts within 5 minutes; refresh this page for the report.` });
}

export async function saveSettings(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/settings");
  const webhook = text(formData, "slackWebhook", 500);
  if (webhook && !isSlackWebhookUrl(webhook)) go(back, { error: "That is not a Slack incoming-webhook URL (https://hooks.slack.com/…)." });
  const emails = list(formData, "digestEmails", { lower: true, max: 20 });
  if (emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) go(back, { error: "One of the digest emails is not an email address." });
  const current = await readIspySettings();
  await writeIspySettings({
    slackWebhookEnc: checked(formData, "clearSlack") ? null : webhook ? sealSecret(webhook) : current.slackWebhookEnc,
    digestEmails: emails,
    dailyDigest: checked(formData, "dailyDigest"),
    weeklyTrends: checked(formData, "weeklyTrends"),
    silenceDays: Math.max(1, Math.min(90, Number(formData.get("silenceDays")) || 7)),
  });
  await audit(staff.userId, "ispy.setting.updated", "ispy_setting", null, { digestRecipients: emails.length, slack: Boolean(webhook || (current.slackWebhookEnc && !checked(formData, "clearSlack"))) });
  go(back, { notice: "Settings saved." });
}

export async function registerMachineMailWebhook(formData: FormData) {
  const staff = await requireIspyStaff();
  const back = backPath(formData, "/ispy/settings");
  const config = machineMailConfig();
  if (!config) go(back, { error: "Set MACHINEMAIL_API_KEY on the server first." });
  const request = await currentRequest();
  const url = buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "app" }, pathname: "/api/ispy/inbound/machinemail" });
  let result: { id: string; secret: string | null };
  try {
    result = await ensureMachineMailWebhook(config, url);
  } catch (error) {
    go(back, { error: error instanceof Error ? error.message : "MachineMail did not register the webhook." });
  }
  if (result.secret) await writeIspySettings({ machineMailWebhookSecretEnc: sealSecret(result.secret) });
  await audit(staff.userId, "ispy.setting.webhook_registered", "ispy_setting", null, { secretStored: Boolean(result.secret) });
  go(back, { notice: result.secret ? `Webhook registered for ${url}.` : `MachineMail already had this webhook (${url}). If mail does not arrive, set MACHINEMAIL_WEBHOOK_SECRET from the MachineMail dashboard.` });
}
