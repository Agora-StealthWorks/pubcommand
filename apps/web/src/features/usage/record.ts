import os from "node:os";
import { usageArea } from "@pubcommand/core";
import { platformTx, rawPrisma } from "@pubcommand/db";
import { headers } from "next/headers";
import { currentRequest } from "@/lib/request";

/**
 * Writes app usage: sign-ins, the browser heartbeat (page views, active time, transfer) and
 * web server memory samples. All rows are platform rows (platformTx), never visible to orgs.
 * Recording never breaks a request: failures are logged and swallowed.
 */

export type LoginMethod = "magic_link" | "password" | "password_reset" | "registration";

const orgIds = new Map<string, { id: string | null; at: number }>();

/** Organization id for a slug, cached for 5 minutes. */
export async function orgIdForSlug(slug: string): Promise<string | null> {
  const hit = orgIds.get(slug);
  if (hit && Date.now() - hit.at < 300_000) return hit.id;
  const org = await rawPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
  orgIds.set(slug, { id: org?.id ?? null, at: Date.now() });
  return org?.id ?? null;
}

async function clientInfo() {
  const list = await headers();
  const ip = (list.get("x-forwarded-for") ?? list.get("x-real-ip") ?? "").split(",")[0]?.trim() || null;
  return { ip: ip?.slice(0, 64) ?? null, userAgent: list.get("user-agent")?.slice(0, 300) ?? null };
}

export async function recordLogin(userId: string, method: LoginMethod): Promise<void> {
  try {
    const request = await currentRequest();
    const site = request.site.kind === "org" || request.site.kind === "app" || request.site.kind === "admin" ? request.site.kind : "marketing";
    const orgId = request.site.kind === "org" ? await orgIdForSlug(request.site.slug) : null;
    const info = await clientInfo();
    await platformTx((tx) => tx.usageLogin.create({ data: { userId, method, site, orgId, ...info } }));
  } catch (error) {
    console.warn("[usage] login not recorded", error instanceof Error ? error.message : error);
  }
}

export type Heartbeat = {
  path: string;
  /** 1 when this beat starts a new page view. */
  view: boolean;
  activeSeconds: number;
  bytes: number;
};

/** Caps per beat (the browser beats about once a minute and on leaving a page). */
const MAX_ACTIVE_SECONDS = 180;
const MAX_BYTES = 200 * 1024 * 1024;

export function cleanHeartbeat(raw: unknown): Heartbeat | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const path = typeof value.path === "string" ? value.path.slice(0, 500) : "";
  if (!path.startsWith("/")) return null;
  const num = (input: unknown, max: number) => {
    const n = Number(input);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : 0;
  };
  return { path, view: value.view === true, activeSeconds: num(value.activeSeconds, MAX_ACTIVE_SECONDS), bytes: num(value.bytes, MAX_BYTES) };
}

/** Adds one heartbeat to today's row (days are New York days, like the jobs). */
export async function recordHeartbeat(input: { userId: string; site: string; orgId: string | null; beat: Heartbeat }): Promise<void> {
  const { app, area } = usageArea(input.beat.path);
  const views = input.beat.view ? 1 : 0;
  if (!views && !input.beat.activeSeconds && !input.beat.bytes) return;
  await platformTx(
    (tx) => tx.$executeRaw`
      INSERT INTO "usage_daily" ("id", "day", "user_id", "site", "organization_id", "app", "area", "views", "active_seconds", "bytes", "first_seen_at", "last_seen_at")
      VALUES (gen_random_uuid(), (now() AT TIME ZONE 'America/New_York')::date, ${input.userId}::uuid, ${input.site}, ${input.orgId}::uuid, ${app}, ${area}, ${views}, ${input.beat.activeSeconds}, ${BigInt(input.beat.bytes)}, now(), now())
      ON CONFLICT ("day", "user_id", "site", "area") DO UPDATE SET
        "views" = "usage_daily"."views" + EXCLUDED."views",
        "active_seconds" = "usage_daily"."active_seconds" + EXCLUDED."active_seconds",
        "bytes" = "usage_daily"."bytes" + EXCLUDED."bytes",
        "last_seen_at" = now()`,
  );
}

// ── Server samples ────────────────────────────────────────────────────────

const SAMPLE_EVERY_MS = 5 * 60_000;
let sampler: ReturnType<typeof setInterval> | null = null;

export function serverInstance(): { service: string; instance: string } {
  return {
    service: (process.env.RAILWAY_SERVICE_NAME ?? "web").slice(0, 60),
    instance: (process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? os.hostname()).slice(0, 80),
  };
}

/** Samples this process's memory and CPU every 5 minutes (started from instrumentation). */
export function startServerSampler(): void {
  if (sampler || process.env.USAGE_SAMPLER === "off") return;
  let lastCpu = process.cpuUsage();
  let lastAt = Date.now();
  const sample = async () => {
    try {
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage(lastCpu);
      const elapsedMs = Date.now() - lastAt;
      lastCpu = process.cpuUsage();
      lastAt = Date.now();
      const cpuPercent = elapsedMs > 0 ? Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10 : null;
      await platformTx((tx) =>
        tx.usageServerSample.create({
          data: {
            ...serverInstance(),
            rssBytes: BigInt(memory.rss),
            heapUsedBytes: BigInt(memory.heapUsed),
            heapTotalBytes: BigInt(memory.heapTotal),
            externalBytes: BigInt(memory.external),
            cpuPercent,
            uptimeSeconds: Math.round(process.uptime()),
          },
        }),
      );
    } catch (error) {
      console.warn("[usage] server sample failed", error instanceof Error ? error.message : error);
    }
  };
  setTimeout(() => void sample(), 60_000).unref?.();
  sampler = setInterval(() => void sample(), SAMPLE_EVERY_MS);
  sampler.unref?.();
}
