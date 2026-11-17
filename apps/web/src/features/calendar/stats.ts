import { tenantDb, type Prisma } from "@pubcommand/db";
import { fromDay, toDay } from "../../../../../modules/editorial/dates";
import { labelKey, matchStats, parseCsv, parseStatRows, STAT_FIELDS, type ColumnMapping, type ListMappings, type RateFormat } from "../../../../../modules/editorial/stats";

/** The brand's saved list label → publication code mappings ("" = ignore the list). */
export async function loadListMappings(organizationId: string, brandId: string): Promise<ListMappings> {
  const rows = await tenantDb(organizationId).calendarListMapping.findMany({ where: { brandId }, select: { labelKey: true, pubCode: true }, take: 5000 });
  return new Map(rows.map((r) => [r.labelKey, r.pubCode]));
}

/** Remember how a list label maps (create or replace). */
export async function saveListMapping(input: { organizationId: string; brandId: string; label: string; pubCode: string; actorId: string | null }): Promise<string> {
  const db = tenantDb(input.organizationId);
  const key = labelKey(input.label);
  const existing = await db.calendarListMapping.findFirst({ where: { brandId: input.brandId, labelKey: key }, select: { id: true } });
  if (existing) {
    await db.calendarListMapping.updateMany({ where: { id: existing.id }, data: { label: input.label.trim().slice(0, 200), pubCode: input.pubCode } });
    return existing.id;
  }
  const row = await db.calendarListMapping.create({
    data: { organizationId: input.organizationId, brandId: input.brandId, labelKey: key, label: input.label.trim().slice(0, 200), pubCode: input.pubCode, createdById: input.actorId },
    select: { id: true },
  });
  return row.id;
}

export function mappingFromForm(formData: FormData, columns: number): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const f of STAT_FIELDS) {
    const raw = String(formData.get(`map_${f.key}`) ?? "");
    const n = Number(raw);
    if (raw !== "" && Number.isInteger(n) && n >= 0 && n < columns) mapping[f.key] = n;
  }
  return mapping;
}

/** Parse, match and store one CSV of send stats. Each matched issue gets its stats replaced. */
export async function importStats(input: {
  organizationId: string;
  brandId: string;
  actorId: string | null;
  filename: string;
  csv: string;
  mapping: ColumnMapping;
  rateFormat: RateFormat;
}) {
  const db = tenantDb(input.organizationId);
  const rows = parseCsv(input.csv);
  const parsed = parseStatRows(rows, input.mapping, input.rateFormat);
  const days = parsed.map((r) => r.mailDate).filter((d): d is string => Boolean(d)).sort();
  const [issues, publications, mappings] = await Promise.all([
    days.length
      ? db.calendarIssue.findMany({
          where: { brandId: input.brandId, deletedAt: null, mailDate: { gte: fromDay(days[0])!, lte: fromDay(days[days.length - 1])! } },
          select: { id: true, publicationCode: true, mailDate: true, title: true, subjectLines: true },
        })
      : Promise.resolve([]),
    db.calendarPublication.findMany({ where: { brandId: input.brandId }, select: { code: true, name: true } }),
    loadListMappings(input.organizationId, input.brandId),
  ]);
  const { matches, unmatched } = matchStats(
    parsed,
    issues.map((i) => ({ ...i, mailDate: toDay(i.mailDate) })),
    publications,
    mappings,
  );
  const record = await db.calendarStatImport.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brandId,
      filename: input.filename.slice(0, 200),
      rowsParsed: parsed.length,
      matched: matches.length,
      unmatched: unmatched.length,
      unmatchedRows: unmatched.slice(0, 500) as unknown as Prisma.InputJsonValue,
      mapping: { ...input.mapping, rateFormat: input.rateFormat } as Prisma.InputJsonValue,
      createdById: input.actorId,
    },
    select: { id: true },
  });
  for (const m of matches) {
    const data = {
      importId: record.id,
      listLabel: m.row.list.slice(0, 200) || null,
      pubCode: m.pubCode,
      mailDate: fromDay(m.row.mailDate),
      subject: m.row.subject.slice(0, 300) || null,
      delivered: m.row.delivered,
      openRate: m.row.openRate,
      clickRate: m.row.clickRate,
      clickToOpen: m.row.clickToOpen,
      revenue: m.row.revenue,
      totalOpened: m.row.totalOpened,
      totalClicked: m.row.totalClicked,
      unsubscribes: m.row.unsubscribes,
      complaints: m.row.complaints,
    };
    const existing = await db.calendarSendStat.findFirst({ where: { issueId: m.issueId }, select: { id: true } });
    if (existing) await db.calendarSendStat.updateMany({ where: { id: existing.id }, data });
    else await db.calendarSendStat.create({ data: { organizationId: input.organizationId, issueId: m.issueId, ...data } });
  }
  return { id: record.id, matchedIssueIds: matches.map((m) => m.issueId), matched: matches.length, unmatched: unmatched.length, rows: parsed.length };
}
