import {
  decryptToken,
  encryptToken,
  gmailClient,
  placementFromLabels,
  planSync,
  refreshAccessToken,
  type FetchLike,
} from "../../../../../../modules/intel/index";
import { authSecret, gmailEnv } from "../../intel/gmail";
import { ispyDb } from "../db";
import { ingestMessage } from "../ingest";

/** The legacy iSpy Gmail inboxes (and the MarketBeat seed) until every list has its own inbox. */
export const MAX_GMAIL_PER_RUN = 200;

/** Marks an OAuth state that belongs to the ISpy console, not an org's Intel. */
export const ISPY_GMAIL_STATE_SLUG = "__ispy_console__";

const defaultFetch: FetchLike = (url, init) => fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });

export async function saveIspyGmail(input: { email: string; tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date }; feed: string }): Promise<{ id: string } | { error: string }> {
  const secret = authSecret();
  const address = input.email.trim().toLowerCase();
  return ispyDb(async (tx) => {
    const existing = await tx.ispyInbox.findUnique({ where: { address }, select: { id: true } });
    if (!input.tokens.refreshToken && !existing) return { error: "Google did not return a refresh token. Remove PubCommand from the Google account's third-party access and connect again." };
    const tokens = {
      accessTokenEnc: encryptToken(input.tokens.accessToken, secret),
      tokenExpiresAt: input.tokens.expiresAt,
      ...(input.tokens.refreshToken ? { refreshTokenEnc: encryptToken(input.tokens.refreshToken, secret) } : {}),
    };
    if (existing) {
      await tx.ispyInbox.update({ where: { id: existing.id }, data: { ...tokens, provider: "GMAIL_LEGACY", status: "ACTIVE", lastSyncError: null } });
      return { id: existing.id };
    }
    const row = await tx.ispyInbox.create({ data: { provider: "GMAIL_LEGACY", level: "LEGACY", address, feed: input.feed, status: "ACTIVE", ...tokens }, select: { id: true } });
    return row;
  });
}

async function accessToken(inbox: { id: string; refreshTokenEnc: string | null; accessTokenEnc: string | null; tokenExpiresAt: Date | null }, fetchImpl: FetchLike): Promise<string> {
  const secret = authSecret();
  if (inbox.accessTokenEnc && inbox.tokenExpiresAt && inbox.tokenExpiresAt.getTime() - Date.now() > 60_000) return decryptToken(inbox.accessTokenEnc, secret);
  if (!inbox.refreshTokenEnc) throw new Error("This inbox has no Google connection. Connect it again.");
  const env = gmailEnv();
  if (!env) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.");
  const tokens = await refreshAccessToken(fetchImpl, env, decryptToken(inbox.refreshTokenEnc, secret));
  await ispyDb((tx) =>
    tx.ispyInbox.update({
      where: { id: inbox.id },
      data: { accessTokenEnc: encryptToken(tokens.accessToken, secret), tokenExpiresAt: tokens.expiresAt, ...(tokens.refreshToken ? { refreshTokenEnc: encryptToken(tokens.refreshToken, secret) } : {}) },
    }),
  );
  return tokens.accessToken;
}

export type GmailSyncOutcome = { inboxId: string; address: string; added: number; duplicates: number; emailIds: string[]; copyIds: string[]; error: string | null };

/** Pull new mail from one legacy Gmail inbox. Never throws. */
export async function syncIspyGmail(inboxId: string, fetchImpl: FetchLike = defaultFetch): Promise<GmailSyncOutcome> {
  const inbox = await ispyDb((tx) => tx.ispyInbox.findUnique({ where: { id: inboxId } }));
  const out: GmailSyncOutcome = { inboxId, address: inbox?.address ?? "", added: 0, duplicates: 0, emailIds: [], copyIds: [], error: null };
  if (!inbox || inbox.provider !== "GMAIL_LEGACY") return { ...out, error: "Not a Gmail inbox." };
  try {
    const client = gmailClient(fetchImpl, await accessToken(inbox, fetchImpl));
    const plan = await planSync(client, { historyId: inbox.historyId, query: null, lastSyncAt: inbox.lastSyncAt, max: MAX_GMAIL_PER_RUN * 2 });
    const known = new Set(
      (await ispyDb((tx) => tx.ispyEmail.findMany({ where: { receivedInboxId: inbox.id, providerMessageId: { in: plan.ids } }, select: { providerMessageId: true } }))).map((r) => r.providerMessageId),
    );
    const fresh = plan.ids.filter((id) => !known.has(id));
    for (const id of fresh.slice(0, MAX_GMAIL_PER_RUN)) {
      const message = await client.rawMessage(id);
      const result = await ingestMessage({ raw: message.raw, inboxId: inbox.id, providerMessageId: message.id, receivedAt: message.internalDate, placement: placementFromLabels(message.labelIds), providerMeta: { provider: "gmail", labelIds: message.labelIds } });
      if (result.status === "added") {
        out.added += 1;
        out.emailIds.push(result.emailId);
        out.copyIds.push(result.copyId);
      } else if (result.status === "duplicate") out.duplicates += 1;
    }
    const complete = fresh.length <= MAX_GMAIL_PER_RUN;
    await ispyDb((tx) => tx.ispyInbox.update({ where: { id: inbox.id }, data: { lastSyncAt: new Date(), lastSyncError: null, ...(complete ? { historyId: plan.historyId } : {}) } }));
    return out;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The Gmail sync failed.";
    await ispyDb((tx) => tx.ispyInbox.update({ where: { id: inboxId }, data: { lastSyncError: reason.slice(0, 500) } })).catch(() => undefined);
    return { ...out, error: reason };
  }
}

export async function legacyGmailInboxIds(): Promise<string[]> {
  return (await ispyDb((tx) => tx.ispyInbox.findMany({ where: { provider: "GMAIL_LEGACY", status: { not: "RETIRED" }, refreshTokenEnc: { not: null } }, select: { id: true } }))).map((r) => r.id);
}
