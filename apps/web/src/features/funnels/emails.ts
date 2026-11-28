import { tenantDb } from "@pubcommand/db";
import { createHmac } from "node:crypto";

/**
 * Funnels do not send invites or reminders (teams paste the funnel's links from
 * the Links tab into their own email tool). This keeps the one-click unsubscribe
 * links in emails sent before working: they still mark the opt-in unsubscribed,
 * which the opt-in CSV shows.
 */

/** The unsubscribe signing key, derived from AUTH_SECRET (never AUTH_SECRET itself). */
export function unsubscribeSecret(): string {
  const base = process.env.FUNNELS_COOKIE_SECRET || process.env.AUTH_SECRET || "";
  return base ? createHmac("sha256", base).update("pubcommand:funnels:unsubscribe:v1").digest("base64url") : "";
}

/** Mark an opt-in unsubscribed (idempotent). */
export async function unsubscribeOptin(organizationId: string, funnelId: string, optinId: string): Promise<boolean> {
  const updated = await tenantDb(organizationId).funnelOptin.updateMany({ where: { id: optinId, funnelId, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  return updated.count > 0;
}
