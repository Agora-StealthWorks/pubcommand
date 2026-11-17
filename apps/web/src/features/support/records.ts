import { rawPrisma, tenantDb, withOrgContext, type Prisma } from "@pubcommand/db";
import { checkContent } from "../../../../../modules/support/gate";
import { chunkText, gateText, publishDecision, validateRecord, type RecordInput } from "../../../../../modules/support/records";
import type { RecordSource } from "../../../../../modules/support/taxonomy";

/**
 * The single write path for Support Knowledge records:
 * validate → forbidden-content gate → revision → save → reindex.
 * Pages, actions, imports, the Brain approval and the Publication Setup sync all go through
 * here, so nothing reaches the search index (or an agent) unchecked.
 */

export type WriteScope = { organizationId: string; brandId: string; actorId: string | null; canPublish: boolean };

export type SaveOptions = {
  source?: RecordSource;
  sourceRef?: string | null;
  sourceHash?: string | null;
  /** A person edited this here: imports and syncs leave it alone from now on. */
  lock?: boolean;
  meta?: Prisma.InputJsonValue;
  /** Pricing: the person confirms this is the current retail list price (needs publish rights). */
  confirmPrice?: boolean;
  note?: string;
};

export type SaveResult = { ok: true; id: string; gateHits: string[]; status: string } | { ok: false; error: string; gateHits?: string[] };

const RECORD_COLUMNS = {
  id: true,
  category: true,
  audience: true,
  status: true,
  title: true,
  body: true,
  summary: true,
  url: true,
  tags: true,
  publicationCodes: true,
  source: true,
  sourceRef: true,
  locked: true,
  meta: true,
  gateHits: true,
  gateOverrides: true,
  priceConfirmedAt: true,
  priceConfirmedById: true,
  updatedAt: true,
} as const;

function snapshot(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

export async function saveRecord(scope: WriteScope, id: string | null, raw: Record<string, unknown>, options: SaveOptions = {}): Promise<SaveResult> {
  const parsed = validateRecord(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const data: RecordInput = parsed.data;
  const db = tenantDb(scope.organizationId);
  const existing = id ? await db.supportRecord.findFirst({ where: { id, brandId: scope.brandId }, select: RECORD_COLUMNS }) : null;
  if (id && !existing) return { ok: false, error: "That record no longer exists." };

  if (data.status === "published" && !scope.canPublish) {
    return { ok: false, error: existing?.status === "published" ? "Only people with publish rights can change a published record. Save your edit as a draft." : "Only people with publish rights can publish. Save it as a draft and ask a publisher." };
  }
  if (!scope.canPublish && existing && data.gateOverrides.join() !== existing.gateOverrides.join()) {
    data.gateOverrides = existing.gateOverrides;
  }

  // A price confirmation lasts only while the price text is unchanged.
  const priceTextSame = existing ? existing.body === data.body && existing.title === data.title : false;
  const confirmNow = data.category === "pricing" && options.confirmPrice === true && scope.canPublish;
  const priceConfirmed = data.category === "pricing" && (confirmNow || (priceTextSame && Boolean(existing?.priceConfirmedAt)));

  const decision = publishDecision(data, { priceConfirmed });
  if (!decision.ok) return { ok: false, error: decision.error, gateHits: decision.gate.hits.map((h) => h.id) };

  const columns = {
    category: data.category,
    audience: data.audience,
    status: data.status,
    title: data.title,
    body: data.body,
    summary: data.summary,
    url: data.url,
    tags: data.tags,
    publicationCodes: data.publicationCodes,
    gateHits: decision.gate.hits.map((h) => h.id),
    gateOverrides: data.gateOverrides,
    priceConfirmedAt: priceConfirmed ? (confirmNow ? new Date() : (existing?.priceConfirmedAt ?? new Date())) : null,
    priceConfirmedById: priceConfirmed ? (confirmNow ? scope.actorId : (existing?.priceConfirmedById ?? null)) : null,
    updatedById: scope.actorId,
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
    ...(options.sourceHash !== undefined ? { sourceHash: options.sourceHash } : {}),
    ...(options.lock !== undefined ? { locked: options.lock } : {}),
  };

  let recordId: string;
  if (existing) {
    await db.supportRevision.create({ data: { organizationId: scope.organizationId, recordId: existing.id, snapshot: snapshot(existing), note: options.note ?? "edit", editedById: scope.actorId } });
    await db.supportRecord.updateMany({ where: { id: existing.id, brandId: scope.brandId }, data: columns });
    recordId = existing.id;
  } else {
    const created = await db.supportRecord.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        ...columns,
        meta: options.meta ?? {},
        source: options.source ?? "manual",
        sourceRef: options.sourceRef ?? null,
        sourceHash: options.sourceHash ?? null,
        locked: options.lock ?? false,
        createdById: scope.actorId,
      },
      select: { id: true },
    });
    recordId = created.id;
  }
  await reindexRecord(scope.organizationId, recordId);
  return { ok: true, id: recordId, gateHits: columns.gateHits, status: data.status };
}

/** Archive (soft delete): agents stop seeing it at once; the revision keeps what it said. */
export async function setRecordStatus(scope: WriteScope, id: string, status: "archived" | "draft"): Promise<boolean> {
  const db = tenantDb(scope.organizationId);
  const existing = await db.supportRecord.findFirst({ where: { id, brandId: scope.brandId }, select: RECORD_COLUMNS });
  if (!existing) return false;
  await db.supportRevision.create({ data: { organizationId: scope.organizationId, recordId: id, snapshot: snapshot(existing), note: status === "archived" ? "archived" : "restored as draft", editedById: scope.actorId } });
  await db.supportRecord.updateMany({ where: { id, brandId: scope.brandId }, data: { status, updatedById: scope.actorId } });
  await reindexRecord(scope.organizationId, id);
  return true;
}

/** Rebuild one record's search passages. Status, category and audience are copied onto each. */
export async function reindexRecord(organizationId: string, recordId: string): Promise<number> {
  return withOrgContext(rawPrisma(), organizationId, async (tx) => {
    await tx.supportChunk.deleteMany({ where: { organizationId, recordId } });
    const record = await tx.supportRecord.findFirst({ where: { id: recordId, organizationId } });
    if (!record || record.status === "archived") return 0;
    const passages = chunkText(`${record.title}\n\n${record.summary ? `${record.summary}\n\n` : ""}${record.body}${record.url && !record.body.includes(record.url) ? `\n\nLink: ${record.url}` : ""}`);
    if (!passages.length) return 0;
    await tx.supportChunk.createMany({
      data: passages.map((content, ord) => ({
        organizationId,
        brandId: record.brandId,
        recordId,
        category: record.category,
        audience: record.audience,
        status: record.status,
        ord,
        title: record.title,
        content,
      })),
    });
    return passages.length;
  });
}

/** For imports and syncs: the gate decides between published and draft instead of failing. */
export function gatedStatus(requested: "published" | "draft" | "archived", text: { title: string; body: string; summary?: string; tags?: string[] }, overrides: string[] = []): { status: "published" | "draft" | "archived"; hits: string[] } {
  const gate = checkContent(gateText({ title: text.title, body: text.body, summary: text.summary ?? "", tags: text.tags ?? [] }), overrides);
  return { status: requested === "published" && !gate.ok ? "draft" : requested, hits: gate.hits.map((h) => h.id) };
}
