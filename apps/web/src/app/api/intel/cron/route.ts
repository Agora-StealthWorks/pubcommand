import { aiConfigured } from "@pubcommand/ai";
import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { buildAllRadars, extractTouched, lastCompleteWeek, narrateAll, syncAllInboxes } from "@/features/intel/scheduled";
import { isoDay } from "../../../../../../../modules/intel/index";

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
 * The older external-scheduler entry point, kept so existing cron setups keep
 * working. The same work now also runs as the scheduled jobs intel.gmail-sync
 * and intel.radar (src/jobs), which need no secret. Protected by INTEL_CRON_SECRET.
 * - ?job=sync (default): pull new mail from every connected Gmail inbox, then extract it.
 * - ?job=radar: build last week's Promo Radar for every brand that received competitor mail.
 * - ?job=all: both.
 */
async function handle(request: Request) {
  if (!process.env.INTEL_CRON_SECRET) return Response.json({ ok: false, error: "INTEL_CRON_SECRET is not set." }, { status: 503 });
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const job = new URL(request.url).searchParams.get("job") ?? "sync";
  if (!["sync", "radar", "all"].includes(job)) return Response.json({ ok: false, error: "job must be sync, radar or all." }, { status: 400 });

  const result: { ok: true; sync?: unknown; radar?: { brandId: string; week: string }[] } = { ok: true };

  if (job === "sync" || job === "all") {
    const synced = await syncAllInboxes();
    if ("skipped" in synced) {
      result.sync = synced;
    } else {
      result.sync = synced.outcomes;
      if (synced.touched.length) after(() => extractTouched(synced.touched));
    }
  }

  if (job === "radar" || job === "all") {
    const week = lastCompleteWeek();
    const built = await buildAllRadars(week);
    result.radar = built.map((row) => ({ brandId: row.brandId, week: isoDay(week) }));
    if (aiConfigured() && built.length) after(() => narrateAll(built));
  }

  return Response.json(result);
}

export const POST = handle;
export const GET = handle;
