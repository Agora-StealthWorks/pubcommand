import { PrismaClient, type Prisma } from "@pubcommand/db";
import { encryptToken, htmlToText, extractLinks, snippetOf } from "../../../../../modules/intel/index";
import { canonListName, normalizeCopyExtraction } from "../../../../../modules/ispy/index";
import { authSecret } from "../intel/gmail";
import { decideCopyType, syncCopyNote } from "./brain";
import { ispyDb } from "./db";
import { attachCopy, refreshCopyCounters } from "./ingest";
import { refreshPromoCounters } from "./promos";

/**
 * One-time import of the old iSpy Finpub database (ISPY_LEGACY_DATABASE_URL, read only)
 * into the FinPub feed. Idempotent: every row is keyed by its iSpy id (legacyId), so a
 * second run adds nothing. A dry run only counts. No AI: iSpy's own summaries,
 * topics, gurus and offers become each copy's extraction.
 */
export type ImportReport = { dryRun: boolean; startedAt: string; finishedAt?: string; counts: Record<string, { source: number; added: number }>; notes: string[]; error?: string };

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const TYPE_MAP: Record<string, string> = { INTERNAL: "INTERNAL", COMPETITOR: "COMPETITOR", AFFILIATE_MARKETER: "AFFILIATE", UNKNOWN: "UNKNOWN" };
const EMAIL_TYPE_MAP: Record<string, string> = { PROMO: "PROMO", EDITORIAL: "EDITORIAL", WELCOME: "WELCOME", LIFT_NOTE: "EXTERNAL_LIFT", UNKNOWN: "OTHER" };
/** iSpy's affiliate seed inbox (lib/affiliate-seeds.ts). */
const AFFILIATE_SEEDS: Record<string, string> = { "markusjeat@gmail.com": "MarketBeat" };

export async function importLegacyIspy(options: { dryRun: boolean; databaseUrl?: string; emailLimit?: number; log?: (m: string) => void }): Promise<ImportReport> {
  const report: ImportReport = { dryRun: options.dryRun, startedAt: new Date().toISOString(), counts: {}, notes: [] };
  const url = options.databaseUrl ?? process.env.ISPY_LEGACY_DATABASE_URL;
  if (!url) return { ...report, error: "ISPY_LEGACY_DATABASE_URL is not set." };
  const legacy = new PrismaClient({ datasources: { db: { url } } });
  const q = <T = Row>(sql: string) => legacy.$queryRawUnsafe<T[]>(sql);
  const count = (name: string, source: number) => (report.counts[name] = { source, added: 0 });
  const add = (name: string) => (report.counts[name]!.added += 1);
  const log = options.log ?? (() => undefined);
  try {
    const [publishers, lists, gurus, guruLists, topics, gmail, advertisers, promos, blocks] = await Promise.all([
      q(`SELECT * FROM "Publisher"`),
      q(`SELECT * FROM "List"`),
      q(`SELECT * FROM "Guru"`),
      q(`SELECT * FROM "GuruList"`),
      q(`SELECT * FROM "Topic"`),
      q(`SELECT id, email, "accessToken", "refreshToken", "tokenExpiry", "historyId", "lastSyncAt", "isActive" FROM "GmailAccount"`),
      q(`SELECT * FROM "PromoAdvertiser"`),
      q(`SELECT * FROM "Promo"`),
      q(`SELECT * FROM "PromoBlock"`),
    ]);
    const [{ n: emailTotal }] = await q<{ n: bigint }>(`SELECT COUNT(*)::bigint AS n FROM "Email"`);
    count("publishers", publishers.length);
    count("lists", lists.length);
    count("publications", 0);
    count("gurus", gurus.length);
    count("topics", topics.length);
    count("inboxes", gmail.length);
    count("advertisers", advertisers.length);
    count("promos", promos.length);
    count("blocks", blocks.length);
    count("emails", Number(emailTotal));
    count("sightings", 0);
    if (options.dryRun) {
      const [{ n: sightings }] = await q<{ n: bigint }>(`SELECT COUNT(*)::bigint AS n FROM "PromoSighting"`);
      report.counts.sightings!.source = Number(sightings);
      report.notes.push("Dry run: nothing was written. Publications are created from lists (one per masthead; a list whose name starts with another list's name joins its publication).");
      return { ...report, finishedAt: new Date().toISOString() };
    }

    // ── Registry ──────────────────────────────────────────────────────────
    const pubId = new Map<string, string>();
    for (const p of publishers) {
      const legacyId = String(p.id);
      const existing = await ispyDb((tx) => tx.ispyPublisher.findUnique({ where: { legacyId }, select: { id: true } }));
      if (existing) {
        pubId.set(legacyId, existing.id);
        continue;
      }
      const type = TYPE_MAP[String(p.type)] ?? "COMPETITOR";
      const created = await ispyDb((tx) =>
        tx.ispyPublisher.create({
          data: { legacyId, feed: "FINPUB", name: String(p.name), type, domains: arr(p.domains), fromAddresses: arr(p.knownFromAddresses).map((a) => a.toLowerCase()), website: s(p.website), notes: s(p.notes), isConfirmed: p.isConfirmed === true, excludeBrands: type === "AFFILIATE" ? [canonListName(String(p.name)).replace(/\s+/g, "")] : [] },
          select: { id: true },
        }),
      );
      pubId.set(legacyId, created.id);
      add("publishers");
    }
    let unassigned: string | null = null;
    const unassignedPublisher = async () => {
      if (unassigned) return unassigned;
      const row = await ispyDb(async (tx) => (await tx.ispyPublisher.findFirst({ where: { legacyId: "ispy:unassigned" }, select: { id: true } })) ?? tx.ispyPublisher.create({ data: { legacyId: "ispy:unassigned", name: "Unassigned (from iSpy)", type: "UNKNOWN", feed: "FINPUB" }, select: { id: true } }));
      unassigned = row.id;
      return unassigned;
    };

    // Lists, grouped into publications: one per masthead; "Trade of the Day Wakeup Watchlist" joins "Trade of the Day".
    const listId = new Map<string, string>();
    const sortedLists = [...lists].sort((a, b) => String(a.name).length - String(b.name).length);
    const publicationsByPublisher = new Map<string, { id: string; key: string }[]>();
    for (const l of sortedLists) {
      const legacyId = String(l.id);
      const existing = await ispyDb((tx) => tx.ispyList.findUnique({ where: { legacyId }, select: { id: true } }));
      if (existing) {
        listId.set(legacyId, existing.id);
        continue;
      }
      const publisherId = l.publisherId ? pubId.get(String(l.publisherId)) ?? (await unassignedPublisher()) : await unassignedPublisher();
      const publisherType = publishers.find((p) => String(p.id) === String(l.publisherId))?.type;
      const isAffiliateFile = String(l.category) === "MARKETING_FILE" && publisherType === "AFFILIATE_MARKETER";
      let publicationId: string | null = null;
      if (!isAffiliateFile) {
        const key = canonListName(String(l.name));
        const known = publicationsByPublisher.get(publisherId) ?? [];
        const parent = known.find((p) => key === p.key || key.startsWith(`${p.key} `));
        if (parent) publicationId = parent.id;
        else {
          const created = await ispyDb((tx) => tx.ispyPublication.create({ data: { publisherId, name: String(l.name) }, select: { id: true } }));
          publicationId = created.id;
          known.push({ id: created.id, key });
          publicationsByPublisher.set(publisherId, known);
          add("publications");
        }
      }
      const created = await ispyDb((tx) =>
        tx.ispyList.create({
          data: { legacyId, publisherId, publicationId, name: String(l.name), category: String(l.category ?? "FREE_EDITORIAL"), synonyms: arr(l.synonyms), isIgnored: l.isIgnored === true, editorialPubCode: s(l.editorialPubCode), dedicatedPubCode: s(l.dedicatedPubCode), notes: s(l.notes) },
          select: { id: true },
        }),
      );
      listId.set(legacyId, created.id);
      add("lists");
    }

    const guruId = new Map<string, string>();
    for (const g of gurus) {
      const legacyId = String(g.id);
      const existing = await ispyDb((tx) => tx.ispyGuru.findUnique({ where: { legacyId }, select: { id: true } }));
      if (existing) {
        guruId.set(legacyId, existing.id);
        continue;
      }
      const created = await ispyDb((tx) =>
        tx.ispyGuru.upsert({
          where: { feed_name: { feed: "FINPUB", name: String(g.name) } },
          create: { legacyId, feed: "FINPUB", name: String(g.name), notes: s(g.notes), isIgnored: g.isIgnored === true, isSecondaryVoice: g.isSecondaryVoice === true, publisherId: g.publisherId ? pubId.get(String(g.publisherId)) ?? null : null },
          update: { legacyId },
          select: { id: true },
        }),
      );
      guruId.set(legacyId, created.id);
      add("gurus");
    }
    const [secondaryPubs, secondaryVoices] = await Promise.all([q(`SELECT * FROM "GuruSecondaryPublisher"`).catch(() => []), q(`SELECT * FROM "SecondaryVoiceGuru"`).catch(() => [])]);
    await ispyDb(async (tx) => {
      for (const [legacy, id] of guruId) {
        const secondary = secondaryPubs.filter((r) => String(r.guruId) === legacy).map((r) => pubId.get(String(r.publisherId))).filter((x): x is string => !!x);
        const primaries = secondaryVoices.filter((r) => String(r.secondaryVoiceId) === legacy).map((r) => guruId.get(String(r.primaryGuruId))).filter((x): x is string => !!x);
        if (secondary.length || primaries.length) await tx.ispyGuru.update({ where: { id }, data: { secondaryPublisherIds: secondary, primaryGuruIds: primaries } });
      }
      for (const gl of guruLists) {
        const g = guruId.get(String(gl.guruId));
        const l = listId.get(String(gl.listId));
        if (!g || !l) continue;
        await tx.ispyGuruList.upsert({ where: { guruId_listId: { guruId: g, listId: l } }, create: { guruId: g, listId: l, isPrimary: gl.isPrimary === true, isIgnored: gl.isIgnored === true }, update: {} });
        const list = await tx.ispyList.findUnique({ where: { id: l }, select: { publicationId: true } });
        if (list?.publicationId && gl.isIgnored !== true) await tx.ispyGuruPublication.upsert({ where: { guruId_publicationId: { guruId: g, publicationId: list.publicationId } }, create: { guruId: g, publicationId: list.publicationId, role: gl.isPrimary === true ? "lead" : "contributor" }, update: {} });
      }
    }, { timeout: 120_000 });

    for (const t of topics) {
      await ispyDb((tx) => tx.ispyTopic.upsert({ where: { feed_name: { feed: "FINPUB", name: String(t.name).toLowerCase() } }, create: { legacyId: String(t.id), feed: "FINPUB", name: String(t.name).toLowerCase(), synonyms: arr(t.synonyms), isIgnored: t.isIgnored === true, isSecondary: t.isSecondary === true }, update: {} }));
      add("topics");
    }

    // Legacy Gmail inboxes, with their tokens (same Google client as iSpy → no reconnect).
    const inboxByAccount = new Map<string, string>();
    const secret = authSecret();
    for (const a of gmail) {
      const address = String(a.email).toLowerCase();
      const seed = AFFILIATE_SEEDS[address];
      const seedPublisherId = seed ? (await ispyDb((tx) => tx.ispyPublisher.findFirst({ where: { name: seed, type: "AFFILIATE" }, select: { id: true } })))?.id ?? null : null;
      const seedListId = seedPublisherId ? (await ispyDb((tx) => tx.ispyList.findFirst({ where: { publisherId: seedPublisherId, category: "MARKETING_FILE" }, select: { id: true } })))?.id ?? null : null;
      const row = await ispyDb((tx) =>
        tx.ispyInbox.upsert({
          where: { address },
          create: {
            provider: "GMAIL_LEGACY",
            level: "LEGACY",
            address,
            feed: "FINPUB",
            affiliateSeed: !!seed,
            publisherId: seedPublisherId,
            listId: seedListId,
            status: a.isActive === false ? "RETIRED" : "ACTIVE",
            refreshTokenEnc: a.refreshToken ? encryptToken(String(a.refreshToken), secret) : null,
            accessTokenEnc: a.accessToken ? encryptToken(String(a.accessToken), secret) : null,
            tokenExpiresAt: a.tokenExpiry ? new Date(String(a.tokenExpiry)) : null,
            historyId: s(a.historyId),
            lastSyncAt: a.lastSyncAt ? new Date(String(a.lastSyncAt)) : null,
          },
          update: {},
          select: { id: true },
        }),
      );
      inboxByAccount.set(address, row.id);
      add("inboxes");
    }

    // Promos (before emails so sightings can attach).
    const advertiserId = new Map<string, string>();
    for (const a of advertisers) {
      const domain = String(a.domain).toLowerCase();
      const row = await ispyDb((tx) =>
        tx.ispyAdvertiser.upsert({ where: { domain }, create: { domain, label: String(a.label), labelConfirmed: a.labelConfirmed === true, isPlatform: a.isPlatform === true, publisherId: a.publisherId ? pubId.get(String(a.publisherId)) ?? null : null }, update: {}, select: { id: true } }),
      );
      advertiserId.set(String(a.id), row.id);
      add("advertisers");
    }
    const promoId = new Map<string, string>();
    for (const p of promos) {
      const legacyId = String(p.id);
      const adv = advertiserId.get(String(p.advertiserId));
      if (!adv) continue;
      const existing = await ispyDb((tx) => tx.ispyPromo.findFirst({ where: { OR: [{ legacyId }, { canonicalKey: String(p.canonicalKey) }] }, select: { id: true } }));
      if (existing) {
        promoId.set(legacyId, existing.id);
        continue;
      }
      const created = await ispyDb(async (tx) => {
        const row = await tx.ispyPromo.create({
          data: {
            legacyId,
            feed: "FINPUB",
            canonicalKey: String(p.canonicalKey),
            contentKey: s(p.contentKey),
            landingUrl: String(p.landingUrl),
            landingHost: String(p.landingHost),
            advertiserId: adv,
            advertiserLabel: s(p.advertiserLabel),
            headline: s(p.headline),
            headlineSource: s(p.headlineSource),
            kind: String(p.kind ?? "VSL"),
            lastStatus: typeof p.lastStatus === "number" ? p.lastStatus : null,
            firstSeenOn: new Date(String(p.firstSeenOn)),
            lastSeenOn: new Date(String(p.lastSeenOn)),
            daysDetected: Number(p.daysDetected ?? 1),
          },
          select: { id: true },
        });
        await tx.ispyPromoAlias.createMany({ data: [{ key: `url:${String(p.canonicalKey)}`, promoId: row.id, source: "URL" }, ...(p.contentKey ? [{ key: `content:${String(p.contentKey)}`, promoId: row.id, source: "CONTENT" }] : [])], skipDuplicates: true });
        return row;
      });
      promoId.set(legacyId, created.id);
      add("promos");
    }
    await ispyDb((tx) => tx.ispyPromoBlock.createMany({ data: blocks.map((b) => ({ matchKey: String(b.matchKey), label: s(b.label) })), skipDuplicates: true }));
    report.counts.blocks!.added = blocks.length;

    // ── Emails, in pages ─────────────────────────────────────────────────
    const listPublication = new Map((await ispyDb((tx) => tx.ispyList.findMany({ select: { id: true, publicationId: true } }))).map((l) => [l.id, l.publicationId]));
    const publisherType = new Map((await ispyDb((tx) => tx.ispyPublisher.findMany({ select: { id: true, type: true } }))).map((p) => [p.id, p.type]));
    const touchedCopies = new Set<string>();
    let cursor = "";
    const limit = options.emailLimit ?? Number.MAX_SAFE_INTEGER;
    let processed = 0;
    while (processed < limit) {
      const page = await q(
        `SELECT e.*, (SELECT json_agg(t.name) FROM "EmailTopic" et JOIN "Topic" t ON t.id = et."topicId" WHERE et."emailId" = e.id) AS topic_names,
                (SELECT json_agg(g.name) FROM "EmailGuru" eg JOIN "Guru" g ON g.id = eg."guruId" WHERE eg."emailId" = e.id) AS guru_names,
                (SELECT row_to_json(o) FROM "Offer" o WHERE o."emailId" = e.id) AS offer,
                (SELECT row_to_json(a) FROM "EmailAnalysis" a WHERE a."emailId" = e.id) AS analysis
         FROM "Email" e WHERE e.id > '${cursor.replace(/'/g, "")}' ORDER BY e.id ASC LIMIT 200`,
      );
      if (!page.length) break;
      for (const e of page) {
        cursor = String(e.id);
        processed += 1;
        const legacyId = String(e.id);
        const dedupeKey = `gmail:${String(e.gmailMessageId)}`;
        const done = await ispyDb((tx) => tx.ispyEmail.findFirst({ where: { OR: [{ legacyId }, { dedupeKey }] }, select: { id: true } }));
        if (done) continue;
        const to = String(e.toEmail ?? "").toLowerCase();
        const inboxId = [...inboxByAccount.entries()].find(([addr]) => to.includes(addr))?.[1] ?? [...inboxByAccount.values()][0] ?? null;
        const isSeed = [...inboxByAccount.keys()].some((addr) => to.includes(addr) && AFFILIATE_SEEDS[addr]);
        const publisherId = e.publisherId ? pubId.get(String(e.publisherId)) ?? null : null;
        const list = e.listId ? listId.get(String(e.listId)) ?? null : null;
        const pType = publisherId ? publisherType.get(publisherId) ?? null : null;
        const sendKind = isSeed || pType === "AFFILIATE" ? "AFFILIATE" : pType === "INTERNAL" ? "INTERNAL" : "EXTERNAL";
        const html = s(e.bodyHtml);
        const text = s(e.bodyText) || (html ? htmlToText(html) : "");
        const receivedAt = new Date(String(e.receivedAt));
        const topicsList = arr(e.topic_names).map((t) => t.toLowerCase());
        const guruList = arr(e.guru_names);
        const offer = (e.offer ?? null) as Row | null;
        const analysis = (e.analysis ?? null) as Row | null;
        await ispyDb(
          async (tx) => {
            const copy = await attachCopy(tx, { feed: "FINPUB", text, subject: String(e.subject), receivedAt, listId: list, sendKind, campaignId: null, publisherId });
            if (copy.newCopy) {
              const extraction = normalizeCopyExtraction({
                typeHint: e.emailType === "LIFT_NOTE" ? "lift" : String(e.emailType ?? "other").toLowerCase(),
                headline: null,
                takeaways: e.aiSummary ? [String(e.aiSummary)] : [],
                offer: { product: s(offer?.promise), priceText: null, discount: null, guarantee: null, cta: null },
                topics: topicsList,
                gurus: guruList,
                promotedBrand: null,
                promotedGuru: null,
                hasEdNote: false,
                listName: null,
              });
              await tx.ispyCopy.update({
                where: { id: copy.copyId },
                data: { extraction: extraction as unknown as Prisma.InputJsonValue, extractionStatus: "DONE", emailType: EMAIL_TYPE_MAP[String(e.emailType)] ?? "OTHER", ...(analysis?.rawJson ? { deepAnalysis: analysis.rawJson as Prisma.InputJsonValue } : {}) },
              });
            }
            await tx.ispyEmail.create({
              data: {
                legacyId,
                feed: "FINPUB",
                dedupeKey,
                inboxId,
                receivedInboxId: inboxId,
                providerMessageId: s(e.gmailMessageId),
                publisherId,
                publicationId: list ? listPublication.get(list) ?? null : null,
                listId: list,
                routeStatus: list ? "ROUTED" : "UNSORTED",
                routeReason: "Imported from iSpy with its list and publisher.",
                sendKind,
                emailType: EMAIL_TYPE_MAP[String(e.emailType)] ?? "OTHER",
                subject: String(e.subject).slice(0, 500),
                fromName: s(e.fromName),
                fromAddress: String(e.fromEmail).toLowerCase(),
                toAddress: s(e.toEmail),
                receivedAt,
                htmlBody: html,
                textBody: text,
                snippet: s(e.snippet) ?? snippetOf(text),
                links: extractLinks(html, text) as unknown as Prisma.InputJsonValue,
                placement: s(e.inboxPlacement),
                copyId: copy.copyId,
                copyMatch: copy.how,
                topics: topicsList,
                gurus: guruList,
                promoScanStatus: "DONE",
              },
            });
            touchedCopies.add(copy.copyId);
          },
          { timeout: 60_000 },
        );
        add("emails");
      }
      log(`emails: ${processed}`);
    }

    // Sightings → emails and promos.
    const sightings = await q(`SELECT * FROM "PromoSighting"`);
    report.counts.sightings!.source = sightings.length;
    const touchedPromos = new Set<string>();
    for (let i = 0; i < sightings.length; i += 500) {
      const chunk = sightings.slice(i, i + 500);
      await ispyDb(
        async (tx) => {
          const emails = await tx.ispyEmail.findMany({ where: { legacyId: { in: chunk.map((c) => String(c.emailId)) } }, select: { id: true, legacyId: true, copyId: true, publisherId: true, listId: true, sendKind: true } });
          const byLegacy = new Map(emails.map((e) => [e.legacyId!, e]));
          for (const c of chunk) {
            const email = byLegacy.get(String(c.emailId));
            const promo = promoId.get(String(c.promoId));
            if (!email || !promo) continue;
            await tx.ispyPromoSighting.upsert({
              where: { promoId_emailId: { promoId: promo, emailId: email.id } },
              create: { promoId: promo, emailId: email.id, day: new Date(String(c.day)), publisherId: email.publisherId, listId: email.listId, sendKind: email.sendKind, subject: String(c.subject).slice(0, 500), rawUrl: String(c.rawUrl).slice(0, 2000), isFirstEver: c.isFirstEver === true },
              update: {},
            });
            await tx.ispyEmail.update({ where: { id: email.id }, data: { promoId: promo } });
            if (email.copyId) await tx.ispyCopy.update({ where: { id: email.copyId }, data: { promoId: promo } });
            touchedPromos.add(promo);
            report.counts.sightings!.added += 1;
          }
        },
        { timeout: 120_000 },
      );
    }
    for (const id of touchedPromos) await ispyDb((tx) => refreshPromoCounters(tx, id));
    // Counters, types (old lift notes split into internal / external) and Brain notes. No AI.
    for (const id of touchedCopies) {
      await ispyDb((tx) => refreshCopyCounters(tx, id));
      await decideCopyType(id).catch(() => undefined);
      await syncCopyNote(id).catch(() => undefined);
    }
    report.notes.push(`Copies built from fingerprints: ${touchedCopies.size}.`, "iSpy learnings were not imported: ISpy now writes one note per copy automatically.");
    return { ...report, finishedAt: new Date().toISOString() };
  } catch (error) {
    return { ...report, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Import failed." };
  } finally {
    await legacy.$disconnect().catch(() => undefined);
  }
}
