import type { Prisma } from "@pubcommand/db";
import {
  canonListName,
  isOneOf,
  LIST_CATEGORIES,
  mastheadSignals,
  mastheadText,
  parseConditions,
  previewRule,
  type RoutingFacts,
  type RuleAction,
  type RuleCondition,
} from "../../../../../modules/ispy/index";
import { processCopies } from "./brain";
import { ispyDb, type IspyTx } from "./db";
import { decideRoute, loadRoutingRegistry, refreshCopyCounters } from "./ingest";
import { blockPromo, mergePromos } from "./promos";
import { createMachineMailInbox, localPartFor, machineMailConfig, MachineMailError } from "./providers/machinemail";

/** The domain for inboxes created without MachineMail (the generic inbound route). */
export function inboxDomain(): string | null {
  return process.env.ISPY_INBOX_DOMAIN?.trim() || machineMailConfig()?.domain || null;
}

/** Facts for a stored email, for routing previews and re-routes. */
export function storedFacts(email: { fromAddress: string; fromName: string | null; subject: string; textBody: string; htmlBody: string | null; headers: unknown; listIdHeader: string | null; campaignId: string | null }, inboxAddress: string | null): RoutingFacts {
  const headers = (email.headers && typeof email.headers === "object" ? email.headers : {}) as Record<string, string>;
  return {
    fromAddress: email.fromAddress.toLowerCase(),
    fromName: email.fromName,
    subject: email.subject,
    masthead: mastheadFor(email),
    listIdHeader: email.listIdHeader,
    headers,
    body: email.textBody,
    inboxAddress,
    campaignId: email.campaignId,
  };
}

/** The masthead text, rebuilt exactly as ingest does. */
function mastheadFor(email: { htmlBody: string | null; subject: string; textBody: string }): string {
  return mastheadText(email.textBody, mastheadSignals(email.htmlBody, email.subject));
}

export type NewInbox = { level: "PUBLISHER_CATCHALL" | "PUBLICATION" | "LIST"; publisherId?: string | null; publicationId?: string | null; listId?: string | null; name: string; feed: string; affiliateSeed?: boolean };

/**
 * Create one inbox. With MachineMail configured it creates a real MachineMail inbox;
 * otherwise it reserves an address on ISPY_INBOX_DOMAIN for the generic inbound route.
 * Returns an error string the console shows.
 */
export async function createInbox(input: NewInbox): Promise<{ id: string; address: string } | { error: string }> {
  const config = machineMailConfig();
  const base = localPartFor(input.name);
  let address: string | null = null;
  let externalId: string | null = null;
  let provider: "MACHINEMAIL" | "MANUAL" = "MANUAL";
  const taken = async (local: string, domain: string) => (await ispyDb((tx) => tx.ispyInbox.count({ where: { address: `${local}@${domain}` } }))) > 0;
  if (config) {
    const domain = config.domain ?? "machinemail.dev";
    for (let n = 1; n <= 20 && !address; n += 1) {
      const local = n === 1 ? base : `${base}-${n}`;
      if (await taken(local, domain)) continue;
      try {
        const created = await createMachineMailInbox(config, local, input.name);
        address = created.address;
        externalId = created.id;
        provider = "MACHINEMAIL";
      } catch (error) {
        if (error instanceof MachineMailError && error.status === 409) continue;
        return { error: `MachineMail did not create the inbox: ${error instanceof Error ? error.message : "unknown error"}` };
      }
    }
    if (!address) return { error: "MachineMail had no free address for that name. Try a different name." };
  } else {
    const domain = inboxDomain();
    if (!domain) return { error: "Set MACHINEMAIL_API_KEY (or ISPY_INBOX_DOMAIN for the generic inbound route) before creating inboxes." };
    let local = base;
    for (let n = 2; await taken(local, domain); n += 1) local = `${base}-${n}`;
    address = `${local}@${domain}`.toLowerCase();
  }
  const row = await ispyDb((tx) =>
    tx.ispyInbox.create({
      data: {
        provider,
        level: input.level,
        address,
        externalId,
        feed: input.feed,
        publisherId: input.publisherId ?? null,
        publicationId: input.publicationId ?? null,
        listId: input.listId ?? null,
        affiliateSeed: input.affiliateSeed ?? false,
        status: "PENDING_SIGNUP",
      },
      select: { id: true, address: true },
    }),
  );
  return row;
}

/** Re-apply routing to emails (all, or one publisher/publication's). Returns how many moved. */
export async function rerouteEmails(scope: { publisherId?: string | null; publicationId?: string | null; limit?: number }): Promise<{ checked: number; moved: number }> {
  const touchedCopies = new Set<string>();
  const result = await ispyDb(
    async (tx) => {
      const registry = await loadRoutingRegistry(tx);
      const where: Prisma.IspyEmailWhereInput = {
        ...(scope.publicationId ? { OR: [{ publicationId: scope.publicationId }, { receivedInbox: { publicationId: scope.publicationId } }] } : {}),
        ...(scope.publisherId ? { OR: [{ publisherId: scope.publisherId }, { receivedInbox: { publisherId: scope.publisherId } }] } : {}),
        routeStatus: { in: ["ROUTED", "UNSORTED", "CANDIDATE"] },
      };
      const emails = await tx.ispyEmail.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        take: scope.limit ?? 2000,
        select: {
          id: true, listId: true, copyId: true, fromAddress: true, fromName: true, subject: true, textBody: true, htmlBody: true, headers: true, listIdHeader: true, campaignId: true, routedByRuleId: true,
          receivedInbox: { select: { id: true, address: true, level: true, feed: true, publisherId: true, publicationId: true, listId: true, affiliateSeed: true } },
        },
      });
      let moved = 0;
      for (const e of emails) {
        if (!e.receivedInbox) continue;
        const decision = decideRoute({ facts: storedFacts(e, e.receivedInbox.address), subject: e.subject, inbox: e.receivedInbox, registry });
        if (decision.status === "CANDIDATE" || decision.listId === e.listId) continue;
        if (decision.status === "UNSORTED" && e.listId) continue;
        const movedTo = decision.listId ? registry.listInboxByListId.get(decision.listId) ?? null : null;
        await tx.ispyEmail.update({
          where: { id: e.id },
          data: { listId: decision.listId, publicationId: decision.publicationId, publisherId: decision.publisherId, routedByRuleId: decision.ruleId, routeStatus: decision.status, routeReason: `${decision.reason} (re-routed)`, ...(movedTo ? { inboxId: movedTo } : {}) },
        });
        if (decision.ruleId && decision.ruleId !== e.routedByRuleId) await tx.ispyRoutingRule.update({ where: { id: decision.ruleId }, data: { hits: { increment: 1 }, lastHitAt: new Date() } });
        if (e.copyId) touchedCopies.add(e.copyId);
        moved += 1;
      }
      for (const id of touchedCopies) await refreshCopyCounters(tx, id);
      return { checked: emails.length, moved };
    },
    { timeout: 120_000 },
  );
  if (touchedCopies.size) await processCopies([...touchedCopies], { extract: false });
  return result;
}

/** What a rule would do to the last 200 emails of its scope. Changes nothing. */
export async function previewRuleOnRecent(input: { conditions: RuleCondition[]; action: RuleAction; listId: string | null; publisherId: string | null; publicationId: string | null }) {
  const emails = await ispyDb((tx) =>
    tx.ispyEmail.findMany({
      where: input.publicationId ? { OR: [{ publicationId: input.publicationId }, { receivedInbox: { publicationId: input.publicationId } }] } : input.publisherId ? { OR: [{ publisherId: input.publisherId }, { receivedInbox: { publisherId: input.publisherId } }] } : {},
      orderBy: { receivedAt: "desc" },
      take: 200,
      select: { id: true, listId: true, subject: true, receivedAt: true, fromAddress: true, fromName: true, textBody: true, htmlBody: true, headers: true, listIdHeader: true, campaignId: true, list: { select: { name: true } }, receivedInbox: { select: { address: true } } },
    }),
  );
  const rows = emails.map((e) => ({ ...e, facts: storedFacts(e, e.receivedInbox?.address ?? null) }));
  const { matched, wouldMove } = previewRule({ conditions: input.conditions, listId: input.listId, action: input.action }, rows);
  const show = (e: (typeof rows)[number]) => ({ id: e.id, subject: e.subject, receivedAt: e.receivedAt, list: e.list?.name ?? null });
  return { checked: rows.length, matched: matched.length, wouldMove: wouldMove.map(show).slice(0, 25), wouldMoveCount: wouldMove.length };
}

async function nextPriority(tx: IspyTx, scope: { publisherId: string | null; publicationId: string | null }): Promise<number> {
  const last = await tx.ispyRoutingRule.findFirst({ where: { publisherId: scope.publisherId, publicationId: scope.publicationId }, orderBy: { priority: "desc" }, select: { priority: true } });
  return (last?.priority ?? 0) + 10;
}

/**
 * Approve a candidate: create the list (with the type staff chose), its routing rule
 * and (optionally) its own inbox, then move the waiting mail.
 */
export async function approveCandidate(input: { candidateId: string; name: string; category: string; conditions: unknown; actorId: string; createListInbox: boolean }): Promise<{ listId: string; moved: number; inbox: string | null; inboxError: string | null } | { error: string }> {
  const conditions = parseConditions(input.conditions);
  if (!conditions.length) return { error: "Add at least one routing condition." };
  if (!isOneOf(LIST_CATEGORIES, input.category)) return { error: "Pick a list type." };
  const name = input.name.trim().slice(0, 120);
  if (!name) return { error: "Give the list a name." };
  const created = await ispyDb(async (tx) => {
    const c = await tx.ispyListCandidate.findUnique({ where: { id: input.candidateId } });
    if (!c || c.status !== "PENDING") return { error: "That candidate was already decided." } as const;
    if (!c.publisherId) return { error: "Assign a publisher first." } as const;
    const publisher = await tx.ispyPublisher.findUnique({ where: { id: c.publisherId }, select: { feed: true } });
    const list = await tx.ispyList.create({ data: { name, category: input.category, publisherId: c.publisherId, publicationId: c.publicationId, synonyms: canonListName(c.proposedName) !== canonListName(name) ? [c.proposedName] : [] }, select: { id: true } });
    await tx.ispyRoutingRule.create({
      data: { publisherId: c.publisherId, publicationId: c.publicationId, priority: await nextPriority(tx, c), conditions: conditions as unknown as Prisma.InputJsonValue, action: "ROUTE", listId: list.id, origin: "CANDIDATE", createdById: input.actorId },
    });
    await tx.ispyListCandidate.update({ where: { id: c.id }, data: { status: "APPROVED", decidedById: input.actorId, decidedAt: new Date(), resultListId: list.id } });
    return { listId: list.id, publisherId: c.publisherId, publicationId: c.publicationId, feed: publisher?.feed ?? "FINPUB" } as const;
  });
  if ("error" in created) return { error: created.error ?? "Could not approve." };
  let inbox: string | null = null;
  let inboxError: string | null = null;
  if (input.createListInbox) {
    const made = await createInbox({ level: "LIST", publisherId: created.publisherId, publicationId: created.publicationId, listId: created.listId, name, feed: created.feed });
    if ("error" in made) inboxError = made.error;
    else inbox = made.address;
  }
  const { moved } = await rerouteEmails({ publisherId: created.publisherId, publicationId: created.publicationId });
  return { listId: created.listId, moved, inbox, inboxError };
}

/** Merge a candidate into an existing list: add its name as a synonym and a rule. */
export async function mergeCandidate(input: { candidateId: string; listId: string; conditions: unknown; actorId: string }): Promise<{ moved: number } | { error: string }> {
  const conditions = parseConditions(input.conditions);
  const done = await ispyDb(async (tx) => {
    const c = await tx.ispyListCandidate.findUnique({ where: { id: input.candidateId } });
    const list = await tx.ispyList.findUnique({ where: { id: input.listId }, select: { id: true, synonyms: true, publisherId: true, publicationId: true } });
    if (!c || c.status !== "PENDING" || !list) return { error: "That candidate or list no longer exists." } as const;
    if (!list.synonyms.some((s) => canonListName(s) === canonListName(c.proposedName))) await tx.ispyList.update({ where: { id: list.id }, data: { synonyms: [...list.synonyms, c.proposedName] } });
    if (conditions.length) {
      await tx.ispyRoutingRule.create({ data: { publisherId: list.publisherId, publicationId: list.publicationId, priority: await nextPriority(tx, list), conditions: conditions as unknown as Prisma.InputJsonValue, action: "ROUTE", listId: list.id, origin: "CANDIDATE", createdById: input.actorId } });
    }
    await tx.ispyListCandidate.update({ where: { id: c.id }, data: { status: "MERGED", decidedById: input.actorId, decidedAt: new Date(), resultListId: list.id } });
    return { publisherId: list.publisherId, publicationId: list.publicationId } as const;
  });
  if ("error" in done) return { error: done.error ?? "Could not merge." };
  return { moved: (await rerouteEmails(done)).moved };
}

export async function rejectCandidate(candidateId: string, actorId: string): Promise<void> {
  await ispyDb((tx) => tx.ispyListCandidate.updateMany({ where: { id: candidateId, status: "PENDING" }, data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date() } }));
}

/** Apply a report: not a promo → block it; duplicate → merge into the chosen one. */
export async function applyReport(reportId: string, actorId: string): Promise<{ ok: true } | { error: string }> {
  const report = await ispyDb((tx) => tx.ispyReport.findUnique({ where: { id: reportId } }));
  if (!report || report.status !== "OPEN") return { error: "That report was already handled." };
  const promoIdFor = async (type: string, id: string): Promise<string | null> => {
    if (type === "PROMO") return id;
    if (type === "COPY") return (await ispyDb((tx) => tx.ispyCopy.findUnique({ where: { id }, select: { promoId: true } })))?.promoId ?? null;
    return (await ispyDb((tx) => tx.ispyEmail.findUnique({ where: { id }, select: { promoId: true } })))?.promoId ?? null;
  };
  if (report.kind === "NOT_A_PROMO") {
    const promoId = await promoIdFor(report.targetType, report.targetId);
    if (!promoId) return { error: "That item has no promo to remove." };
    await blockPromo(promoId, actorId);
  } else {
    if (!report.duplicateOfId) return { error: "Pick what it duplicates." };
    if (report.targetType === "COPY") await mergeCopies(report.targetId, report.duplicateOfId);
    else {
      const from = await promoIdFor(report.targetType, report.targetId);
      if (!from) return { error: "That item has no promo to merge." };
      await mergePromos(from, report.duplicateOfId);
    }
  }
  await ispyDb((tx) => tx.ispyReport.update({ where: { id: reportId }, data: { status: "APPLIED", decidedById: actorId, decidedAt: new Date() } }));
  return { ok: true };
}

/** Merge copy `fromId` into `intoId`: its sends move, and the note is rewritten. */
export async function mergeCopies(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  await ispyDb(async (tx) => {
    await tx.ispyEmail.updateMany({ where: { copyId: fromId }, data: { copyId: intoId, copyMatch: "merged" } });
    await tx.ispyCopy.update({ where: { id: fromId }, data: { mergedIntoId: intoId, sendCount: 0 } });
    await refreshCopyCounters(tx, intoId);
  });
  await processCopies([intoId], { extract: false });
}

/** Provision ISpy for a publication an org created in Publication Setup (orgs with ISpy only). */
export async function provisionFromPublicationSetup(input: { organizationId: string; brandId: string; calendarPublicationId: string; name: string; niche: string | null }): Promise<{ publicationId: string; inbox: string | null } | null> {
  const feed = (input.niche ?? "").toLowerCase() === "health" ? "HEALTH" : "FINPUB";
  const made = await ispyDb(async (tx) => {
    const existing = await tx.ispyPublication.findUnique({ where: { linkedCalendarPublicationId: input.calendarPublicationId }, select: { id: true } });
    if (existing) return null;
    let publisher = await tx.ispyPublisher.findFirst({ where: { linkedOrganizationId: input.organizationId, linkedBrandId: input.brandId, deletedAt: null }, select: { id: true } });
    if (!publisher) {
      const brand = await tx.brand.findUnique({ where: { id: input.brandId }, select: { name: true } });
      publisher = await tx.ispyPublisher.create({ data: { name: brand?.name ?? input.name, type: "INTERNAL", feed, linkedOrganizationId: input.organizationId, linkedBrandId: input.brandId, isConfirmed: true }, select: { id: true } });
    }
    const publication = await tx.ispyPublication.create({ data: { publisherId: publisher.id, name: input.name, linkedBrandId: input.brandId, linkedOrganizationId: input.organizationId, linkedCalendarPublicationId: input.calendarPublicationId }, select: { id: true } });
    return { publicationId: publication.id, publisherId: publisher.id };
  });
  if (!made) return null;
  const inbox = await createInbox({ level: "PUBLICATION", publisherId: made.publisherId, publicationId: made.publicationId, name: input.name, feed });
  return { publicationId: made.publicationId, inbox: "error" in inbox ? null : inbox.address };
}
