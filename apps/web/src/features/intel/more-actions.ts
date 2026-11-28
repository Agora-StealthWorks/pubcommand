"use server";

import { aiConfigured } from "@pubcommand/ai";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  ENTITY_LABELS,
  encryptToken,
  isEntityKind,
  isSlackWebhookUrl,
  nameConflict,
  normalizeEntityInput,
  parseDigestEmails,
  type EntityKind,
} from "../../../../../modules/intel/index";
import { canUsePromoAnalyzer, intelAccess, type IntelScope } from "./context";
import { authSecret } from "./gmail";
import { captureEmailLanding } from "./landing";
import { loadRegistry, mergeEntities, relinkAll } from "./registry";
import { lastCompleteWeek, sendBrandDigest } from "./scheduled";
import { drainExtractions } from "./server";
import { readSettings, writeSettings } from "./settings";
import { drainVideoQueue, queueVideo, runVideoExtraction, sendVideoToPromoAnalyzer } from "./video";

const UUID = /^[0-9a-f-]{36}$/i;

function go(path: string, flash?: { error?: string; notice?: string }): never {
  const params = new URLSearchParams();
  if (flash?.error) params.set("error", flash.error);
  if (flash?.notice) params.set("notice", flash.notice);
  const query = params.toString();
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);
}

async function writeScope(back: string): Promise<IntelScope> {
  const access = await intelAccess("write");
  if (!access.ok) go(back, { error: access.error });
  return access.scope;
}

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

// ── Videos ──────────────────────────────────────────────────────────────────

export async function captureVideoAction(formData: FormData) {
  const scope = await writeScope("/intel/videos");
  const url = text(formData, "url", 2000);
  if (!url) go("/intel/videos", { error: "Paste the page or video URL." });
  const queued = await queueVideo({ organizationId: scope.organizationId, brandId: scope.brand.id, actorId: scope.actorId, url });
  if ("error" in queued) go("/intel/videos", { error: queued.error });
  after(() => drainVideoQueue({ budgetMs: 45 * 60_000 }).then(() => undefined));
  go(`/intel/videos/${queued.id}`, { notice: "Capture queued. It runs in the background; this page updates by itself." });
}

async function ownVideo(scope: IntelScope, videoId: string) {
  if (!UUID.test(videoId)) go("/intel/videos", { error: "That video no longer exists." });
  const video = await tenantDb(scope.organizationId).intelVideo.findFirst({ where: { id: videoId, brandId: scope.brand.id, deletedAt: null } });
  if (!video) go("/intel/videos", { error: "That video no longer exists." });
  return video;
}

export async function retryVideo(formData: FormData) {
  const scope = await writeScope("/intel/videos");
  const video = await ownVideo(scope, text(formData, "videoId", 40));
  if (video.status === "RUNNING" || video.status === "QUEUED") go(`/intel/videos/${video.id}`);
  await tenantDb(scope.organizationId).intelVideo.updateMany({ where: { id: video.id }, data: { status: "QUEUED", step: null, error: null, attempts: 0 } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.video.queued", targetType: "intel_video", targetId: video.id });
  after(() => drainVideoQueue({ budgetMs: 45 * 60_000 }).then(() => undefined));
  go(`/intel/videos/${video.id}`, { notice: "Capture queued again." });
}

export async function extractVideoAction(formData: FormData) {
  const scope = await writeScope("/intel/videos");
  const video = await ownVideo(scope, text(formData, "videoId", 40));
  if (!aiConfigured()) go(`/intel/videos/${video.id}`, { error: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway, then run extraction." });
  if (video.status !== "DONE") go(`/intel/videos/${video.id}`, { error: "Wait for the capture to finish." });
  await tenantDb(scope.organizationId).intelVideo.updateMany({ where: { id: video.id }, data: { extractionStatus: "QUEUED", extractionError: null } });
  after(() => runVideoExtraction({ organizationId: scope.organizationId, brand: scope.brand, videoId: video.id, actorId: scope.actorId }));
  go(`/intel/videos/${video.id}`);
}

export async function assignVideoCompetitor(formData: FormData) {
  const scope = await writeScope("/intel/videos");
  const video = await ownVideo(scope, text(formData, "videoId", 40));
  const competitorId = text(formData, "competitorId", 40);
  const db = tenantDb(scope.organizationId);
  if (competitorId && !(await db.intelCompetitor.findFirst({ where: { id: competitorId, brandId: scope.brand.id, deletedAt: null }, select: { id: true } }))) {
    go(`/intel/videos/${video.id}`, { error: "Pick a competitor from the list." });
  }
  await db.intelVideo.updateMany({ where: { id: video.id }, data: competitorId ? { competitorId, matchedBy: "manual" } : { competitorId: null, matchedBy: null } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.video.assigned", targetType: "intel_video", targetId: video.id });
  go(`/intel/videos/${video.id}`, { notice: competitorId ? "Competitor set." : "Competitor cleared." });
}

export async function deleteVideo(formData: FormData) {
  const scope = await writeScope("/intel/videos");
  const video = await ownVideo(scope, text(formData, "videoId", 40));
  const db = tenantDb(scope.organizationId);
  await db.intelVideo.updateMany({ where: { id: video.id }, data: { deletedAt: new Date() } });
  await db.intelVideoFrame.deleteMany({ where: { videoId: video.id } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.video.deleted", targetType: "intel_video", targetId: video.id });
  go("/intel/videos", { notice: "Video deleted." });
}

export async function sendVideoToAnalyzer(formData: FormData) {
  const scope = await writeScope("/intel/videos");
  const video = await ownVideo(scope, text(formData, "videoId", 40));
  if (!(await canUsePromoAnalyzer())) go(`/intel/videos/${video.id}`, { error: "Sending to Promo Analyzer needs Promo Analyzer turned on and promo.write." });
  const result = await sendVideoToPromoAnalyzer({ organizationId: scope.organizationId, brand: scope.brand, videoId: video.id, actorId: scope.actorId });
  if ("error" in result) go(`/intel/videos/${video.id}`, { error: result.error });
  after(result.start);
  redirect(`/promo-studio/${result.promoId}`);
}

// ── Landing pages ───────────────────────────────────────────────────────────

export async function fetchEmailLanding(formData: FormData) {
  const scope = await writeScope("/intel/captures");
  const emailId = text(formData, "emailId", 40);
  if (!UUID.test(emailId)) go("/intel/captures");
  const row = await captureEmailLanding({ organizationId: scope.organizationId, brandId: scope.brand.id, emailId, force: true });
  if (!row) go(`/intel/emails/${emailId}`, { error: "This email has no landing page link to fetch." });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.landing.fetched", targetType: "intel_email", targetId: emailId });
  if (row.status !== "OK") go(`/intel/emails/${emailId}`, { error: `The landing page could not be read: ${row.error ?? "unknown error"}` });
  if (formData.get("reextract") === "1" && aiConfigured()) {
    await tenantDb(scope.organizationId).intelEmail.updateMany({ where: { id: emailId, brandId: scope.brand.id }, data: { extractionStatus: "QUEUED", extractionError: null } });
    after(() => drainExtractions({ organizationId: scope.organizationId, brand: scope.brand, actorId: scope.actorId }));
    go(`/intel/emails/${emailId}`, { notice: "Landing page fetched. Extraction is running again with it." });
  }
  go(`/intel/emails/${emailId}`, { notice: "Landing page fetched." });
}

// ── Registries ──────────────────────────────────────────────────────────────

function kindOf(formData: FormData): EntityKind {
  const kind = text(formData, "kind", 20);
  if (!isEntityKind(kind)) go("/intel/experts");
  return kind;
}

async function ownEntity(scope: IntelScope, entityId: string, back: string) {
  if (!UUID.test(entityId)) go(back, { error: "That entry no longer exists." });
  const entity = await tenantDb(scope.organizationId).intelEntity.findFirst({ where: { id: entityId, brandId: scope.brand.id, deletedAt: null } });
  if (!entity) go(back, { error: "That entry no longer exists." });
  return entity;
}

export async function createEntity(formData: FormData) {
  const kind = kindOf(formData);
  const back = ENTITY_LABELS[kind].route;
  const scope = await writeScope(back);
  const fields = normalizeEntityInput(kind, { name: text(formData, "name", 200), aliases: text(formData, "aliases", 4000), category: text(formData, "category", 20), notes: "" });
  if (!fields.name) go(back, { error: "Give it a name." });
  const conflict = nameConflict(await loadRegistry(scope.organizationId, scope.brand.id), { id: "", kind, name: fields.name, aliases: fields.aliases });
  if (conflict) go(back, { error: conflict });
  const row = await tenantDb(scope.organizationId).intelEntity.create({
    data: { organizationId: scope.organizationId, brandId: scope.brand.id, kind, ...fields, autoCreated: false },
    select: { id: true },
  });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.registry.created", targetType: "intel_entity", targetId: row.id });
  go(`/intel/registry/${row.id}`, { notice: `${ENTITY_LABELS[kind].one} added. Use "Rebuild links" on the list page to link existing emails to it.` });
}

export async function updateEntity(formData: FormData) {
  const scope = await writeScope("/intel/experts");
  const entity = await ownEntity(scope, text(formData, "entityId", 40), "/intel/experts");
  const kind = entity.kind as EntityKind;
  const back = `/intel/registry/${entity.id}`;
  const fields = normalizeEntityInput(kind, { name: text(formData, "name", 200), aliases: text(formData, "aliases", 4000), category: text(formData, "category", 20), notes: text(formData, "notes", 4000) });
  if (!fields.name) go(back, { error: "Give it a name." });
  const conflict = nameConflict(await loadRegistry(scope.organizationId, scope.brand.id), { id: entity.id, kind, name: fields.name, aliases: fields.aliases });
  if (conflict) go(back, { error: conflict });
  const db = tenantDb(scope.organizationId);
  const competitorId = kind === "topic" ? "" : text(formData, "competitorId", 40);
  if (competitorId && !(await db.intelCompetitor.findFirst({ where: { id: competitorId, brandId: scope.brand.id, deletedAt: null }, select: { id: true } }))) {
    go(back, { error: "Pick a competitor from the list." });
  }
  await db.intelEntity.updateMany({ where: { id: entity.id }, data: { ...fields, competitorId: competitorId || null, autoCreated: false } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.registry.updated", targetType: "intel_entity", targetId: entity.id });
  go(back, { notice: "Saved." });
}

export async function toggleEntityIgnored(formData: FormData) {
  const scope = await writeScope("/intel/experts");
  const entity = await ownEntity(scope, text(formData, "entityId", 40), "/intel/experts");
  await tenantDb(scope.organizationId).intelEntity.updateMany({ where: { id: entity.id }, data: { ignored: !entity.ignored } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: entity.ignored ? "intel.registry.restored" : "intel.registry.ignored", targetType: "intel_entity", targetId: entity.id });
  const back = text(formData, "back", 300);
  go(back.startsWith("/intel/") ? back : `/intel/registry/${entity.id}`, {
    notice: entity.ignored ? `${entity.name} is back in the lists.` : `${entity.name} is ignored: hidden from filters and counts, and never re-created.`,
  });
}

export async function mergeEntityAction(formData: FormData) {
  const scope = await writeScope("/intel/experts");
  const source = await ownEntity(scope, text(formData, "entityId", 40), "/intel/experts");
  const targetId = text(formData, "targetId", 40);
  const result = await mergeEntities({ organizationId: scope.organizationId, brandId: scope.brand.id, sourceId: source.id, targetId, actorId: scope.actorId });
  if ("error" in result) go(`/intel/registry/${source.id}`, { error: result.error });
  go(`/intel/registry/${targetId}`, { notice: `Merged "${source.name}" into this one. ${result.moved} link${result.moved === 1 ? "" : "s"} moved; that spelling now resolves here.` });
}

export async function deleteEntity(formData: FormData) {
  const scope = await writeScope("/intel/experts");
  const entity = await ownEntity(scope, text(formData, "entityId", 40), "/intel/experts");
  const db = tenantDb(scope.organizationId);
  await db.intelEntityRef.deleteMany({ where: { entityId: entity.id } });
  await db.intelEntity.updateMany({ where: { id: entity.id }, data: { deletedAt: new Date() } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.registry.deleted", targetType: "intel_entity", targetId: entity.id });
  const kind = entity.kind as EntityKind;
  go(ENTITY_LABELS[kind]?.route ?? "/intel/experts", { notice: `${entity.name} deleted. It comes back if an email names it again; ignore it to stop that.` });
}

export async function rebuildLinks(formData: FormData) {
  const kind = kindOf(formData);
  const back = ENTITY_LABELS[kind].route;
  const scope = await writeScope(back);
  const count = await relinkAll(scope.organizationId, scope.brand.id);
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.registry.relinked", targetType: "intel_entity", targetId: String(count) });
  go(back, { notice: `Re-linked ${count} email${count === 1 ? "" : "s"} and videos to experts, lists and topics.` });
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function saveDigestSettings(formData: FormData) {
  const scope = await writeScope("/intel/settings");
  const webhook = text(formData, "slackWebhook", 500);
  if (webhook && !isSlackWebhookUrl(webhook)) go("/intel/settings", { error: "That is not a Slack incoming webhook URL (https://hooks.slack.com/services/…)." });
  const emails = parseDigestEmails(text(formData, "digestEmails", 3000));
  const current = await readSettings(scope.organizationId, scope.brand.id);
  const enabled = formData.get("digestEnabled") === "on";
  if (enabled && !webhook && !current.slackWebhookEnc && !emails.length) go("/intel/settings", { error: "Add a Slack webhook or at least one email address before turning the digest on." });
  await writeSettings(scope.organizationId, scope.brand.id, {
    digestEnabled: enabled,
    digestEmails: emails,
    autoLanding: formData.get("autoLanding") === "on",
    ...(webhook ? { slackWebhookEnc: encryptToken(webhook, authSecret()) } : {}),
  });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.settings.updated", targetType: "intel_settings", targetId: scope.brand.id });
  go("/intel/settings", { notice: "Settings saved." });
}

export async function removeSlackWebhook() {
  const scope = await writeScope("/intel/settings");
  await writeSettings(scope.organizationId, scope.brand.id, { slackWebhookEnc: null });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.settings.slack-removed", targetType: "intel_settings", targetId: scope.brand.id });
  go("/intel/settings", { notice: "Slack webhook removed." });
}

export async function sendDigestNow() {
  const scope = await writeScope("/intel/settings");
  const outcome = await sendBrandDigest({ organizationId: scope.organizationId, brand: scope.brand, week: lastCompleteWeek(), force: true });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.digest.sent", targetType: "intel_settings", targetId: scope.brand.id });
  if (outcome.skipped) go("/intel/settings", { error: `Not sent: ${outcome.skipped}.` });
  if (!outcome.sent) go("/intel/settings", { error: outcome.error ?? "The digest was not sent." });
  go("/intel/settings", { notice: `Last week's digest sent${outcome.slack === "sent" ? " to Slack" : ""}${outcome.email === "sent" ? `${outcome.slack === "sent" ? " and" : ""} by email` : ""}.${outcome.error ? ` ${outcome.error}` : ""}` });
}
