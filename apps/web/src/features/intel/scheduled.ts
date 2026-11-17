import { aiConfigured } from "@pubcommand/ai";
import { buildSiteUrl } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { buildDigest, decryptToken, isSlackWebhookUrl, isoDay, weekEndOf, weekStartOf, type DigestContent, type EmailExtraction } from "../../../../../modules/intel/index";
import { rootDomain } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import type { IntelBrand } from "./context";
import { allGmailAccounts, authSecret, brandsWithEmailSince, gmailEnv, loadBrand, syncGmailAccount, type SyncOutcome } from "./gmail";
import { backfillLinks } from "./registry";
import { buildRadarDigest, drainExtractions, runRadarNarrative } from "./server";
import { readSettings, writeSettings } from "./settings";
import { loadRadar } from "./data";

/**
 * Scheduled Intel work, shared by the jobs (src/jobs/intel-*.ts) and the older
 * INTEL_CRON_SECRET route. Counts only in what they return: never PII.
 */

export type Touched = { organizationId: string; brandId: string };

/** Pull new mail from every connected inbox. Returns per-inbox outcomes and the brands that got mail. */
export async function syncAllInboxes(): Promise<{ outcomes: SyncOutcome[]; touched: Touched[] } | { skipped: string }> {
  if (!gmailEnv()) return { skipped: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set." };
  const outcomes: SyncOutcome[] = [];
  const touched = new Map<string, Touched>();
  for (const account of await allGmailAccounts()) {
    const outcome = await syncGmailAccount({ organizationId: account.organizationId, accountId: account.id, actorId: null });
    outcomes.push(outcome);
    if (outcome.added) touched.set(`${account.organizationId}:${account.brandId}`, { organizationId: account.organizationId, brandId: account.brandId });
  }
  return { outcomes, touched: [...touched.values()] };
}

/** Extract what the sync brought in (and link older emails to the registries). */
export async function extractTouched(touched: readonly Touched[], limit = 200): Promise<void> {
  for (const { organizationId, brandId } of touched) {
    const brand = await loadBrand(organizationId, brandId);
    if (!brand) continue;
    if (aiConfigured()) await drainExtractions({ organizationId, brand, actorId: null, limit });
    await backfillLinks(organizationId, brandId, 300).catch(() => 0);
  }
}

/** The last complete week (Monday to Sunday, UTC). */
export function lastCompleteWeek(now = new Date()): Date {
  return new Date(weekStartOf(now).getTime() - 7 * 86_400_000);
}

export type BuiltRadar = { organizationId: string; brandId: string; digestId: string };

/** Build a week's radar for every brand that received competitor mail that week. */
export async function buildAllRadars(week: Date): Promise<BuiltRadar[]> {
  const built: BuiltRadar[] = [];
  for (const { organizationId, brandId } of await brandsWithEmailSince(week)) {
    const brand = await loadBrand(organizationId, brandId);
    if (!brand) continue;
    built.push({ organizationId, brandId, digestId: await buildRadarDigest({ organizationId, brand, weekStart: week, actorId: null }) });
  }
  return built;
}

export async function narrateAll(built: readonly BuiltRadar[]): Promise<void> {
  if (!aiConfigured()) return;
  for (const row of built) {
    const brand = await loadBrand(row.organizationId, row.brandId);
    if (brand) await runRadarNarrative({ organizationId: row.organizationId, brand, digestId: row.digestId, actorId: null });
  }
}

// ── Weekly digest ───────────────────────────────────────────────────────────

async function orgSlug(organizationId: string): Promise<string | null> {
  const org = await rawPrisma().organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return org?.slug ?? null;
}

function orgUrl(slug: string, pathname: string, search = ""): string {
  const root = rootDomain();
  return buildSiteUrl({ rootDomain: root, requestHost: root, site: { kind: "org", slug }, pathname, search });
}

/** Videos captured in a week, for the digest's last section. */
async function weekVideos(organizationId: string, brandId: string, week: Date, slug: string) {
  const rows = await tenantDb(organizationId).intelVideo.findMany({
    where: { brandId, deletedAt: null, status: "DONE", createdAt: { gte: week, lt: weekEndOf(week) } },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { id: true, title: true, url: true, videoType: true, extraction: true, competitor: { select: { name: true } } },
  });
  return rows.map((row) => ({
    title: row.title ?? row.url,
    competitorName: row.competitor?.name ?? null,
    type: row.videoType,
    headline: (row.extraction as EmailExtraction | null)?.headline ?? null,
    url: orgUrl(slug, `/intel/videos/${row.id}`),
  }));
}

export type DigestOutcome = { sent: boolean; slack: "sent" | "failed" | "off"; email: "sent" | "logged" | "failed" | "off"; skipped?: string; error?: string };

async function postSlack(webhook: string, content: DigestContent, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!isSlackWebhookUrl(webhook)) return "The saved Slack webhook is not a hooks.slack.com URL.";
  try {
    const response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(content.slack),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return `Slack answered ${response.status}${response.status === 404 || response.status === 403 ? " (the webhook was removed or revoked)" : ""}.`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Slack could not be reached.";
  }
}

/**
 * Send one brand's digest for a week. Skips when the digest is off, has no
 * destination, or (unless forced) already went out for that week.
 */
export async function sendBrandDigest(input: { organizationId: string; brand: IntelBrand; week: Date; force?: boolean }): Promise<DigestOutcome> {
  const settings = await readSettings(input.organizationId, input.brand.id);
  const off: DigestOutcome = { sent: false, slack: "off", email: "off" };
  if (!input.force && !settings.digestEnabled) return { ...off, skipped: "the digest is off" };
  if (!settings.slackWebhookEnc && !settings.digestEmails.length) return { ...off, skipped: "no Slack webhook or email recipients" };
  if (!input.force && settings.lastDigestWeek && isoDay(settings.lastDigestWeek) === isoDay(input.week)) return { ...off, skipped: "already sent for this week" };
  const slug = await orgSlug(input.organizationId);
  if (!slug) return { ...off, skipped: "organization not found" };

  let radar = await loadRadar(input.organizationId, input.brand.id, input.week);
  if (!radar) {
    const digestId = await buildRadarDigest({ organizationId: input.organizationId, brand: input.brand, weekStart: input.week, actorId: null });
    await runRadarNarrative({ organizationId: input.organizationId, brand: input.brand, digestId, actorId: null });
    radar = await loadRadar(input.organizationId, input.brand.id, input.week);
  }
  if (!radar) return { ...off, skipped: "the radar could not be built" };
  const content = buildDigest({
    brandName: input.brand.name,
    summary: radar.summary,
    narrative: radar.narrative,
    radarUrl: orgUrl(slug, "/intel/radar", `?week=${isoDay(input.week)}`),
    videos: await weekVideos(input.organizationId, input.brand.id, input.week, slug),
  });

  const outcome: DigestOutcome = { sent: false, slack: "off", email: "off" };
  const errors: string[] = [];
  if (settings.slackWebhookEnc) {
    let webhook = "";
    try {
      webhook = decryptToken(settings.slackWebhookEnc, authSecret());
    } catch {
      errors.push("The Slack webhook could not be decrypted (AUTH_SECRET changed). Save it again.");
    }
    if (webhook) {
      const error = await postSlack(webhook, content);
      outcome.slack = error ? "failed" : "sent";
      if (error) errors.push(`Slack: ${error}`);
    } else outcome.slack = "failed";
  }
  if (settings.digestEmails.length) {
    const result = await sendEmail({ to: settings.digestEmails, subject: content.subject, html: content.html, text: content.text });
    outcome.email = result.status === "sent" ? "sent" : result.status === "logged" ? "logged" : "failed";
    if (result.status === "failed") errors.push(`Email: ${result.reason}`);
    if (result.status === "logged") errors.push("Email is not set up yet (RESEND_API_KEY), so the digest email was not sent.");
  }
  outcome.sent = outcome.slack === "sent" || outcome.email === "sent";
  if (errors.length) outcome.error = errors.join(" ");
  await writeSettings(input.organizationId, input.brand.id, {
    lastDigestAt: new Date(),
    lastDigestError: outcome.error?.slice(0, 500) ?? null,
    ...(outcome.sent ? { lastDigestWeek: input.week } : {}),
  });
  return outcome;
}

/** Every brand that turned the digest on. */
export async function digestBrands(): Promise<Touched[]> {
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return tx.intelSettings.findMany({ where: { digestEnabled: true }, select: { organizationId: true, brandId: true } });
  });
}
