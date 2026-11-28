"use server";

import { aiConfigured } from "@pubcommand/ai";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { currentRequest } from "@/lib/request";
import {
  buildAuthUrl,
  decryptToken,
  normalizeCompetitorInput,
  normalizeDomain,
  parseWeek,
  preparePaste,
  prepareUpload,
  revokeToken,
  signState,
  weekStartOf,
  isoDay,
} from "../../../../../modules/intel/index";
import { canUsePromoAnalyzer, intelAccess, type IntelScope } from "./context";
import { authSecret, gmailEnv, gmailRedirectUri, syncGmailAccount } from "./gmail";
import { buildRadarDigest, drainExtractions, rematchEmails, runRadarNarrative, sendToPromoAnalyzer, storeEmails } from "./server";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

function go(path: string, flash?: { error?: string; notice?: string }): never {
  const params = new URLSearchParams();
  if (flash?.error) params.set("error", flash.error);
  if (flash?.notice) params.set("notice", flash.notice);
  const query = params.toString();
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);
}

async function writeScope(back = "/intel/captures"): Promise<IntelScope> {
  const access = await intelAccess("write");
  if (!access.ok) go(back, { error: access.error });
  return access.scope;
}

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function startExtraction(scope: IntelScope) {
  if (!aiConfigured()) return;
  after(() => drainExtractions({ organizationId: scope.organizationId, brand: scope.brand, actorId: scope.actorId }));
}

// ── Competitors ─────────────────────────────────────────────────────────────

function competitorFields(formData: FormData) {
  return normalizeCompetitorInput({
    name: text(formData, "name", 200),
    products: text(formData, "products", 4000),
    websites: text(formData, "websites", 4000),
    senders: text(formData, "senders", 8000),
    notes: text(formData, "notes", 4000),
    tags: text(formData, "tags", 1000),
  });
}

export async function createCompetitor(formData: FormData) {
  const scope = await writeScope("/intel/competitors");
  const fields = competitorFields(formData);
  if (!fields.name) go("/intel/competitors", { error: "Give the competitor a name." });
  const db = tenantDb(scope.organizationId);
  const row = await db.intelCompetitor.create({
    data: { organizationId: scope.organizationId, brandId: scope.brand.id, createdById: scope.actorId, ...fields },
    select: { id: true },
  });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.competitor.created", targetType: "intel_competitor", targetId: row.id });
  const matched = await rematchEmails(scope.organizationId, scope.brand.id);
  go(`/intel/competitors/${row.id}`, { notice: `Competitor added.${matched ? ` ${matched} email${matched === 1 ? "" : "s"} matched.` : ""}` });
}

/** One click from an unmatched sender domain on the competitors page. */
export async function addCompetitorFromDomain(formData: FormData) {
  const scope = await writeScope("/intel/competitors");
  const domain = normalizeDomain(text(formData, "domain", 200));
  if (!domain) go("/intel/competitors", { error: "That is not a domain." });
  const name = text(formData, "name", 160) || domain;
  const row = await tenantDb(scope.organizationId).intelCompetitor.create({
    data: { organizationId: scope.organizationId, brandId: scope.brand.id, createdById: scope.actorId, name, senderDomains: [domain], websites: [`https://${domain}`] },
    select: { id: true },
  });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.competitor.created", targetType: "intel_competitor", targetId: row.id });
  const matched = await rematchEmails(scope.organizationId, scope.brand.id);
  go(`/intel/competitors/${row.id}`, { notice: `Competitor added from ${domain}. ${matched} email${matched === 1 ? "" : "s"} matched. Rename it and add its brands.` });
}

export async function updateCompetitor(formData: FormData) {
  const scope = await writeScope("/intel/competitors");
  const id = text(formData, "competitorId", 40);
  const fields = competitorFields(formData);
  if (!UUID.test(id)) go("/intel/competitors", { error: "That competitor no longer exists." });
  if (!fields.name) go(`/intel/competitors/${id}`, { error: "Give the competitor a name." });
  const db = tenantDb(scope.organizationId);
  const updated = await db.intelCompetitor.updateMany({ where: { id, brandId: scope.brand.id, deletedAt: null }, data: fields });
  if (!updated.count) go("/intel/competitors", { error: "That competitor no longer exists." });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.competitor.updated", targetType: "intel_competitor", targetId: id });
  const matched = await rematchEmails(scope.organizationId, scope.brand.id);
  go(`/intel/competitors/${id}`, { notice: `Saved.${matched ? ` ${matched} email${matched === 1 ? "" : "s"} re-matched.` : ""}` });
}

export async function deleteCompetitor(formData: FormData) {
  const scope = await writeScope("/intel/competitors");
  const id = text(formData, "competitorId", 40);
  if (!UUID.test(id)) go("/intel/competitors");
  const db = tenantDb(scope.organizationId);
  await db.intelCompetitor.updateMany({ where: { id, brandId: scope.brand.id }, data: { deletedAt: new Date() } });
  await db.intelEmail.updateMany({ where: { brandId: scope.brand.id, competitorId: id }, data: { competitorId: null, matchedBy: null } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.competitor.deleted", targetType: "intel_competitor", targetId: id });
  await rematchEmails(scope.organizationId, scope.brand.id);
  go("/intel/competitors", { notice: "Competitor removed. Its emails stay in the inbox." });
}

// ── Adding email ────────────────────────────────────────────────────────────

export async function uploadEmails(formData: FormData) {
  const scope = await writeScope("/intel/add");
  const files = formData.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
  if (!files.length) go("/intel/add", { error: "Choose one or more .eml or .mbox files." });
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_UPLOAD_BYTES) go("/intel/add", { error: "That upload is over 50 MB. Split the mbox or upload fewer files." });
  let added = 0;
  let duplicates = 0;
  const skipped: string[] = [];
  for (const file of files) {
    if (!/\.(eml|mbox|txt|msg)$/i.test(file.name) && file.type !== "message/rfc822") {
      skipped.push(`${file.name} (not an .eml or .mbox file)`);
      continue;
    }
    if (/\.msg$/i.test(file.name)) {
      skipped.push(`${file.name} (Outlook .msg; save it as .eml first)`);
      continue;
    }
    const prepared = prepareUpload(new Uint8Array(await file.arrayBuffer()), file.name);
    for (const skip of prepared.skipped) skipped.push(`${skip.count} from ${file.name} (${skip.reason})`);
    const result = await storeEmails({
      organizationId: scope.organizationId,
      brandId: scope.brand.id,
      actorId: scope.actorId,
      source: /\.mbox$/i.test(file.name) || prepared.emails.length > 1 ? "mbox" : "upload",
      emails: prepared.emails,
    });
    added += result.added;
    duplicates += result.duplicates;
  }
  startExtraction(scope);
  const parts = [`Added ${added} email${added === 1 ? "" : "s"}.`];
  if (duplicates) parts.push(`${duplicates} already in the inbox.`);
  if (skipped.length) parts.push(`Skipped: ${skipped.slice(0, 5).join("; ")}.`);
  if (added && aiConfigured()) parts.push("Extraction is running.");
  go(added ? "/intel/captures" : "/intel/add", added ? { notice: parts.join(" ") } : { error: parts.join(" ") });
}

export async function pasteEmail(formData: FormData) {
  const scope = await writeScope("/intel/add");
  const prepared = preparePaste({
    source: String(formData.get("source") ?? "").slice(0, 2_000_000),
    subject: text(formData, "subject", 500),
    from: text(formData, "from", 320),
    date: text(formData, "date", 40),
  });
  if ("error" in prepared) go("/intel/add?tab=paste", { error: prepared.error });
  const result = await storeEmails({ organizationId: scope.organizationId, brandId: scope.brand.id, actorId: scope.actorId, source: "paste", emails: [prepared] });
  if (!result.added) go("/intel/add?tab=paste", { error: "That email is already in the inbox." });
  startExtraction(scope);
  go(`/intel/emails/${result.ids[0]}`, { notice: "Email added." });
}

// ── One email ───────────────────────────────────────────────────────────────

export async function assignCompetitor(formData: FormData) {
  const scope = await writeScope();
  const emailId = text(formData, "emailId", 40);
  const competitorId = text(formData, "competitorId", 40);
  if (!UUID.test(emailId)) go("/intel/captures");
  const db = tenantDb(scope.organizationId);
  if (competitorId && !(await db.intelCompetitor.findFirst({ where: { id: competitorId, brandId: scope.brand.id, deletedAt: null }, select: { id: true } }))) {
    go(`/intel/emails/${emailId}`, { error: "Pick a competitor from the list." });
  }
  await db.intelEmail.updateMany({
    where: { id: emailId, brandId: scope.brand.id },
    data: competitorId ? { competitorId, matchedBy: "manual" } : { competitorId: null, matchedBy: null },
  });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.email.assigned", targetType: "intel_email", targetId: emailId });
  go(`/intel/emails/${emailId}`, { notice: competitorId ? "Competitor set." : "Competitor cleared." });
}

export async function extractEmail(formData: FormData) {
  const scope = await writeScope();
  const emailId = text(formData, "emailId", 40);
  if (!UUID.test(emailId)) go("/intel/captures");
  if (!aiConfigured()) go(`/intel/emails/${emailId}`, { error: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway, then run extraction." });
  await tenantDb(scope.organizationId).intelEmail.updateMany({ where: { id: emailId, brandId: scope.brand.id }, data: { extractionStatus: "QUEUED", extractionError: null } });
  startExtraction(scope);
  go(`/intel/emails/${emailId}`);
}

export async function extractAllPending() {
  const scope = await writeScope();
  if (!aiConfigured()) go("/intel/captures", { error: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway, then run extraction." });
  const queued = await tenantDb(scope.organizationId).intelEmail.updateMany({
    where: { brandId: scope.brand.id, deletedAt: null, extractionStatus: { in: ["NONE", "FAILED"] } },
    data: { extractionStatus: "QUEUED", extractionError: null },
  });
  startExtraction(scope);
  go("/intel/captures", { notice: `${queued.count} email${queued.count === 1 ? "" : "s"} queued for extraction.` });
}

export async function deleteEmail(formData: FormData) {
  const scope = await writeScope();
  const emailId = text(formData, "emailId", 40);
  if (!UUID.test(emailId)) go("/intel/captures");
  await tenantDb(scope.organizationId).intelEmail.updateMany({ where: { id: emailId, brandId: scope.brand.id }, data: { deletedAt: new Date() } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.email.deleted", targetType: "intel_email", targetId: emailId });
  go("/intel/captures", { notice: "Email deleted." });
}

export async function sendEmailToPromoAnalyzer(formData: FormData) {
  const scope = await writeScope();
  const emailId = text(formData, "emailId", 40);
  if (!UUID.test(emailId)) go("/intel/captures");
  if (!(await canUsePromoAnalyzer())) go(`/intel/emails/${emailId}`, { error: "Sending to Promo Analyzer needs Promo Analyzer turned on and promo.write." });
  const result = await sendToPromoAnalyzer({ organizationId: scope.organizationId, brand: scope.brand, emailId, actorId: scope.actorId });
  if ("error" in result) go(`/intel/emails/${emailId}`, { error: result.error });
  after(result.start);
  redirect(`/promo-studio/${result.promoId}`);
}

// ── Promo Radar ─────────────────────────────────────────────────────────────

export async function buildRadarAction(formData: FormData) {
  const scope = await writeScope("/intel/radar");
  const week = parseWeek(text(formData, "week", 20)) ?? weekStartOf(new Date());
  const digestId = await buildRadarDigest({ organizationId: scope.organizationId, brand: scope.brand, weekStart: week, actorId: scope.actorId });
  if (aiConfigured()) after(() => runRadarNarrative({ organizationId: scope.organizationId, brand: scope.brand, digestId, actorId: scope.actorId }));
  go(`/intel/radar?week=${isoDay(week)}`, { notice: "Radar built." });
}

// ── Gmail ───────────────────────────────────────────────────────────────────

export async function connectGmail() {
  const scope = await writeScope("/intel/gmail");
  const env = gmailEnv();
  if (!env) go("/intel/gmail", { error: "Google sign-in is not set up yet. See the steps below." });
  const request = await currentRequest();
  const state = signState({ organizationId: scope.organizationId, brandId: scope.brand.id, userId: scope.actorId, orgSlug: scope.orgSlug, returnTo: "/intel/gmail" }, authSecret());
  redirect(buildAuthUrl({ clientId: env.clientId, redirectUri: gmailRedirectUri(request.host), state }));
}

async function ownAccount(scope: IntelScope, accountId: string) {
  if (!UUID.test(accountId)) go("/intel/gmail", { error: "That inbox is not connected." });
  const account = await tenantDb(scope.organizationId).intelGmailAccount.findFirst({ where: { id: accountId, brandId: scope.brand.id } });
  if (!account) go("/intel/gmail", { error: "That inbox is not connected." });
  return account;
}

export async function syncGmailNow(formData: FormData) {
  const scope = await writeScope("/intel/gmail");
  const account = await ownAccount(scope, text(formData, "accountId", 40));
  if (!gmailEnv()) go("/intel/gmail", { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set." });
  const outcome = await syncGmailAccount({ organizationId: scope.organizationId, accountId: account.id, actorId: scope.actorId });
  startExtraction(scope);
  if (outcome.error) go("/intel/gmail", { error: `${account.email}: ${outcome.error}` });
  if (outcome.skipped) go("/intel/gmail", { notice: `${account.email} is already syncing.` });
  go("/intel/gmail", { notice: `${account.email}: ${outcome.added} new email${outcome.added === 1 ? "" : "s"}.` });
}

export async function updateGmailFilter(formData: FormData) {
  const scope = await writeScope("/intel/gmail");
  const account = await ownAccount(scope, text(formData, "accountId", 40));
  const query = text(formData, "query", 300) || null;
  await tenantDb(scope.organizationId).intelGmailAccount.updateMany({ where: { id: account.id }, data: { query } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.gmail.filter", targetType: "intel_gmail_account", targetId: account.id });
  go("/intel/gmail", { notice: "Filter saved. The next sync uses it." });
}

export async function disconnectGmail(formData: FormData) {
  const scope = await writeScope("/intel/gmail");
  const account = await ownAccount(scope, text(formData, "accountId", 40));
  try {
    await revokeToken((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }), decryptToken(account.refreshTokenEnc, authSecret()));
  } catch {
    // Revoking is best effort; the tokens are deleted either way.
  }
  await tenantDb(scope.organizationId).intelGmailAccount.deleteMany({ where: { id: account.id } });
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "intel.gmail.disconnected", targetType: "intel_gmail_account", targetId: account.id });
  go("/intel/gmail", { notice: `${account.email} disconnected. Its emails stay in the inbox.` });
}
