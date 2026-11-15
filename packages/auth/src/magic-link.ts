import { createHash, randomBytes } from "node:crypto";

export type MagicLinkRecord = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export interface MagicLinkStore {
  save(record: MagicLinkRecord): Promise<void>;
  consume(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
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
): Promise<{ token: string; expiresAt: Date }> {
  const token = createMagicLinkToken();
  const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
  await store.save({ userId, tokenHash: hashMagicLinkToken(token), expiresAt });
  return { token, expiresAt };
}

export async function consumeMagicLink(
  store: MagicLinkStore,
  token: string,
  now = new Date(),
): Promise<{ userId: string } | null> {
  if (!token) return null;
  return store.consume(hashMagicLinkToken(token), now);
}
