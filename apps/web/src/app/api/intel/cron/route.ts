import { aiConfigured } from "@pubcommand/ai";
import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { allGmailAccounts, brandsWithEmailSince, gmailEnv, loadBrand, syncGmailAccount, type SyncOutcome } from "@/features/intel/gmail";
import { buildRadarDigest, drainExtractions, runRadarNarrative } from "@/features/intel/server";
import { isoDay, weekStartOf } from "../../../../../../../modules/intel/index";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.INTEL_CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : (request.headers.get("x-cron-secret") ?? "");
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Scheduled jobs for Intel, protected by INTEL_CRON_SECRET.
 * - ?job=sync (default): pull new mail from every connected Gmail inbox, then extract it.
 * - ?job=radar: build last week's Promo Radar for every brand that received competitor mail.
 * - ?job=all: both.
 */
async function handle(request: Request) {
  if (!process.env.INTEL_CRON_SECRET) return Response.json({ ok: false, error: "INTEL_CRON_SECRET is not set." }, { status: 503 });
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const job = new URL(request.url).searchParams.get("job") ?? "sync";
  if (!["sync", "radar", "all"].includes(job)) return Response.json({ ok: false, error: "job must be sync, radar or all." }, { status: 400 });

  const result: { ok: true; sync?: SyncOutcome[] | { skipped: string }; radar?: { brandId: string; week: string }[] } = { ok: true };

  if (job === "sync" || job === "all") {
    if (!gmailEnv()) {
      result.sync = { skipped: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set." };
    } else {
      const outcomes: SyncOutcome[] = [];
      const touched = new Map<string, { organizationId: string; brandId: string }>();
      for (const account of await allGmailAccounts()) {
        const outcome = await syncGmailAccount({ organizationId: account.organizationId, accountId: account.id, actorId: null });
        outcomes.push(outcome);
        if (outcome.added) touched.set(`${account.organizationId}:${account.brandId}`, account);
      }
      result.sync = outcomes;
      if (aiConfigured() && touched.size) {
        after(async () => {
          for (const { organizationId, brandId } of touched.values()) {
            const brand = await loadBrand(organizationId, brandId);
            if (brand) await drainExtractions({ organizationId, brand, actorId: null });
          }
        });
      }
    }
  }

  if (job === "radar" || job === "all") {
    // Last complete week (Monday to Sunday, UTC).
    const week = new Date(weekStartOf(new Date()).getTime() - 7 * 86_400_000);
    const built: { organizationId: string; brandId: string; digestId: string }[] = [];
    for (const { organizationId, brandId } of await brandsWithEmailSince(week)) {
      const brand = await loadBrand(organizationId, brandId);
      if (!brand) continue;
      const digestId = await buildRadarDigest({ organizationId, brand, weekStart: week, actorId: null });
      built.push({ organizationId, brandId, digestId });
    }
    result.radar = built.map((row) => ({ brandId: row.brandId, week: isoDay(week) }));
    if (aiConfigured() && built.length) {
      after(async () => {
        for (const row of built) {
          const brand = await loadBrand(row.organizationId, row.brandId);
          if (brand) await runRadarNarrative({ organizationId: row.organizationId, brand, digestId: row.digestId, actorId: null });
        }
      });
    }
  }

  return Response.json(result);
}

export const POST = handle;
export const GET = handle;
