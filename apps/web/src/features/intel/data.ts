import { tenantDb, type Prisma } from "@pubcommand/db";
import type { EmailExtraction, EmailLink, RadarNarrative, RadarSummary } from "../../../../../modules/intel/index";
import { isStale } from "./server";

const UUID = /^[0-9a-f-]{36}$/i;

export type InboxFilters = { competitor: string; type: string; from: string; to: string; q: string; expert: string; list: string; topic: string; page: number };

export const PAGE_SIZE = 50;

export function readFilters(search: Record<string, string | undefined>): InboxFilters {
  const day = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
  return {
    competitor: (search.competitor ?? "").slice(0, 40),
    type: (search.type ?? "").slice(0, 30),
    from: day(search.from),
    to: day(search.to),
    q: (search.q ?? "").trim().slice(0, 120),
    expert: UUID.test(search.expert ?? "") ? search.expert! : "",
    list: UUID.test(search.list ?? "") ? search.list! : "",
    topic: UUID.test(search.topic ?? "") ? search.topic! : "",
    page: Math.max(1, Math.min(500, Number(search.page) || 1)),
  };
}

/** The Prisma filter for the inbox (also used by the CSV export). */
export function inboxWhere(brandId: string, filters: Omit<InboxFilters, "page">): Prisma.IntelEmailWhereInput {
  const where: Prisma.IntelEmailWhereInput = { brandId, deletedAt: null };
  if (filters.competitor === "none") where.competitorId = null;
  else if (UUID.test(filters.competitor)) where.competitorId = filters.competitor;
  if (filters.type === "unclassified") where.emailType = null;
  else if (filters.type) where.emailType = filters.type;
  if (filters.from || filters.to) {
    where.receivedAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
      ...(filters.to ? { lt: new Date(new Date(`${filters.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
    };
  }
  if (filters.q) {
    where.OR = [
      { subject: { contains: filters.q, mode: "insensitive" } },
      { fromAddress: { contains: filters.q, mode: "insensitive" } },
      { fromName: { contains: filters.q, mode: "insensitive" } },
      { textBody: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  const entityIds = [filters.expert, filters.list, filters.topic].filter(Boolean);
  if (entityIds.length) where.AND = entityIds.map((entityId) => ({ entityRefs: { some: { entityId } } }));
  return where;
}

export async function listInbox(organizationId: string, brandId: string, filters: InboxFilters) {
  const where = inboxWhere(brandId, filters);
  const db = tenantDb(organizationId);
  const [total, rows] = await Promise.all([
    db.intelEmail.count({ where }),
    db.intelEmail.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        subject: true,
        fromName: true,
        fromAddress: true,
        receivedAt: true,
        snippet: true,
        emailType: true,
        extractionStatus: true,
        updatedAt: true,
        source: true,
        placement: true,
        competitor: { select: { id: true, name: true } },
      },
    }),
  ]);
  return {
    total,
    rows: rows.map((row) => ({ ...row, extractionStatus: isStale(row.extractionStatus, row.updatedAt) ? "FAILED" : row.extractionStatus })),
  };
}

export async function inboxCounts(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const [emails, queued, running, unmatched] = await Promise.all([
    db.intelEmail.count({ where: { brandId, deletedAt: null } }),
    db.intelEmail.count({ where: { brandId, deletedAt: null, extractionStatus: "QUEUED" } }),
    db.intelEmail.count({ where: { brandId, deletedAt: null, extractionStatus: "RUNNING", updatedAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } }),
    db.intelEmail.count({ where: { brandId, deletedAt: null, competitorId: null } }),
  ]);
  return { emails, queued, running, unmatched };
}

export async function listCompetitors(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const competitors = await db.intelCompetitor.findMany({ where: { brandId, deletedAt: null }, orderBy: { name: "asc" } });
  const counts = await Promise.all(
    competitors.map((competitor) =>
      Promise.all([
        db.intelEmail.count({ where: { brandId, competitorId: competitor.id, deletedAt: null } }),
        db.intelEmail.findFirst({ where: { brandId, competitorId: competitor.id, deletedAt: null }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
      ]),
    ),
  );
  return competitors.map((competitor, index) => ({ ...competitor, emailCount: counts[index]![0], lastEmailAt: counts[index]![1]?.receivedAt ?? null }));
}

export async function competitorOptions(organizationId: string, brandId: string) {
  return tenantDb(organizationId).intelCompetitor.findMany({ where: { brandId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function loadCompetitor(organizationId: string, brandId: string, competitorId: string) {
  if (!UUID.test(competitorId)) return null;
  return tenantDb(organizationId).intelCompetitor.findFirst({ where: { id: competitorId, brandId, deletedAt: null } });
}

/** Sender domains in the inbox that no competitor claims yet, most frequent first. */
export async function unmatchedSenders(organizationId: string, brandId: string) {
  const rows = await tenantDb(organizationId).intelEmail.findMany({
    where: { brandId, deletedAt: null, competitorId: null },
    select: { fromAddress: true, fromName: true },
    orderBy: { receivedAt: "desc" },
    take: 2000,
  });
  const byDomain = new Map<string, { domain: string; count: number; names: Set<string> }>();
  for (const row of rows) {
    const domain = (row.fromAddress.split("@")[1] ?? "").toLowerCase();
    if (!domain) continue;
    const entry = byDomain.get(domain) ?? { domain, count: 0, names: new Set<string>() };
    entry.count += 1;
    if (row.fromName) entry.names.add(row.fromName);
    byDomain.set(domain, entry);
  }
  return [...byDomain.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((entry) => ({ domain: entry.domain, count: entry.count, names: [...entry.names].slice(0, 3) }));
}

export async function loadEmail(organizationId: string, brandId: string, emailId: string) {
  if (!UUID.test(emailId)) return null;
  const db = tenantDb(organizationId);
  const email = await db.intelEmail.findFirst({
    where: { id: emailId, brandId, deletedAt: null },
    select: {
      id: true,
      subject: true,
      fromName: true,
      fromAddress: true,
      toAddress: true,
      receivedAt: true,
      htmlBody: true,
      textBody: true,
      links: true,
      landingUrl: true,
      placement: true,
      source: true,
      rawSize: true,
      emailType: true,
      extractionStatus: true,
      extractionError: true,
      extraction: true,
      extractionModel: true,
      extractedAt: true,
      analyzerPromoId: true,
      landingPageId: true,
      matchedBy: true,
      updatedAt: true,
      competitorId: true,
      competitor: { select: { id: true, name: true } },
      gmailAccount: { select: { email: true } },
    },
  });
  if (!email) return null;
  const stale = isStale(email.extractionStatus, email.updatedAt);
  const promo = email.analyzerPromoId
    ? await db.promo.findFirst({ where: { id: email.analyzerPromoId, deletedAt: null }, select: { id: true, analysisStatus: true, effectivenessScore: true } })
    : null;
  return {
    ...email,
    links: (email.links as unknown as EmailLink[]) ?? [],
    extraction: (email.extraction as unknown as EmailExtraction | null) ?? null,
    extractionStatus: stale ? "FAILED" : email.extractionStatus,
    extractionError: stale ? "The extraction was interrupted (the server restarted). Run it again." : email.extractionError,
    promo,
  };
}

export type LoadedEmail = NonNullable<Awaited<ReturnType<typeof loadEmail>>>;

export async function listRadarWeeks(organizationId: string, brandId: string) {
  return tenantDb(organizationId).intelRadarDigest.findMany({
    where: { brandId },
    orderBy: { weekStart: "desc" },
    take: 26,
    select: { id: true, weekStart: true, status: true, updatedAt: true },
  });
}

export async function loadRadar(organizationId: string, brandId: string, weekStart: Date) {
  const digest = await tenantDb(organizationId).intelRadarDigest.findFirst({ where: { brandId, weekStart } });
  if (!digest) return null;
  const stale = isStale(digest.status, digest.updatedAt);
  return {
    ...digest,
    status: stale ? "FAILED" : digest.status,
    error: stale ? "The radar was interrupted (the server restarted). Build it again." : digest.error,
    summary: digest.summary as unknown as RadarSummary,
    narrative: (digest.narrative as unknown as RadarNarrative | null) ?? null,
  };
}

export async function listGmailAccounts(organizationId: string, brandId: string) {
  return tenantDb(organizationId).intelGmailAccount.findMany({
    where: { brandId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, query: true, syncStatus: true, lastSyncAt: true, lastSyncError: true, lastSyncAdded: true, historyId: true, createdAt: true, updatedAt: true },
  });
}
