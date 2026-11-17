import { timingSafeEqual } from "node:crypto";
import { providersFromEnv } from "@/features/domains/access";
import { organizationsWithDomains, recheckDue } from "@/features/domains/service";

/**
 * Background re-check of every custom domain that is due (see RECHECK_AFTER_MS).
 * For a scheduler (Railway cron, GitHub Actions…):
 *   POST /api/domains/recheck   Authorization: Bearer $DOMAINS_CRON_SECRET
 * Without DOMAINS_CRON_SECRET the route is off; domains are still re-checked
 * whenever someone opens Settings → Domains.
 */
export async function POST(request: Request) {
  const secret = process.env.DOMAINS_CRON_SECRET?.trim() ?? "";
  if (secret.length < 16) return Response.json({ ok: false, error: "DOMAINS_CRON_SECRET is not set" }, { status: 503 });
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ ok: false }, { status: 401 });
  const providers = providersFromEnv();
  if (!providers.railway) return Response.json({ ok: false, error: "Railway is not configured" }, { status: 503 });
  let checked = 0;
  for (const organizationId of await organizationsWithDomains()) {
    checked += await recheckDue(providers, organizationId).catch(() => 0);
  }
  return Response.json({ ok: true, checked });
}
