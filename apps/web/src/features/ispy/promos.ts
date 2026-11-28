import { readS3Config } from "@pubcommand/core";
import {
  advertiserLabelFromDomain,
  canonicalKey,
  contentKey,
  declaredUrls,
  findTranscriptLink,
  hammingDistance,
  pageKeys,
  pageText,
  resolveEmailDestinations,
  videoIds,
  type Destination,
} from "../../../../../modules/ispy/index";
import { s3Put } from "@/lib/s3";
import { ispyDb, type IspyTx } from "./db";
import { fetchPage, fetchText } from "./net";

const dayOf = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");
}

async function storeSnapshot(landingId: string, html: string): Promise<string | null> {
  const config = readS3Config();
  if (!config) return null;
  const key = `platform/ispy/landing/${landingId}.html`;
  try {
    await s3Put(config, key, new TextEncoder().encode(stripScripts(html).slice(0, 2_000_000)), "text/html; charset=utf-8");
    return key;
  } catch {
    return null;
  }
}

type PageFacts = {
  dest: Destination;
  keys: string[];
  relCanonical: string | null;
  ogUrl: string | null;
  content: string | null;
  videos: string[];
  text: string;
  simhash: string | null;
  textHash: string | null;
  transcript: { url: string; text: string } | null;
};

function factsFor(dest: Destination): PageFacts {
  const declared = dest.html ? declaredUrls(dest.html, dest.url) : { relCanonical: null, ogUrl: null };
  const text = dest.html ? pageText(dest.html) : { text: "", simhash: null, hash: null };
  return {
    dest,
    keys: pageKeys(dest.url, declared),
    relCanonical: declared.relCanonical,
    ogUrl: declared.ogUrl,
    content: contentKey({ rootDomain: dest.rootDomain, host: dest.host, headline: dest.headline, headlineSource: dest.headlineSource, siteName: dest.siteName, isPlatform: dest.isPlatform }),
    videos: dest.html ? videoIds(dest.html, dest.url) : [],
    text: text.text,
    simhash: text.simhash,
    textHash: text.hash,
    transcript: dest.html ? findTranscriptLink(dest.html, dest.url) : null,
  };
}

/**
 * The match ladder: an existing promo by URL key or alias, by the page's declared
 * canonical URL, by content key (domain + headline), by the same VSL video, or by
 * near-identical page text on the same domain. Returns the promo id and which rung hit.
 */
async function findPromo(tx: IspyTx, feed: string, f: PageFacts): Promise<{ id: string; how: string } | null> {
  const direct = await tx.ispyPromo.findFirst({ where: { canonicalKey: { in: f.keys }, mergedIntoId: null }, select: { id: true } });
  if (direct) return { id: direct.id, how: "url" };
  const aliasKeys = [...f.keys.map((k) => `url:${k}`), ...(f.content ? [`content:${f.content}`] : []), ...f.videos.map((v) => `video:${v}`)];
  const alias = await tx.ispyPromoAlias.findMany({ where: { key: { in: aliasKeys } }, select: { key: true, promoId: true } });
  for (const prefix of ["url:", "content:", "video:"]) {
    const hit = alias.find((a) => a.key.startsWith(prefix));
    if (hit) return { id: await resolveMerged(tx, hit.promoId), how: prefix.slice(0, -1) };
  }
  if (f.simhash) {
    const sameDomain = await tx.ispyPromo.findMany({ where: { feed, mergedIntoId: null, simhash: { not: null }, landingHost: { endsWith: f.dest.rootDomain } }, select: { id: true, simhash: true }, take: 500, orderBy: { lastSeenOn: "desc" } });
    const near = sameDomain.find((p) => p.simhash && hammingDistance(p.simhash, f.simhash!) <= 3);
    if (near) return { id: near.id, how: "text" };
  }
  return null;
}

async function resolveMerged(tx: IspyTx, promoId: string): Promise<string> {
  let id = promoId;
  for (let i = 0; i < 5; i += 1) {
    const row = await tx.ispyPromo.findUnique({ where: { id }, select: { mergedIntoId: true } });
    if (!row?.mergedIntoId) return id;
    id = row.mergedIntoId;
  }
  return id;
}

async function addAliases(tx: IspyTx, promoId: string, f: PageFacts) {
  const rows = [
    ...f.keys.map((k) => ({ key: `url:${k}`, source: "URL" })),
    ...(f.relCanonical ? [{ key: `url:${canonicalKey(f.relCanonical)}`, source: "CANONICAL" }] : []),
    ...(f.content ? [{ key: `content:${f.content}`, source: "CONTENT" }] : []),
    ...f.videos.map((v) => ({ key: `video:${v}`, source: "VIDEO" })),
  ];
  if (rows.length) await tx.ispyPromoAlias.createMany({ data: rows.map((r) => ({ ...r, promoId })), skipDuplicates: true });
}

async function advertiserFor(tx: IspyTx, dest: Destination, senderPublisherId: string | null, isAffiliateSend: boolean): Promise<string> {
  const domain = dest.rootDomain;
  const existing = await tx.ispyAdvertiser.findUnique({ where: { domain } });
  if (existing) return existing.id;
  const publishers = await tx.ispyPublisher.findMany({ where: { deletedAt: null, type: { not: "AFFILIATE" } }, select: { id: true, name: true, domains: true } });
  const owner = publishers.find((p) => p.domains.some((d) => d.toLowerCase() === domain || domain.endsWith(`.${d.toLowerCase()}`)));
  // A platform domain (Zoom, a webinar host) names nobody: fall back to the mailer, unless it's an affiliate.
  const publisherId = owner?.id ?? (dest.isPlatform && !isAffiliateSend ? senderPublisherId : null);
  const label = owner?.name ?? advertiserLabelFromDomain(dest.host);
  const created = await tx.ispyAdvertiser.create({ data: { domain, label, isPlatform: dest.isPlatform, publisherId }, select: { id: true } });
  return created.id;
}

export async function refreshPromoCounters(tx: IspyTx, promoId: string): Promise<void> {
  const sightings = await tx.ispyPromoSighting.findMany({ where: { promoId }, select: { day: true, sendKind: true, publisherId: true } });
  if (!sightings.length) return;
  const days = [...new Set(sightings.map((s) => s.day.toISOString().slice(0, 10)))].sort();
  await tx.ispyPromo.update({
    where: { id: promoId },
    data: {
      firstSeenOn: new Date(`${days[0]}T00:00:00.000Z`),
      lastSeenOn: new Date(`${days[days.length - 1]}T00:00:00.000Z`),
      daysDetected: days.length,
      sendCount: sightings.length,
      affiliateCount: new Set(sightings.filter((s) => s.sendKind === "AFFILIATE").map((s) => s.publisherId)).size,
    },
  });
}

/**
 * Find the promo one email pushes. A re-send of a copy whose promo is known reuses it
 * (no page fetches). Otherwise the email's links are followed to their landing pages.
 */
export async function scanEmailPromo(emailId: string): Promise<"DONE" | "NO_PROMO" | "FAILED" | "SKIPPED"> {
  const email = await ispyDb((tx) =>
    tx.ispyEmail.findUnique({
      where: { id: emailId },
      select: { id: true, feed: true, htmlBody: true, textBody: true, subject: true, receivedAt: true, publisherId: true, listId: true, sendKind: true, copyId: true, promoScanStatus: true, copy: { select: { promoId: true } } },
    }),
  );
  if (!email || email.promoScanStatus === "NONE") return "SKIPPED";

  const sight = async (tx: IspyTx, promoId: string, rawUrl: string, isFirst: boolean) => {
    await tx.ispyPromoSighting.upsert({
      where: { promoId_emailId: { promoId, emailId: email.id } },
      create: { promoId, emailId: email.id, day: dayOf(email.receivedAt), publisherId: email.publisherId, listId: email.listId, sendKind: email.sendKind, subject: email.subject.slice(0, 500), rawUrl: rawUrl.slice(0, 2000), isFirstEver: isFirst },
      update: {},
    });
    await refreshPromoCounters(tx, promoId);
    const promo = await tx.ispyPromo.findUnique({ where: { id: promoId }, select: { advertiserId: true } });
    await tx.ispyEmail.update({ where: { id: email.id }, data: { promoId, promoScanStatus: "DONE", promoScanError: null } });
    if (email.copyId) await tx.ispyCopy.update({ where: { id: email.copyId }, data: { promoId, advertiserId: promo?.advertiserId ?? null } });
  };

  if (email.copy?.promoId) {
    await ispyDb((tx) => sight(tx, email.copy!.promoId!, "(same copy)", false));
    return "DONE";
  }
  const html = email.htmlBody ?? email.textBody.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');
  try {
    const publisher = email.publisherId ? await ispyDb((tx) => tx.ispyPublisher.findUnique({ where: { id: email.publisherId! }, select: { excludeBrands: true, type: true } })) : null;
    const blocks = new Set((await ispyDb((tx) => tx.ispyPromoBlock.findMany({ select: { matchKey: true } }))).map((b) => b.matchKey));
    const destinations = (await resolveEmailDestinations(html, fetchPage, { excludeBrands: publisher?.excludeBrands ?? [] })).filter((d) => {
      const ck = contentKey({ rootDomain: d.rootDomain, host: d.host, headline: d.headline, headlineSource: d.headlineSource, siteName: d.siteName, isPlatform: d.isPlatform });
      return !blocks.has(`url:${d.canonicalKey}`) && !(ck && blocks.has(`content:${ck}`));
    });
    const best = destinations[0];
    if (!best) {
      await ispyDb((tx) => tx.ispyEmail.update({ where: { id: email.id }, data: { promoScanStatus: "NO_PROMO", promoScanError: null } }));
      return "NO_PROMO";
    }
    const f = factsFor(best);
    let transcriptText: string | null = null;
    if (f.transcript && !f.transcript.url.startsWith(`${best.url.split("#")[0]}#`) && f.transcript.url !== best.url) {
      const page = await fetchText(f.transcript.url).catch(() => null);
      transcriptText = page ? pageText(page).text.slice(0, 200_000) : null;
    }
    const isAffiliate = email.sendKind === "AFFILIATE" || publisher?.type === "AFFILIATE";
    const landingId = await ispyDb(async (tx) => {
      const matched = await findPromo(tx, email.feed, f);
      let promoId = matched?.id ?? null;
      let isFirst = false;
      if (!promoId) {
        const advertiserId = await advertiserFor(tx, best, email.publisherId, isAffiliate);
        const advertiser = await tx.ispyAdvertiser.findUnique({ where: { id: advertiserId }, select: { publisher: { select: { type: true, linkedOrganizationId: true } } } });
        const created = await tx.ispyPromo.create({
          data: {
            feed: email.feed,
            canonicalKey: best.canonicalKey,
            contentKey: f.content,
            landingUrl: best.url,
            landingHost: best.host,
            advertiserId,
            headline: best.headline ?? email.subject.slice(0, 300),
            headlineSource: best.headline ? best.headlineSource : "SUBJECT",
            kind: best.kind,
            lastStatus: best.status,
            videoIds: f.videos,
            simhash: f.simhash,
            isInternal: advertiser?.publisher?.type === "INTERNAL" || !!advertiser?.publisher?.linkedOrganizationId,
            firstSeenOn: dayOf(email.receivedAt),
            lastSeenOn: dayOf(email.receivedAt),
          },
          select: { id: true },
        });
        promoId = created.id;
        isFirst = true;
      } else {
        await tx.ispyPromo.update({ where: { id: promoId }, data: { lastStatus: best.status, ...(f.simhash ? { simhash: f.simhash } : {}), ...(f.videos.length ? { videoIds: f.videos } : {}) } });
      }
      await addAliases(tx, promoId, f);
      const landing = await tx.ispyLandingPage.upsert({
        where: { canonicalKey: best.canonicalKey },
        create: {
          canonicalKey: best.canonicalKey,
          url: best.url,
          finalUrl: best.url,
          status: best.status,
          relCanonical: f.relCanonical,
          ogUrl: f.ogUrl,
          headline: best.headline,
          headlineSource: best.headlineSource,
          siteName: best.siteName,
          text: f.text,
          textHash: f.textHash,
          simhash: f.simhash,
          videoIds: f.videos,
          kind: best.kind,
          transcriptStatus: best.html ? (f.transcript ? "FOUND" : "NOT_DETECTED") : "UNREADABLE",
          transcriptUrl: f.transcript?.url ?? null,
          transcriptLinkText: f.transcript?.text ?? null,
          transcriptText,
          promoId,
        },
        update: {
          status: best.status,
          headline: best.headline,
          text: f.text || undefined,
          simhash: f.simhash,
          videoIds: f.videos,
          fetchedAt: new Date(),
          transcriptStatus: best.html ? (f.transcript ? "FOUND" : "NOT_DETECTED") : "UNREADABLE",
          transcriptUrl: f.transcript?.url ?? null,
          transcriptLinkText: f.transcript?.text ?? null,
          ...(transcriptText ? { transcriptText } : {}),
          promoId,
        },
        select: { id: true },
      });
      await sight(tx, promoId, best.url, isFirst);
      return landing.id;
    });
    if (best.html) {
      const key = await storeSnapshot(landingId, best.html);
      if (key) await ispyDb((tx) => tx.ispyLandingPage.update({ where: { id: landingId }, data: { snapshotKey: key } }));
    }
    return "DONE";
  } catch (error) {
    await ispyDb((tx) => tx.ispyEmail.update({ where: { id: email.id }, data: { promoScanStatus: "FAILED", promoScanError: error instanceof Error ? error.message.slice(0, 500) : "failed" } }));
    return "FAILED";
  }
}

/** Merge promo `fromId` into `intoId` (staff "duplicate"): sightings, aliases and emails move. */
export async function mergePromos(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  await ispyDb(async (tx) => {
    const from = await tx.ispyPromo.findUnique({ where: { id: fromId }, select: { canonicalKey: true, contentKey: true } });
    if (!from) return;
    const sightings = await tx.ispyPromoSighting.findMany({ where: { promoId: fromId } });
    for (const s of sightings) {
      await tx.ispyPromoSighting.upsert({ where: { promoId_emailId: { promoId: intoId, emailId: s.emailId } }, create: { ...s, id: undefined, promoId: intoId, isFirstEver: false }, update: {} });
    }
    await tx.ispyPromoSighting.deleteMany({ where: { promoId: fromId } });
    await tx.ispyPromoAlias.updateMany({ where: { promoId: fromId }, data: { promoId: intoId } });
    await tx.ispyPromoAlias.createMany({ data: [{ key: `url:${from.canonicalKey}`, promoId: intoId, source: "MERGE" }, ...(from.contentKey ? [{ key: `content:${from.contentKey}`, promoId: intoId, source: "MERGE" }] : [])], skipDuplicates: true });
    await tx.ispyEmail.updateMany({ where: { promoId: fromId }, data: { promoId: intoId } });
    await tx.ispyCopy.updateMany({ where: { promoId: fromId }, data: { promoId: intoId } });
    await tx.ispyLandingPage.updateMany({ where: { promoId: fromId }, data: { promoId: intoId } });
    await tx.ispyPromo.update({ where: { id: fromId }, data: { mergedIntoId: intoId } });
    await refreshPromoCounters(tx, intoId);
  });
}

/** Staff "not a promo": block its URL and content keys so future mail skips it, and detach it. */
export async function blockPromo(promoId: string, actorId: string | null): Promise<void> {
  await ispyDb(async (tx) => {
    const promo = await tx.ispyPromo.findUnique({ where: { id: promoId }, select: { canonicalKey: true, contentKey: true, headline: true, landingUrl: true } });
    if (!promo) return;
    const label = (promo.headline ?? promo.landingUrl).slice(0, 300);
    const keys = [`url:${promo.canonicalKey}`, ...(promo.contentKey ? [`content:${promo.contentKey}`] : [])];
    await tx.ispyPromoBlock.createMany({ data: keys.map((matchKey) => ({ matchKey, label, createdById: actorId })), skipDuplicates: true });
    await tx.ispyEmail.updateMany({ where: { promoId }, data: { promoId: null, promoScanStatus: "NO_PROMO" } });
    await tx.ispyCopy.updateMany({ where: { promoId }, data: { promoId: null } });
    await tx.ispyLandingPage.updateMany({ where: { promoId }, data: { promoId: null } });
    await tx.ispyPromo.delete({ where: { id: promoId } });
  });
}

/** Every pending email, a batch at a time (the hourly promo scan). */
export async function scanPendingPromos(limit = 60): Promise<{ scanned: number; found: number }> {
  const pending = await ispyDb((tx) => tx.ispyEmail.findMany({ where: { promoScanStatus: { in: ["PENDING"] } }, select: { id: true }, orderBy: { receivedAt: "asc" }, take: limit }));
  let found = 0;
  for (const row of pending) if ((await scanEmailPromo(row.id)) === "DONE") found += 1;
  return { scanned: pending.length, found };
}

