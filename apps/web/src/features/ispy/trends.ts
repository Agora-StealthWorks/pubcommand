import { aiConfigured, runStructured } from "@pubcommand/ai";
import type { Prisma } from "@pubcommand/db";
import { isoDay, weekStartOf } from "../../../../../modules/intel/index";
import { computeTrends, FEED_LABELS, TRENDS_SYSTEM, trendsNote, trendsPrompt, type Feed, type TrendEmail, type TrendStats } from "../../../../../modules/ispy/index";
import { organizationsWithModule } from "@pubcommand/db";
import { sendEmail } from "@/lib/email";
import { ensureConsoleOrganization } from "@/lib/console-workspace";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { asCopyExtraction } from "./brain";
import { ispyDb } from "./db";
import { openSecret, readIspySettings } from "./settings";

const WEEK = 7 * 86_400_000;

async function trendEmails(feed: Feed, from: Date, to: Date): Promise<{ emails: TrendEmail[]; liftLists: { advertiser: string; list: string }[] }> {
  return ispyDb(async (tx) => {
    const rows = await tx.ispyEmail.findMany({
      where: { feed, receivedAt: { gte: from, lt: to } },
      select: { emailType: true, sendKind: true, topics: true, gurus: true, publisherId: true, copyId: true, promoId: true, listId: true, copy: { select: { extraction: true } }, promo: { select: { advertiserLabel: true, advertiser: { select: { label: true } } } } },
      take: 20_000,
    });
    const pubs = await tx.ispyPublisher.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.publisherId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const names = new Map(pubs.map((p) => [p.id, p.name]));
    const emails = rows.map((r): TrendEmail => ({
      publisher: r.publisherId ? names.get(r.publisherId) ?? null : null,
      emailType: r.emailType,
      sendKind: r.sendKind,
      topics: r.topics,
      gurus: r.gurus,
      advertiser: r.promo ? r.promo.advertiserLabel ?? r.promo.advertiser.label : null,
      promoId: r.promoId,
      copyId: r.copyId,
      priceText: asCopyExtraction(r.copy?.extraction)?.offer.priceText ?? null,
    }));
    const liftLists = rows
      .filter((r) => (r.emailType === "EXTERNAL_LIFT" || r.emailType === "INTERNAL_LIFT" || r.sendKind === "AFFILIATE") && r.promo && r.listId)
      .map((r) => ({ advertiser: r.promo!.advertiserLabel ?? r.promo!.advertiser.label, list: r.listId! }));
    return { emails, liftLists };
  });
}

/**
 * Build one feed's weekly trends (deterministic), add one short AI paragraph, save it,
 * and teach it to the Master Brain and to every brand that sees the feed.
 */
export async function buildTrendWeek(feed: Feed, weekStart: Date, options: { narrate?: boolean } = {}): Promise<TrendStats> {
  const weekEnd = new Date(weekStart.getTime() + WEEK);
  const [current, previous, promos] = await Promise.all([
    trendEmails(feed, weekStart, weekEnd),
    trendEmails(feed, new Date(weekStart.getTime() - WEEK), weekStart),
    ispyDb((tx) =>
      tx.ispyPromo.findMany({
        where: { feed, mergedIntoId: null, sightings: { some: { day: { gte: weekStart, lt: weekEnd } } } },
        select: { id: true, headline: true, kind: true, firstSeenOn: true, daysDetected: true, sendCount: true, advertiserLabel: true, advertiser: { select: { label: true } } },
        take: 500,
      }),
    ),
  ]);
  const stats = computeTrends({
    emails: current.emails,
    previous: previous.emails,
    liftLists: current.liftLists,
    promos: promos.map((p) => ({ id: p.id, headline: p.headline, advertiser: p.advertiserLabel ?? p.advertiser.label, kind: p.kind, firstSeenOn: p.firstSeenOn, daysDetected: p.daysDetected, sendCount: p.sendCount, isNew: p.firstSeenOn >= weekStart && p.firstSeenOn < weekEnd })),
  });
  let narrative: string | null = null;
  let model: string | null = null;
  if (options.narrate !== false && aiConfigured() && stats.emails > 0) {
    const answer = await runStructured<{ paragraph: string }>({
      system: TRENDS_SYSTEM,
      input: [{ type: "text", text: trendsPrompt(FEED_LABELS[feed], stats) }],
      schema: { type: "object", additionalProperties: false, required: ["paragraph"], properties: { paragraph: { type: "string" } } },
      effort: "low",
      maxTokens: 800,
    });
    if ("usage" in answer && answer.usage) {
      const orgId = await ensureConsoleOrganization().catch(() => null);
      if (orgId) await logAiUsage({ organizationId: orgId, moduleId: "intel", feature: "ispy.trends", actorId: null, usage: answer.usage }).catch(() => undefined);
    }
    if (answer.status === "ok") {
      narrative = answer.data.paragraph.trim().slice(0, 1200);
      model = answer.usage?.model ?? null;
    }
  }
  await ispyDb((tx) =>
    tx.ispyTrendWeek.upsert({
      where: { feed_weekStart: { feed, weekStart } },
      create: { feed, weekStart, stats: stats as unknown as Prisma.InputJsonValue, narrative, model },
      update: { stats: stats as unknown as Prisma.InputJsonValue, ...(narrative ? { narrative, model } : {}) },
    }),
  );
  await teachTrends(feed, weekStart, stats, narrative);
  return stats;
}

async function teachTrends(feed: Feed, weekStart: Date, stats: TrendStats, narrative: string | null) {
  const note = trendsNote(FEED_LABELS[feed], isoDay(weekStart), stats, narrative);
  const niche = feed === "HEALTH" ? "health" : "finance";
  // Every brand of every org with ISpy whose niche matches the feed gets one short note.
  const allOrgs = await ispyDb((tx) => tx.organization.findMany({ where: { deletedAt: null }, select: { id: true } })).catch(() => [] as { id: string }[]);
  const orgIds = [...(await organizationsWithModule(allOrgs.map((o) => o.id), "intel").catch(() => new Set<string>()))];
  const brands = await ispyDb((tx) => tx.brand.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, organizationId: true, niche: true } })).catch(() => [] as { id: string; organizationId: string; niche: string }[]);
  for (const brand of brands) {
    const brandFeed: Feed = brand.niche === "health" ? "HEALTH" : "FINPUB";
    if (brandFeed !== feed) continue;
    await teachBrain({ organizationId: brand.organizationId, brandId: brand.id, sourceRef: `ispy-trends:${feed}:${isoDay(weekStart)}`, title: note.title, body: note.body, folder: "ISpy/Trends", source: "ispy", actorId: null, niche });
  }
}

/** The previous complete week, for both feeds (the Monday job). */
export async function buildLastWeek(): Promise<{ feeds: number }> {
  const weekStart = new Date(weekStartOf(new Date()).getTime() - WEEK);
  for (const feed of ["FINPUB", "HEALTH"] as const) await buildTrendWeek(feed, weekStart);
  return { feeds: 2 };
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The daily digest: yesterday's new promos and reuse alerts, to Slack and/or email. */
export async function sendDailyDigest(): Promise<{ sent: boolean; skipped?: string }> {
  const settings = await readIspySettings();
  if (!settings.dailyDigest) return { sent: false, skipped: "daily digest is off" };
  const webhook = openSecret(settings.slackWebhookEnc);
  if (!webhook && !settings.digestEmails.length) return { sent: false, skipped: "no Slack webhook or email recipients" };
  const since = new Date(Date.now() - 86_400_000);
  const data = await ispyDb(async (tx) => ({
    promos: await tx.ispyPromo.findMany({ where: { mergedIntoId: null, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: 40, select: { feed: true, headline: true, landingUrl: true, kind: true, advertiserLabel: true, advertiser: { select: { label: true } } } }),
    reuse: await tx.ispyCopy.findMany({ where: { mergedIntoId: null, lastSeenAt: { gte: since }, sendCount: { gt: 1 }, OR: [{ subjectCount: { gt: 1 } }, { firstSeenKind: { not: "AFFILIATE" }, affiliateCount: { gt: 0 } }] }, take: 20, select: { title: true, sendCount: true, subjectCount: true, affiliateCount: true } }),
  }));
  if (!data.promos.length && !data.reuse.length) return { sent: false, skipped: "nothing new" };
  const lines = [
    `*ISpy · ${isoDay(since)}*`,
    `New promos: ${data.promos.length}`,
    ...data.promos.map((p) => `• [${FEED_LABELS[p.feed as Feed] ?? p.feed}] ${p.advertiserLabel ?? p.advertiser.label}: ${p.headline ?? p.landingUrl} (${p.kind})`),
    data.reuse.length ? "\nReused copy:" : "",
    ...data.reuse.map((c) => `• ${c.title}: ${c.sendCount} sends, ${c.subjectCount} subjects${c.affiliateCount ? `, ${c.affiliateCount} affiliate(s)` : ""}`),
  ].filter(Boolean);
  const text = lines.join("\n");
  if (webhook) await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  if (settings.digestEmails.length) await sendEmail({ to: settings.digestEmails, subject: `ISpy digest · ${isoDay(since)}`, html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`, text });
  return { sent: true };
}
