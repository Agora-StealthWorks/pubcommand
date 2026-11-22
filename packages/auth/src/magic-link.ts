import { createHash, randomBytes } from "node:crypto";

/**
 * One-time email tokens. Every token has a purpose: a sign-in link ("login")
 * can never reset a password, and a reset link ("password_reset") can never
 * sign anyone in through the magic-link route. Tokens are stored hashed.
 */
export type MagicLinkPurpose = "login" | "password_reset";

export const MAGIC_LINK_TTL_MS: Record<MagicLinkPurpose, number> = {
  login: 20 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};

export type MagicLinkRecord = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  purpose: MagicLinkPurpose;
};

export type StoredMagicLink = {
  id: string;
  userId: string;
  purpose: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export interface MagicLinkStore {
  save(record: MagicLinkRecord): Promise<void>;
  find(tokenHash: string): Promise<StoredMagicLink | null>;
  /** Marks the token used. Must be atomic: true only for the one caller that consumed it. */
  markConsumed(id: string, now: Date): Promise<boolean>;
}

export function createMagicLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashMagicLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueMagicLink(
  store: MagicLinkStore,
  userId: string,
  now = new Date(),
  purpose: MagicLinkPurpose = "login",
): Promise<{ token: string; expiresAt: Date }> {
  const token = createMagicLinkToken();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS[purpose]);
  await store.save({ userId, tokenHash: hashMagicLinkToken(token), expiresAt, purpose });
  return { token, expiresAt };
}

/** The token's record when it is unused, unexpired and of this purpose; otherwise null. */
async function usable(store: MagicLinkStore, token: string, now: Date, purpose: MagicLinkPurpose) {
  if (!token) return null;
  const record = await store.find(hashMagicLinkToken(token));
  if (!record || record.purpose !== purpose || record.consumedAt || record.expiresAt <= now) return null;
  return record;
}

/** Checks a token without using it up (the reset page shows its form only for a good token). */
export async function inspectMagicLink(
  store: MagicLinkStore,
  token: string,
  now = new Date(),
  purpose: MagicLinkPurpose = "login",
): Promise<{ userId: string } | null> {
  const record = await usable(store, token, now, purpose);
  return record ? { userId: record.userId } : null;
}

export async function consumeMagicLink(
  store: MagicLinkStore,
  token: string,
  now = new Date(),
  purpose: MagicLinkPurpose = "login",
): Promise<{ userId: string } | null> {
  const record = await usable(store, token, now, purpose);
  if (!record) return null;
  if (!(await store.markConsumed(record.id, now))) return null;
  return { userId: record.userId };
}
