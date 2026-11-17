"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { parsePasted } from "../../../../../modules/support/gaps";
import { checkContent, gateMessage } from "../../../../../modules/support/gate";
import { clampRateLimit, encryptSecret, mintAgentKey, mintIngestKey, newWebhookSecret, secretHint } from "../../../../../modules/support/keys";
import { normalizeScope } from "../../../../../modules/support/scope";
import { csvToPages } from "../../../../../modules/support/site-pages";
import { isAudience, isRecordCategory } from "../../../../../modules/support/taxonomy";
import { currentRequest } from "@/lib/request";
import { proposeBrainNote } from "./brain";
import { ensureSettings } from "./data";
import { recordGaps } from "./gaps";
import { UUID, authSecret, supportAction, withMessage, type SupportCtx } from "./guard";
import { pullProfile, pushProfile, resolvePlatformEdit } from "./platform";
import { syncFromPubsetup } from "./pubsetup-sync";
import { saveRecord, setRecordStatus } from "./records";
import { importPages, importSheet, type ImportResult } from "./website";

export type SecretState = { ok: true; secret: string; label: string } | { ok: false; error: string } | null;

function audit(ctx: SupportCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, ...(metadata ? { metadata } : {}) });
}

function field(formData: FormData, key: string, max = 2000): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function idOf(formData: FormData, key: string): string {
  const value = field(formData, key, 60);
  return UUID.test(value) ? value : "";
}

function writeScope(ctx: SupportCtx) {
  return { organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId, canPublish: ctx.canPublish };
}

function importSummary(r: ImportResult): string {
  return `Website import: ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged, ${r.locked} locked (edited here), ${r.invalid.length} skipped. ${r.byAudience.public} public, ${r.byAudience.member} members only, ${r.hidden} hidden from agents.`;
}

// ── Records ────────────────────────────────────────────────────────────────

export async function saveRecordAction(formData: FormData) {
  const id = idOf(formData, "recordId");
  const back = id ? `/support/records/${id}` : "/support/records/new";
  const ctx = await supportAction("support.write", back);
  const gapId = idOf(formData, "gapId");
  const db = tenantDb(ctx.resolved.id);
  const existing = id ? await db.supportRecord.findFirst({ where: { id, brandId: ctx.brand.id }, select: { source: true } }) : null;
  const raw = {
    category: field(formData, "category", 40),
    audience: field(formData, "audience", 20),
    status: field(formData, "status", 20),
    title: field(formData, "title", 400),
    body: String(formData.get("body") ?? ""),
    summary: field(formData, "summary", 2500),
    url: field(formData, "url", 1200),
    tags: field(formData, "tags", 3000),
    publicationCodes: field(formData, "publicationCodes", 1000),
    gateOverrides: formData.getAll("gateOverrides"),
  };
  const result = await saveRecord(writeScope(ctx), id || null, raw, {
    // A record that came from a source and is edited here stops syncing (locked) until unlocked.
    lock: existing && existing.source !== "manual" ? true : undefined,
    source: existing ? undefined : gapId ? "gap" : "manual",
    confirmPrice: formData.get("confirmPrice") === "on",
  });
  if (!result.ok) {
    const q = new URLSearchParams({ error: result.error });
    if (!id) for (const key of ["category", "audience", "title"] as const) if (raw[key]) q.set(key, raw[key]);
    redirect(`${back}?${q.toString()}`);
  }
  if (gapId) await db.supportGap.updateMany({ where: { id: gapId, brandId: ctx.brand.id }, data: { status: "resolved", recordId: result.id, resolvedAt: new Date() } });
  await audit(ctx, id ? "support.record.updated" : "support.record.created", "support_record", result.id, { status: result.status, gateHits: result.gateHits, gapId: gapId || null });
  const note = result.status === "published" ? "Saved and published. Agents can use it now." : result.gateHits.length ? `Saved as ${result.status}. The gate flagged: ${result.gateHits.join(", ")}.` : `Saved as ${result.status}.`;
  redirect(withMessage(`/support/records/${result.id}`, "notice", note));
}

export async function recordStatusAction(formData: FormData) {
  const id = idOf(formData, "recordId");
  const to = field(formData, "to", 20) === "archived" ? "archived" : "draft";
  const ctx = await supportAction(to === "archived" ? "support.publish" : "support.write", `/support/records/${id}`);
  if (!id || !(await setRecordStatus(writeScope(ctx), id, to))) redirect(withMessage("/support", "error", "That record no longer exists."));
  await audit(ctx, to === "archived" ? "support.record.archived" : "support.record.restored", "support_record", id);
  redirect(withMessage(`/support/records/${id}`, "notice", to === "archived" ? "Archived. Agents no longer see it." : "Restored as a draft."));
}

export async function unlockRecordAction(formData: FormData) {
  const id = idOf(formData, "recordId");
  const ctx = await supportAction("support.publish", `/support/records/${id}`);
  await tenantDb(ctx.resolved.id).supportRecord.updateMany({ where: { id, brandId: ctx.brand.id }, data: { locked: false, sourceHash: null } });
  await audit(ctx, "support.record.unlocked", "support_record", id);
  redirect(withMessage(`/support/records/${id}`, "notice", "Unlocked. The next sync or import will refresh it from its source."));
}

// ── Sources ────────────────────────────────────────────────────────────────

export async function syncPubsetupAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/sources");
  await ensureSettings(ctx.resolved.id, ctx.brand.id);
  const auto = formData.get("pubsetupSync") === "on";
  await tenantDb(ctx.resolved.id).supportSettings.updateMany({ where: { brandId: ctx.brand.id }, data: { pubsetupSync: auto } });
  if (formData.get("intent") === "save") redirect(withMessage("/support/sources", "notice", auto ? "Publication Setup will be synced every hour." : "Hourly Publication Setup sync is off."));
  const result = await syncFromPubsetup(ctx.resolved.id, ctx.brand.id, ctx.actorId);
  await audit(ctx, "support.pubsetup.synced", "brand", ctx.brand.id, result);
  redirect(
    withMessage(
      "/support/sources",
      "notice",
      `Publication Setup: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.locked} locked (edited here)${result.held ? `, ${result.held} held as draft by the gate` : ""}. Prices stay drafts until confirmed.`,
    ),
  );
}

export async function importCsvAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/sources");
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) redirect(withMessage("/support/sources", "error", "Choose a CSV file."));
  if (file.size > 20 * 1024 * 1024) redirect(withMessage("/support/sources", "error", "The CSV must be under 20 MB."));
  const { rows, unknownColumns } = csvToPages(await file.text());
  if (!rows.length) redirect(withMessage("/support/sources", "error", "No rows found. The first row must be headers such as Title, URL, Date, Access level."));
  const result = await importPages({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId }, rows);
  await audit(ctx, "support.website.imported", "brand", ctx.brand.id, { source: "csv", created: result.created, updated: result.updated, locked: result.locked });
  redirect(withMessage("/support/sources", "notice", `${importSummary(result)}${unknownColumns.length ? ` Ignored columns: ${unknownColumns.slice(0, 6).join(", ")}.` : ""}`));
}

export async function sheetAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/sources");
  await ensureSettings(ctx.resolved.id, ctx.brand.id);
  const url = field(formData, "sheetUrl", 1000);
  const auto = formData.get("siteSheetSync") === "on";
  const db = tenantDb(ctx.resolved.id);
  await db.supportSettings.updateMany({ where: { brandId: ctx.brand.id }, data: { siteSheetUrl: url || null, siteSheetSync: Boolean(url) && auto } });
  if (!url || formData.get("intent") === "save") redirect(withMessage("/support/sources", "notice", url ? "Sheet link saved." : "Sheet link removed."));
  const result = await importSheet({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId }, url);
  if ("error" in result) redirect(withMessage("/support/sources", "error", result.error));
  await db.supportSettings.updateMany({ where: { brandId: ctx.brand.id }, data: { lastSheetSyncAt: new Date(), lastSheetResult: { created: result.created, updated: result.updated, unchanged: result.unchanged, locked: result.locked, invalid: result.invalid.length } } });
  await audit(ctx, "support.website.imported", "brand", ctx.brand.id, { source: "sheet", created: result.created, updated: result.updated, locked: result.locked });
  redirect(withMessage("/support/sources", "notice", importSummary(result)));
}

export async function ingestKeyAction(_previous: SecretState, formData: FormData): Promise<SecretState> {
  void formData;
  const ctx = await supportAction("support.publish", "/support/sources");
  await ensureSettings(ctx.resolved.id, ctx.brand.id);
  const minted = mintIngestKey();
  await tenantDb(ctx.resolved.id).supportSettings.updateMany({ where: { brandId: ctx.brand.id }, data: { ingestKeyHash: minted.hash, ingestKeyPrefix: minted.prefix } });
  await audit(ctx, "support.ingest_key.rotated", "brand", ctx.brand.id, { prefix: minted.prefix });
  return { ok: true, secret: minted.key, label: "Website ingest key" };
}

export async function proposeBrainAction(formData: FormData) {
  const ctx = await supportAction("support.write", "/support/sources");
  const noteId = idOf(formData, "noteId");
  const result = await proposeBrainNote({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId, noteId });
  if (!result.ok) redirect(withMessage("/support/sources#brain", "error", result.error));
  await audit(ctx, "support.brain.proposed", "support_proposal", result.id, { noteId });
  redirect(
    withMessage(
      "/support/sources#review",
      "notice",
      result.blocked.length ? `Added to review. The gate found internal material (${result.blocked.join(", ")}): edit it out before approving.` : "Added to review. A publisher approves it before agents can use it.",
    ),
  );
}

export async function approveProposalAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/sources#review");
  const id = idOf(formData, "proposalId");
  const db = tenantDb(ctx.resolved.id);
  const proposal = await db.supportProposal.findFirst({ where: { id, brandId: ctx.brand.id, kind: "brain-note", status: "pending" } });
  if (!proposal) redirect(withMessage("/support/sources#review", "error", "That proposal was already decided."));
  const category = field(formData, "category", 40);
  const audience = field(formData, "audience", 20);
  if (!isRecordCategory(category) || !isAudience(audience)) redirect(withMessage("/support/sources#review", "error", "Pick a category and an audience."));
  const title = field(formData, "title", 300) || proposal.title;
  const body = String(formData.get("body") ?? proposal.text).slice(0, 50_000);
  const gate = checkContent(`${title}\n${body}`);
  if (!gate.ok) redirect(withMessage("/support/sources#review", "error", gateMessage(gate)));
  const status = field(formData, "status", 20) === "published" ? "published" : "draft";
  const result = await saveRecord(writeScope(ctx), null, { category, audience, status, title, body, gateOverrides: [] }, { source: "brain", sourceRef: proposal.sourceRef, lock: true, note: "approved from Brain" });
  if (!result.ok) redirect(withMessage("/support/sources#review", "error", result.error));
  await db.supportProposal.updateMany({ where: { id }, data: { status: "approved", decidedById: ctx.actorId, decidedAt: new Date(), recordId: result.id, gateHits: gate.hits.map((h) => h.id) } });
  await audit(ctx, "support.brain.approved", "support_record", result.id, { proposalId: id });
  redirect(withMessage(`/support/records/${result.id}`, "notice", `Copied from the Brain as ${status}.`));
}

export async function rejectProposalAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/sources#review");
  const id = idOf(formData, "proposalId");
  const db = tenantDb(ctx.resolved.id);
  const proposal = await db.supportProposal.findFirst({ where: { id, brandId: ctx.brand.id, status: "pending" }, select: { kind: true, profileId: true } });
  if (!proposal) redirect(withMessage("/support/sources#review", "error", "That proposal was already decided."));
  if (proposal.kind === "platform-edit") {
    const decision = field(formData, "decision", 20) === "approved" ? "approved" : "rejected";
    await resolvePlatformEdit(ctx.resolved.id, id, decision, ctx.actorId);
    await audit(ctx, "support.platform_edit.resolved", "support_proposal", id, { decision });
    redirect(withMessage("/support/sources#review", "notice", "Resolved. The next push sends this app's version again."));
  }
  await db.supportProposal.updateMany({ where: { id }, data: { status: "rejected", decidedById: ctx.actorId, decidedAt: new Date() } });
  await audit(ctx, "support.proposal.rejected", "support_proposal", id);
  redirect(withMessage("/support/sources#review", "notice", "Not copied."));
}

// ── Agents ─────────────────────────────────────────────────────────────────

function profileFields(formData: FormData, niche: string) {
  const scope = normalizeScope({ categories: formData.getAll("categories"), audiences: formData.getAll("audiences") }, niche);
  const surface = field(formData, "surface", 40);
  return {
    name: field(formData, "name", 80),
    personaName: field(formData, "personaName", 60) || "Merlin",
    surface: ["chat", "member-chat", "phone", "other"].includes(surface) ? surface : "chat",
    categories: scope.categories,
    audiences: scope.audiences,
    instructions: field(formData, "instructions", 4000),
    escalation: field(formData, "escalation", 1000),
    firstMessage: field(formData, "firstMessage", 500),
    rateLimit: clampRateLimit(formData.get("rateLimit")),
    remoteAgentId: field(formData, "remoteAgentId", 120).replace(/[^A-Za-z0-9_-]/g, "") || null,
    autoSync: formData.get("autoSync") === "on",
    active: formData.get("active") !== "off",
  };
}

export async function createProfileAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/agents");
  const data = profileFields(formData, ctx.profile.niche);
  if (!data.name) redirect(withMessage("/support/agents", "error", "Name the agent, for example Website chat."));
  const row = await tenantDb(ctx.resolved.id).supportAgentProfile.create({
    data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data, platform: data.remoteAgentId ? "elevenlabs" : "none", createdById: ctx.actorId },
    select: { id: true },
  });
  await audit(ctx, "support.agent.created", "support_agent", row.id, { categories: data.categories, audiences: data.audiences });
  redirect(withMessage(`/support/agents/${row.id}`, "notice", "Agent created. Make its key next."));
}

export async function saveProfileAction(formData: FormData) {
  const id = idOf(formData, "profileId");
  const ctx = await supportAction("support.publish", `/support/agents/${id}`);
  const data = profileFields(formData, ctx.profile.niche);
  if (!data.name) redirect(withMessage(`/support/agents/${id}`, "error", "The agent needs a name."));
  const updated = await tenantDb(ctx.resolved.id).supportAgentProfile.updateMany({ where: { id, brandId: ctx.brand.id, deletedAt: null }, data: { ...data, platform: data.remoteAgentId ? "elevenlabs" : "none" } });
  if (!updated.count) redirect(withMessage("/support/agents", "error", "That agent no longer exists."));
  await audit(ctx, "support.agent.updated", "support_agent", id, { categories: data.categories, audiences: data.audiences, active: data.active });
  redirect(withMessage(`/support/agents/${id}`, "notice", "Saved. The scope applies to the next API call."));
}

export async function deleteProfileAction(formData: FormData) {
  const id = idOf(formData, "profileId");
  const ctx = await supportAction("support.publish", `/support/agents/${id}`);
  await tenantDb(ctx.resolved.id).supportAgentProfile.updateMany({ where: { id, brandId: ctx.brand.id }, data: { deletedAt: new Date(), active: false, keyHash: null } });
  await audit(ctx, "support.agent.deleted", "support_agent", id);
  redirect(withMessage("/support/agents", "notice", "Agent removed. Its key stopped working."));
}

export async function rotateKeyAction(_previous: SecretState, formData: FormData): Promise<SecretState> {
  const id = idOf(formData, "profileId");
  const ctx = await supportAction("support.publish", `/support/agents/${id}`);
  const minted = mintAgentKey();
  const updated = await tenantDb(ctx.resolved.id).supportAgentProfile.updateMany({
    where: { id, brandId: ctx.brand.id, deletedAt: null },
    // A new key invalidates the ElevenLabs secret that held the old one.
    data: { keyHash: minted.hash, keyPrefix: minted.prefix, keyCreatedAt: new Date(), remoteSecretId: null },
  });
  if (!updated.count) return { ok: false, error: "That agent no longer exists." };
  await audit(ctx, "support.agent.key_rotated", "support_agent", id, { prefix: minted.prefix });
  return { ok: true, secret: minted.key, label: "Agent key" };
}

export async function webhookSecretAction(_previous: SecretState, formData: FormData): Promise<SecretState> {
  const id = idOf(formData, "profileId");
  const ctx = await supportAction("support.publish", `/support/agents/${id}`);
  const secret = newWebhookSecret();
  const updated = await tenantDb(ctx.resolved.id).supportAgentProfile.updateMany({ where: { id, brandId: ctx.brand.id, deletedAt: null }, data: { webhookSecretEnc: encryptSecret(secret, authSecret()) } });
  if (!updated.count) return { ok: false, error: "That agent no longer exists." };
  await audit(ctx, "support.agent.webhook_secret_rotated", "support_agent", id);
  return { ok: true, secret, label: "Post-call webhook secret" };
}

export async function connectElevenAction(formData: FormData) {
  const ctx = await supportAction("support.publish", "/support/agents");
  const key = field(formData, "apiKey", 300);
  const db = tenantDb(ctx.resolved.id);
  if (formData.get("intent") === "disconnect") {
    await db.supportConnection.deleteMany({ where: { brandId: ctx.brand.id, platform: "elevenlabs" } });
    await audit(ctx, "support.elevenlabs.disconnected", "brand", ctx.brand.id);
    redirect(withMessage("/support/agents", "notice", "ElevenLabs disconnected. The stored key was deleted."));
  }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) redirect(withMessage("/support/agents", "error", "Paste the ElevenLabs API key from your ElevenLabs account (Profile → API keys)."));
  const data = { apiKeyEnc: encryptSecret(key, authSecret()), keyHint: secretHint(key) };
  const updated = await db.supportConnection.updateMany({ where: { brandId: ctx.brand.id, platform: "elevenlabs" }, data });
  if (!updated.count) await db.supportConnection.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, platform: "elevenlabs", ...data, createdById: ctx.actorId } });
  await audit(ctx, "support.elevenlabs.connected", "brand", ctx.brand.id, { hint: data.keyHint });
  redirect(withMessage("/support/agents", "notice", "ElevenLabs connected. The key is stored encrypted and never shown again."));
}

export async function pushProfileAction(formData: FormData) {
  const id = idOf(formData, "profileId");
  const ctx = await supportAction("support.publish", `/support/agents/${id}`);
  const db = tenantDb(ctx.resolved.id);
  const profile = await db.supportAgentProfile.findFirst({ where: { id, brandId: ctx.brand.id, deletedAt: null }, select: { id: true, syncStatus: true } });
  if (!profile) redirect(withMessage("/support/agents", "error", "That agent no longer exists."));
  const connected = await db.supportConnection.count({ where: { brandId: ctx.brand.id, platform: "elevenlabs" } });
  if (!connected) redirect(withMessage(`/support/agents/${id}`, "error", "Connect ElevenLabs first, or download the bundle and upload it by hand."));
  const mode = field(formData, "mode", 10) === "pull" ? "pull" : "push";
  const agentKey = field(formData, "agentKey", 100) || null;
  const force = formData.get("force") === "on";
  const { origin } = await currentRequest();
  await db.supportAgentProfile.updateMany({ where: { id }, data: { syncStatus: "queued" } });
  const organizationId = ctx.resolved.id;
  after(async () => {
    try {
      if (mode === "pull") {
        const pulled = await pullProfile({ organizationId, profileId: id });
        await tenantDb(organizationId).supportAgentProfile.updateMany({ where: { id }, data: { syncStatus: pulled.errors.length ? "failed" : "done", lastSyncResult: { pull: pulled, at: new Date().toISOString() } } });
      } else await pushProfile({ organizationId, profileId: id, origin, force, agentKey });
    } catch (error) {
      await tenantDb(organizationId).supportAgentProfile.updateMany({ where: { id }, data: { syncStatus: "failed", lastSyncResult: { error: String(error instanceof Error ? error.message : error).slice(0, 400), at: new Date().toISOString() } } });
    }
  });
  await audit(ctx, mode === "pull" ? "support.elevenlabs.pull" : "support.elevenlabs.push", "support_agent", id, { force });
  redirect(withMessage(`/support/agents/${id}`, "notice", mode === "pull" ? "Checking ElevenLabs for edits…" : "Pushing to ElevenLabs…"));
}

// ── Gaps ───────────────────────────────────────────────────────────────────

export async function pasteGapsAction(formData: FormData) {
  const ctx = await supportAction("support.write", "/support/gaps");
  const gaps = parsePasted(String(formData.get("text") ?? "").slice(0, 100_000));
  if (!gaps.length) redirect(withMessage("/support/gaps", "error", "Paste questions one per line, or a transcript with Customer: lines."));
  const profileId = idOf(formData, "profileId") || null;
  const result = await recordGaps({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, profileId, source: "manual", actorId: ctx.actorId, gaps });
  await audit(ctx, "support.gaps.added", "brand", ctx.brand.id, result);
  redirect(withMessage("/support/gaps", "notice", `${result.added} new gap(s), ${result.repeated} already in the queue.`));
}

export async function gapStatusAction(formData: FormData) {
  const ctx = await supportAction("support.write", "/support/gaps");
  const id = idOf(formData, "gapId");
  const to = field(formData, "to", 20);
  const status = to === "dismissed" ? "dismissed" : to === "resolved" ? "resolved" : "open";
  await tenantDb(ctx.resolved.id).supportGap.updateMany({ where: { id, brandId: ctx.brand.id }, data: { status, resolvedAt: status === "open" ? null : new Date() } });
  await audit(ctx, "support.gap.status", "support_gap", id, { status });
  redirect(withMessage("/support/gaps", "notice", status === "open" ? "Reopened." : status === "dismissed" ? "Dismissed." : "Marked answered."));
}
