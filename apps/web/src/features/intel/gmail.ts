import { buildSiteUrl } from "@pubcommand/core";
import { appendOrgAudit, organizationsWithModule, rawPrisma, tenantDb } from "@pubcommand/db";
import {
  GMAIL_CALLBACK_PATH,
  decryptToken,
  encryptToken,
  gmailClient,
  googleEnv,
  placementFromLabels,
  planSync,
  prepareRaw,
  refreshAccessToken,
  type FetchLike,
} from "../../../../../modules/intel/index";
import { rootDomain } from "@/lib/auth";
import type { IntelBrand } from "./context";
import { STALE_RUN_MS, storeEmails } from "./server";

/** At most this many new messages per inbox per run; the next run picks up the rest. */
export const MAX_MESSAGES_PER_SYNC = 150;

export function authSecret(): string {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return value;
}

export function gmailEnv() {
  return googleEnv(process.env);
}

/**
 * The one redirect URL registered with Google. It lives on the app host
 * (https://app.<ROOT_DOMAIN>/api/intel/gmail/callback), so every organization's
 * subdomain shares it. INTEL_GOOGLE_REDIRECT_URI overrides it.
 */
export function gmailRedirectUri(requestHost: string): string {
  const override = process.env.INTEL_GOOGLE_REDIRECT_URI?.trim();
  if (override) return override;
  return buildSiteUrl({ rootDomain: rootDomain(), requestHost, site: { kind: "app" }, pathname: GMAIL_CALLBACK_PATH });
}

const defaultFetch: FetchLike = (url, init) => fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });

async function accessTokenFor(
  account: { id: string; organizationId: string; refreshTokenEnc: string; accessTokenEnc: string | null; tokenExpiresAt: Date | null },
  fetchImpl: FetchLike,
): Promise<string> {
  const secret = authSecret();
  if (account.accessTokenEnc && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() > 60_000) {
    return decryptToken(account.accessTokenEnc, secret);
  }
  const env = gmailEnv();
  if (!env) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.");
  const tokens = await refreshAccessToken(fetchImpl, env, decryptToken(account.refreshTokenEnc, secret));
  await tenantDb(account.organizationId).intelGmailAccount.updateMany({
    where: { id: account.id },
    data: {
      accessTokenEnc: encryptToken(tokens.accessToken, secret),
      tokenExpiresAt: tokens.expiresAt,
      ...(tokens.refreshToken ? { refreshTokenEnc: encryptToken(tokens.refreshToken, secret) } : {}),
    },
  });
  return tokens.accessToken;
}

export type SyncOutcome = { accountId: string; email: string; added: number; duplicates: number; error: string | null; skipped?: string };

/** Pull new mail from one connected inbox into its brand's Intel inbox. Never throws. */
export async function syncGmailAccount(input: { organizationId: string; accountId: string; actorId: string | null; fetchImpl?: FetchLike }): Promise<SyncOutcome> {
  const db = tenantDb(input.organizationId);
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const account = await db.intelGmailAccount.findFirst({ where: { id: input.accountId } });
  if (!account) return { accountId: input.accountId, email: "", added: 0, duplicates: 0, error: "That inbox is not connected." };
  // Claim the inbox; a run stuck longer than STALE_RUN_MS is taken over.
  const claimed = await db.intelGmailAccount.updateMany({
    where: { id: account.id, OR: [{ syncStatus: "IDLE" }, { updatedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } }] },
    data: { syncStatus: "RUNNING" },
  });
  if (!claimed.count) return { accountId: account.id, email: account.email, added: 0, duplicates: 0, error: null, skipped: "already syncing" };
  try {
    const token = await accessTokenFor(account, fetchImpl);
    const client = gmailClient(fetchImpl, token);
    const plan = await planSync(client, { historyId: account.historyId, query: account.query, lastSyncAt: account.lastSyncAt, max: MAX_MESSAGES_PER_SYNC * 2 });
    const known = plan.ids.length
      ? new Set(
          (await db.intelEmail.findMany({ where: { brandId: account.brandId, gmailMessageId: { in: plan.ids } }, select: { gmailMessageId: true } })).map((row) => row.gmailMessageId),
        )
      : new Set<string | null>();
    const fresh = plan.ids.filter((id) => !known.has(id)).slice(0, MAX_MESSAGES_PER_SYNC);
    let added = 0;
    let duplicates = 0;
    for (const id of fresh) {
      const message = await client.rawMessage(id);
      const prepared = prepareRaw(message.raw, message.internalDate ?? new Date());
      const stored = await storeEmails({
        organizationId: input.organizationId,
        brandId: account.brandId,
        actorId: input.actorId,
        source: "gmail",
        gmailAccountId: account.id,
        emails: [{ ...prepared, gmailMessageId: message.id, placement: placementFromLabels(message.labelIds) }],
      });
      added += stored.added;
      duplicates += stored.duplicates;
    }
    // Only advance the history pointer once everything planned was fetched.
    const complete = fresh.length === plan.ids.filter((id) => !known.has(id)).length;
    await db.intelGmailAccount.updateMany({
      where: { id: account.id },
      data: {
        syncStatus: "IDLE",
        lastSyncAt: new Date(),
        lastSyncError: null,
        lastSyncAdded: added,
        ...(complete ? { historyId: plan.historyId } : {}),
      },
    });
    return { accountId: account.id, email: account.email, added, duplicates, error: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The Gmail sync failed.";
    await db.intelGmailAccount.updateMany({ where: { id: account.id }, data: { syncStatus: "IDLE", lastSyncError: reason.slice(0, 500) } }).catch(() => undefined);
    return { accountId: account.id, email: account.email, added: 0, duplicates: 0, error: reason };
  }
}

/** Every connected inbox across organizations (for the cron route). Ids only. */
export async function allGmailAccounts(): Promise<{ id: string; organizationId: string; brandId: string }[]> {
  const rows = await rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return tx.intelGmailAccount.findMany({ select: { id: true, organizationId: true, brandId: true }, orderBy: { createdAt: "asc" } });
  });
  return withIntel(rows);
}

/** Keep only rows whose organization has Intel on (not blocked, deleted or suspended). */
export async function withIntel<T extends { organizationId: string }>(rows: T[]): Promise<T[]> {
  const on = await organizationsWithModule(rows.map((row) => row.organizationId), "intel");
  return rows.filter((row) => on.has(row.organizationId));
}

/** Brands with competitor email in a window (for the weekly radar cron). */
export async function brandsWithEmailSince(since: Date): Promise<{ organizationId: string; brandId: string }[]> {
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    const rows = await tx.intelEmail.groupBy({ by: ["organizationId", "brandId"], where: { receivedAt: { gte: since }, deletedAt: null } });
    return rows.map((row) => ({ organizationId: row.organizationId, brandId: row.brandId }));
  }).then(withIntel);
}

export async function loadBrand(organizationId: string, brandId: string): Promise<IntelBrand | null> {
  return tenantDb(organizationId).brand.findFirst({ where: { id: brandId }, select: { id: true, name: true, niche: true, audience: true, complianceNotes: true } });
}

/** Save a newly authorized inbox (or refresh its tokens on a reconnect). */
export async function saveGmailConnection(input: {
  organizationId: string;
  brandId: string;
  actorId: string;
  email: string;
  historyId: string | null;
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date };
}): Promise<{ id: string } | { error: string }> {
  const secret = authSecret();
  const db = tenantDb(input.organizationId);
  const email = input.email.trim().toLowerCase();
  const existing = await db.intelGmailAccount.findFirst({ where: { brandId: input.brandId, email }, select: { id: true } });
  if (!input.tokens.refreshToken && !existing) {
    return { error: "Google did not return a refresh token. Remove PubCommand from your Google account's third-party access and connect again." };
  }
  const tokenData = {
    accessTokenEnc: encryptToken(input.tokens.accessToken, secret),
    tokenExpiresAt: input.tokens.expiresAt,
    ...(input.tokens.refreshToken ? { refreshTokenEnc: encryptToken(input.tokens.refreshToken, secret) } : {}),
  };
  if (existing) {
    await db.intelGmailAccount.updateMany({ where: { id: existing.id }, data: { ...tokenData, lastSyncError: null, syncStatus: "IDLE" } });
    await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "intel.gmail.reconnected", targetType: "intel_gmail_account", targetId: existing.id });
    return { id: existing.id };
  }
  const row = await db.intelGmailAccount.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brandId,
      email,
      refreshTokenEnc: encryptToken(input.tokens.refreshToken!, secret),
      accessTokenEnc: tokenData.accessTokenEnc,
      tokenExpiresAt: tokenData.tokenExpiresAt,
      historyId: null,
      connectedById: input.actorId,
    },
    select: { id: true },
  });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "intel.gmail.connected", targetType: "intel_gmail_account", targetId: row.id });
  return row;
}
