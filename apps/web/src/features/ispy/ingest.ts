import { readS3Config } from "@pubcommand/core";
import type { Prisma } from "@pubcommand/db";
import { prepareRaw, type PreparedEmail } from "../../../../../modules/intel/index";
import {
  candidateKey,
  fingerprintCopy,
  firstMatchingRule,
  listNameFromSender,
  mastheadSignals,
  mastheadText,
  matchCopy,
  matchListBySignals,
  matchPublisher,
  parseConditions,
  senderFacts,
  sendKindFor,
  suggestListCategory,
  isPlausibleNewListName,
  type RoutingFacts,
  type RoutingRule,
  type RuleAction,
} from "../../../../../modules/ispy/index";
import { s3Put } from "@/lib/s3";
import { ispyDb, type IspyTx } from "./db";

/** What a provider hands to ingest for one message. */
export type IncomingMessage = {
  raw: Uint8Array;
  inboxId: string;
  providerMessageId?: string | null;
  receivedAt?: Date | null;
  placement?: string | null;
  /** Everything the provider sent with the message, kept as-is. */
  providerMeta?: Record<string, unknown> | null;
  spamScore?: number | null;
  /** SPF/DKIM/DMARC as the provider recorded them (used when the headers carry none). */
  authResults?: { spf: string | null; dkim: string | null; dmarc: string | null } | null;
};

export type IngestResult = { status: "added"; emailId: string; copyId: string; newCopy: boolean } | { status: "duplicate"; emailId: string } | { status: "skipped"; reason: string };

type InboxRow = {
  id: string;
  address: string;
  level: string;
  feed: string;
  publisherId: string | null;
  publicationId: string | null;
  listId: string | null;
  affiliateSeed: boolean;
  status?: string;
};

type ListRow = { id: string; name: string; synonyms: string[]; publisherId: string; publicationId: string | null; isIgnored: boolean; category: string };

export type RouteDecision = {
  listId: string | null;
  publicationId: string | null;
  publisherId: string | null;
  ruleId: string | null;
  action: RuleAction | null;
  status: "ROUTED" | "UNSORTED" | "CANDIDATE" | "IGNORED";
  reason: string;
  candidateName: string | null;
};

export function routingFacts(prepared: Pick<PreparedEmail, "fromAddress" | "fromName" | "subject" | "headers" | "textBody" | "htmlBody">, inboxAddress: string | null): RoutingFacts {
  const sender = senderFacts(prepared.headers);
  const mastheads = mastheadSignals(prepared.htmlBody, prepared.subject);
  return {
    fromAddress: prepared.fromAddress.toLowerCase(),
    fromName: prepared.fromName,
    subject: prepared.subject,
    masthead: mastheadText(prepared.textBody, mastheads),
    listIdHeader: sender.listIdHeader,
    headers: prepared.headers,
    body: prepared.textBody,
    inboxAddress,
    campaignId: sender.campaignId,
  };
}

/** Load the registry pieces routing needs (small: a few thousand rows at most). */
export async function loadRoutingRegistry(tx: IspyTx) {
  const [publishers, lists, rules, inboxes] = await Promise.all([
    tx.ispyPublisher.findMany({ where: { deletedAt: null }, select: { id: true, name: true, type: true, feed: true, parentId: true, domains: true, fromAddresses: true, excludeBrands: true, linkedOrganizationId: true, linkedBrandId: true } }),
    tx.ispyList.findMany({ where: { deletedAt: null }, select: { id: true, name: true, synonyms: true, publisherId: true, publicationId: true, isIgnored: true, category: true } }),
    tx.ispyRoutingRule.findMany({ where: { enabled: true }, select: { id: true, priority: true, enabled: true, conditions: true, action: true, listId: true, publisherId: true, publicationId: true } }),
    tx.ispyInbox.findMany({ where: { level: "LIST", listId: { not: null }, status: { not: "RETIRED" } }, select: { id: true, listId: true } }),
  ]);
  const parsedRules: RoutingRule[] = rules.map((r) => ({ ...r, action: (r.action as RuleAction) ?? "ROUTE", conditions: parseConditions(r.conditions) }));
  return { publishers, lists, rules: parsedRules, listInboxByListId: new Map(inboxes.map((i) => [i.listId!, i.id])) };
}

export type RoutingRegistry = Awaited<ReturnType<typeof loadRoutingRegistry>>;

/**
 * Decide the list for one email. Order: a direct list inbox → affiliate seed → enabled
 * rules by priority → an existing list whose name or synonym matches the masthead or
 * sender → otherwise a new-list candidate (staff approve) or Unsorted.
 */
export function decideRoute(input: { facts: RoutingFacts; subject: string; inbox: InboxRow; registry: RoutingRegistry }): RouteDecision {
  const { facts, inbox, registry } = input;
  const listById = new Map<string, ListRow>(registry.lists.map((l) => [l.id, l]));
  const pick = (list: ListRow, reason: string, ruleId: string | null, action: RuleAction | null): RouteDecision => ({
    listId: list.id,
    publicationId: list.publicationId,
    publisherId: list.publisherId,
    ruleId,
    action,
    status: "ROUTED",
    reason,
    candidateName: null,
  });

  if (inbox.level === "LIST" && inbox.listId && listById.has(inbox.listId)) return pick(listById.get(inbox.listId)!, `Arrived at the list's own inbox ${inbox.address}.`, null, null);

  if (inbox.affiliateSeed) {
    const list = (inbox.listId && listById.get(inbox.listId)) || registry.lists.find((l) => l.publisherId === inbox.publisherId && l.category === "MARKETING_FILE" && !l.isIgnored);
    if (list) return pick(list, `Affiliate seed inbox ${inbox.address}: every email is credited to this affiliate's file.`, null, "AFFILIATE");
  }

  const sender = matchPublisher(facts.fromAddress, registry.publishers);
  const scopePublisherId = sender?.publisher.id ?? inbox.publisherId;
  const applicable = registry.rules.filter(
    (r) =>
      (!r.publisherId || r.publisherId === scopePublisherId || r.publisherId === inbox.publisherId) &&
      (!r.publicationId || r.publicationId === inbox.publicationId || (r.listId !== null && listById.get(r.listId)?.publicationId === r.publicationId)),
  );
  const rule = firstMatchingRule(facts, applicable);
  if (rule) {
    if (rule.action === "IGNORE") return { listId: null, publicationId: null, publisherId: scopePublisherId, ruleId: rule.id, action: "IGNORE", status: "IGNORED", reason: `Rule #${rule.priority} says ignore.`, candidateName: null };
    const list = rule.listId ? listById.get(rule.listId) : undefined;
    if (list) return pick(list, `Matched routing rule #${rule.priority}.`, rule.id, rule.action);
  }

  const masthead = facts.masthead.split(" | ").filter(Boolean);
  const fromSender = listNameFromSender(input.subject, facts.fromAddress);
  const signals = [...masthead.slice(0, 4), ...(fromSender ? [fromSender] : []), ...(facts.fromName ? [facts.fromName] : [])];
  const byName = matchListBySignals(signals, registry.lists, scopePublisherId);
  if (byName && (!scopePublisherId || byName.publisherId === scopePublisherId)) return pick(byName, `Masthead or sender name matches the list “${byName.name}”.`, null, null);

  const candidate = [...masthead, fromSender].find((n): n is string => !!n && isPlausibleNewListName(n, input.subject)) ?? null;
  if (candidate && scopePublisherId) {
    return { listId: null, publicationId: inbox.publicationId, publisherId: scopePublisherId, ruleId: null, action: null, status: "CANDIDATE", reason: `Looks like a list ISpy doesn't know yet (“${candidate}”). Waiting for staff to approve it.`, candidateName: candidate };
  }
  return {
    listId: null,
    publicationId: inbox.publicationId,
    publisherId: scopePublisherId ?? null,
    ruleId: null,
    action: null,
    status: "UNSORTED",
    reason: sender ? "No rule or list name matched." : "Unknown sender: no publisher matches this address or domain.",
    candidateName: null,
  };
}

async function storeRaw(emailId: string, raw: Uint8Array): Promise<string | null> {
  const config = readS3Config();
  if (!config) return null;
  const key = `platform/ispy/raw/${emailId}.eml`;
  try {
    await s3Put(config, key, raw, "message/rfc822");
    return key;
  } catch (error) {
    console.error("[ispy] raw upload failed", emailId, error);
    return null;
  }
}

async function upsertCandidate(tx: IspyTx, decision: RouteDecision, emailId: string, facts: RoutingFacts, registry: RoutingRegistry) {
  if (decision.status !== "CANDIDATE" || !decision.candidateName) return;
  const key = candidateKey(decision.publisherId, decision.candidateName);
  const publisherType = registry.publishers.find((p) => p.id === decision.publisherId)?.type ?? null;
  const signals = [facts.listIdHeader ? `List-Id ${facts.listIdHeader}` : null, `from ${facts.fromAddress}`, `masthead “${decision.candidateName}”`].filter(Boolean);
  const proposedRule = facts.listIdHeader
    ? [{ field: "listIdHeader", op: "equals", value: facts.listIdHeader }]
    : [{ field: "fromAddress", op: "equals", value: facts.fromAddress }];
  const existing = await tx.ispyListCandidate.findUnique({ where: { key } });
  if (existing) {
    if (existing.status !== "PENDING") return;
    await tx.ispyListCandidate.update({
      where: { key },
      data: { emailCount: { increment: 1 }, sampleEmailIds: existing.sampleEmailIds.length < 10 ? [...existing.sampleEmailIds, emailId] : existing.sampleEmailIds },
    });
    return;
  }
  await tx.ispyListCandidate.create({
    data: {
      key,
      publisherId: decision.publisherId,
      publicationId: decision.publicationId,
      proposedName: decision.candidateName,
      proposedType: suggestListCategory(decision.candidateName, facts.fromAddress, publisherType),
      signals: signals as Prisma.InputJsonValue,
      proposedRule: proposedRule as Prisma.InputJsonValue,
      sampleEmailIds: [emailId],
      emailCount: 1,
    },
  });
}

/** Find (or create) the copy this email belongs to and update its counters. */
export async function attachCopy(tx: IspyTx, input: { feed: string; text: string; subject: string; receivedAt: Date; listId: string | null; sendKind: string; campaignId: string | null; publisherId: string | null }) {
  const fp = fingerprintCopy(input.text);
  const candidates = await tx.ispyCopy.findMany({
    where: {
      feed: input.feed,
      mergedIntoId: null,
      OR: [{ copyHash: fp.hash }, { band0: fp.bands[0] }, { band1: fp.bands[1] }, { band2: fp.bands[2] }, { band3: fp.bands[3] }, ...(input.publisherId ? [{ emails: { some: { publisherId: input.publisherId, receivedAt: { gte: new Date(input.receivedAt.getTime() - 120 * 86_400_000) } } } }] : [])],
    },
    select: { id: true, copyHash: true, simhash: true, normalized: true },
    take: 300,
    orderBy: { lastSeenAt: "desc" },
  });
  let campaignCopyId: string | null = null;
  if (input.campaignId) {
    campaignCopyId = (await tx.ispyEmail.findFirst({ where: { campaignId: input.campaignId, copyId: { not: null }, feed: input.feed }, select: { copyId: true } }))?.copyId ?? null;
  }
  const match = matchCopy(fp, candidates, campaignCopyId);
  if (match) return { copyId: match.id, newCopy: false, how: match.how, similarity: match.similarity };
  const copy = await tx.ispyCopy.create({
    data: {
      feed: input.feed,
      copyHash: fp.hash,
      simhash: fp.simhash,
      band0: fp.bands[0],
      band1: fp.bands[1],
      band2: fp.bands[2],
      band3: fp.bands[3],
      normalized: fp.normalized.slice(0, 60_000),
      title: input.subject.slice(0, 300) || "(no subject)",
      firstSeenAt: input.receivedAt,
      lastSeenAt: input.receivedAt,
      firstSeenKind: input.sendKind,
      extractionStatus: "QUEUED",
    },
    select: { id: true },
  });
  return { copyId: copy.id, newCopy: true, how: "new" as const, similarity: 1 };
}

/** Recount a copy's sends, lists, affiliates and subjects from its emails. */
export async function refreshCopyCounters(tx: IspyTx, copyId: string): Promise<void> {
  const sends = await tx.ispyEmail.findMany({ where: { copyId }, select: { receivedAt: true, listId: true, sendKind: true, subject: true, publisherId: true }, orderBy: { receivedAt: "asc" } });
  if (!sends.length) return;
  const first = sends[0]!;
  const last = sends[sends.length - 1]!;
  await tx.ispyCopy.update({
    where: { id: copyId },
    data: {
      sendCount: sends.length,
      listCount: new Set(sends.map((s) => s.listId).filter(Boolean)).size,
      affiliateCount: new Set(sends.filter((s) => s.sendKind === "AFFILIATE").map((s) => s.publisherId ?? s.listId)).size,
      subjectCount: new Set(sends.map((s) => s.subject.trim().toLowerCase())).size,
      firstSeenAt: first.receivedAt,
      lastSeenAt: last.receivedAt,
      firstSeenKind: first.sendKind,
    },
  });
}

/**
 * Store one incoming message: dedupe, route (and move it to its list's own inbox), read
 * the sender facts, attach it to a copy, and queue the promo scan. The AI extraction runs
 * later and only for a NEW copy (see brain.ts / extract.ts).
 */
export async function ingestMessage(message: IncomingMessage): Promise<IngestResult> {
  const prepared = prepareRaw(message.raw, message.receivedAt ?? new Date());
  if (!prepared.textBody.trim() && !prepared.htmlBody) return { status: "skipped", reason: "empty message" };
  const result = await ispyDb(
    async (tx) => {
      const existing = await tx.ispyEmail.findUnique({ where: { dedupeKey: prepared.dedupeKey }, select: { id: true } });
      if (existing) return { status: "duplicate" as const, emailId: existing.id };
      const inbox = await tx.ispyInbox.findUnique({ where: { id: message.inboxId }, select: { id: true, address: true, level: true, feed: true, publisherId: true, publicationId: true, listId: true, affiliateSeed: true, status: true } });
      if (!inbox) return { status: "skipped" as const, reason: "unknown inbox" };
      const registry = await loadRoutingRegistry(tx);
      const facts = routingFacts(prepared, inbox.address);
      const decision = decideRoute({ facts, subject: prepared.subject, inbox, registry });
      const publisher = registry.publishers.find((p) => p.id === decision.publisherId) ?? null;
      const sendKind = sendKindFor({ affiliateSeed: inbox.affiliateSeed, publisherType: publisher?.type ?? null, ruleAction: decision.action });
      const sender = senderFacts(prepared.headers);
      const feed = publisher?.feed ?? inbox.feed;
      const copy = await attachCopy(tx, { feed, text: prepared.textBody, subject: prepared.subject, receivedAt: prepared.receivedAt, listId: decision.listId, sendKind, campaignId: sender.campaignId, publisherId: decision.publisherId });
      const movedTo = decision.listId ? registry.listInboxByListId.get(decision.listId) ?? null : null;
      const email = await tx.ispyEmail.create({
        data: {
          feed,
          dedupeKey: prepared.dedupeKey,
          inboxId: movedTo ?? inbox.id,
          receivedInboxId: inbox.id,
          providerMessageId: message.providerMessageId ?? null,
          publisherId: decision.publisherId,
          publicationId: decision.publicationId,
          listId: decision.listId,
          routedByRuleId: decision.ruleId,
          routeStatus: decision.status,
          routeReason: movedTo && movedTo !== inbox.id ? `${decision.reason} Moved to the list's own inbox.` : decision.reason,
          sendKind,
          subject: prepared.subject,
          fromName: prepared.fromName,
          fromAddress: prepared.fromAddress,
          toAddress: prepared.toAddress,
          receivedAt: prepared.receivedAt,
          htmlBody: prepared.htmlBody,
          textBody: prepared.textBody,
          snippet: prepared.snippet,
          links: prepared.links as unknown as Prisma.InputJsonValue,
          placement: message.placement ?? null,
          rawSize: message.raw.byteLength,
          providerMeta: (message.providerMeta ?? undefined) as Prisma.InputJsonValue | undefined,
          headers: trimHeaders(prepared.headers) as Prisma.InputJsonValue,
          espName: sender.espName,
          campaignId: sender.campaignId,
          listIdHeader: sender.listIdHeader,
          authResults: (sender.authResults ?? message.authResults ?? undefined) as Prisma.InputJsonValue | undefined,
          sendingIp: sender.sendingIp,
          spamScore: message.spamScore ?? null,
          copyId: copy.copyId,
          copyMatch: copy.how,
          promoScanStatus: decision.status === "IGNORED" ? "NONE" : "PENDING",
        },
        select: { id: true },
      });
      if (decision.ruleId) await tx.ispyRoutingRule.update({ where: { id: decision.ruleId }, data: { hits: { increment: 1 }, lastHitAt: new Date() } });
      await upsertCandidate(tx, decision, email.id, facts, registry);
      await tx.ispyInbox.update({ where: { id: inbox.id }, data: { lastMessageAt: prepared.receivedAt > new Date() ? new Date() : prepared.receivedAt, ...(inboxStatusAfterMail(inbox) ? { status: "ACTIVE" } : {}) } });
      await refreshCopyCounters(tx, copy.copyId);
      return { status: "added" as const, emailId: email.id, copyId: copy.copyId, newCopy: copy.newCopy };
    },
    { timeout: 60_000 },
  );
  if (result.status === "added") {
    const key = await storeRaw(result.emailId, message.raw);
    if (key) await ispyDb((tx) => tx.ispyEmail.update({ where: { id: result.emailId }, data: { rawKey: key } }));
  }
  return result;
}

function inboxStatusAfterMail(inbox: InboxRow & { status?: string }): boolean {
  return inbox.status === "PENDING_SIGNUP" || inbox.status === "SILENT";
}

/** Keep the headers rules and deliverability use, capped in size. */
export function trimHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (count >= 60) break;
    if (/^(content-|mime-version|x-google-|x-gm-|arc-seal|arc-message-signature)/i.test(name)) continue;
    out[name] = value.slice(0, 1000);
    count += 1;
  }
  return out;
}
