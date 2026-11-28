/**
 * Funnel email links. PURE.
 *
 * PubCommand no longer sends funnel invites or reminders: teams paste the
 * funnel's links (the builder's Links tab) into their own email tool. What is
 * left here signs the unsubscribe links in emails sent before, so they keep working.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** A signed unsubscribe token for one opt-in (no column needed, cannot be guessed). */
export function unsubscribeToken(optinId: string, secret: string): string {
  return createHmac("sha256", secret).update(`pubcommand:funnels:unsubscribe:${optinId}`).digest("base64url").slice(0, 32);
}

export function verifyUnsubscribeToken(optinId: string, token: string, secret: string): boolean {
  if (!secret || typeof token !== "string" || token.length !== 32) return false;
  const expected = unsubscribeToken(optinId, secret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
