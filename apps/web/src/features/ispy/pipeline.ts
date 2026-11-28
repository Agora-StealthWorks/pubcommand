import { processCopies, staleCopyIds } from "./brain";
import { ispyDb } from "./db";
import { ingestMessage, type IncomingMessage } from "./ingest";
import { scanEmailPromo } from "./promos";
import { legacyGmailInboxIds, syncIspyGmail } from "./providers/gmail";
import { resolveInboxForAddress } from "./inboxes";
import { listMachineMailInboxes, listMachineMailMessages, machineMailConfig, providerExtras, rawMachineMailMessage } from "./providers/machinemail";

/**
 * After new mail is stored: find each email's promo (re-sends of a known copy reuse
 * it), then extract each NEW copy once, decide its type and write its Brain note.
 */
export async function afterIngest(emailIds: readonly string[], copyIds: readonly string[]): Promise<{ promos: number; extracted: number }> {
  let promos = 0;
  for (const id of emailIds) if ((await scanEmailPromo(id).catch(() => "FAILED")) === "DONE") promos += 1;
  const { extracted } = await processCopies(copyIds);
  return { promos, extracted };
}

/** Ingest a batch of raw messages and process them. */
export async function ingestAndProcess(messages: readonly IncomingMessage[]) {
  const emailIds: string[] = [];
  const copyIds: string[] = [];
  let duplicates = 0;
  for (const message of messages) {
    const result = await ingestMessage(message);
    if (result.status === "added") {
      emailIds.push(result.emailId);
      copyIds.push(result.copyId);
    } else if (result.status === "duplicate") duplicates += 1;
  }
  const after = emailIds.length ? await afterIngest(emailIds, copyIds) : { promos: 0, extracted: 0 };
  return { added: emailIds.length, duplicates, ...after };
}

/** Poll every MachineMail inbox (the webhook is the fast path; this catches anything missed). */
export async function pollMachineMail(): Promise<{ inboxes: number; added: number; skipped?: string }> {
  const config = machineMailConfig();
  if (!config) return { inboxes: 0, added: 0, skipped: "MACHINEMAIL_API_KEY is not set" };
  // Catch-all inboxes appear in MachineMail on first mail: adopt the ones under a known catch-all.
  for (const address of await listMachineMailInboxes(config).catch(() => [] as string[])) await resolveInboxForAddress(address);
  const inboxes = await ispyDb((tx) => tx.ispyInbox.findMany({ where: { provider: "MACHINEMAIL", status: { notIn: ["RETIRED"] } }, select: { id: true, address: true, externalId: true, lastSyncAt: true } }));
  let added = 0;
  for (const inbox of inboxes) {
    const mailbox = inbox.externalId ?? inbox.address;
    try {
      const since = inbox.lastSyncAt ? new Date(inbox.lastSyncAt.getTime() - 3600_000) : null;
      const messages = await listMachineMailMessages(config, mailbox, since);
      const known = new Set((await ispyDb((tx) => tx.ispyEmail.findMany({ where: { providerMessageId: { in: messages.map((m) => m.id) } }, select: { providerMessageId: true } }))).map((r) => r.providerMessageId));
      const batch: IncomingMessage[] = [];
      for (const m of messages.filter((x) => !known.has(x.id)).slice(0, 200)) {
        const extras = providerExtras(m.meta);
        batch.push({ raw: await rawMachineMailMessage(config, mailbox, m.id), inboxId: inbox.id, providerMessageId: m.id, receivedAt: m.receivedAt, providerMeta: m.meta, spamScore: extras.spamScore, authResults: extras.auth });
      }
      added += (await ingestAndProcess(batch)).added;
      await ispyDb((tx) => tx.ispyInbox.update({ where: { id: inbox.id }, data: { lastSyncAt: new Date(), lastSyncError: null } }));
    } catch (error) {
      await ispyDb((tx) => tx.ispyInbox.update({ where: { id: inbox.id }, data: { lastSyncError: (error instanceof Error ? error.message : "poll failed").slice(0, 500) } })).catch(() => undefined);
    }
  }
  return { inboxes: inboxes.length, added };
}

export async function syncLegacyGmail(): Promise<{ inboxes: number; added: number; failed: number }> {
  let added = 0;
  let failed = 0;
  const ids = await legacyGmailInboxIds();
  for (const id of ids) {
    const out = await syncIspyGmail(id);
    if (out.error) failed += 1;
    added += out.added;
    if (out.emailIds.length) await afterIngest(out.emailIds, out.copyIds);
  }
  return { inboxes: ids.length, added, failed };
}

/** Catch-up: notes for copies that changed (new sends) and copies still waiting for extraction. */
export async function catchUpCopies(): Promise<{ refreshed: number }> {
  const stale = await staleCopyIds(200);
  const queued = (await ispyDb((tx) => tx.ispyCopy.findMany({ where: { extractionStatus: "QUEUED" }, select: { id: true }, take: 100 }))).map((r) => r.id);
  await processCopies([...new Set([...queued, ...stale])]);
  return { refreshed: stale.length + queued.length };
}

/** Mark inboxes that have gone quiet. */
export async function markSilentInboxes(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const res = await ispyDb((tx) => tx.ispyInbox.updateMany({ where: { status: "ACTIVE", lastMessageAt: { lt: cutoff } }, data: { status: "SILENT" } }));
  return res.count;
}
