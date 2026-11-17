import { tenantDb } from "@pubcommand/db";
import {
  changedValues,
  explainAirtableError,
  fromAirtableFields,
  isRecordId,
  needsPush,
  openToken,
  pullDecision,
  readFieldMap,
  recordsUrl,
  remoteModifiedAt,
  schemaUrl,
  SYNC_FIELDS,
  toAirtableFields,
  type FieldMap,
  type SyncEntity,
} from "../../../../../modules/editorial/airtable";
import { fromDay, toDay } from "../../../../../modules/editorial/dates";

type Fetch = typeof fetch;

export class AirtableError extends Error {}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 16) throw new AirtableError("AUTH_SECRET is not set on the server, so the Airtable token cannot be stored or read.");
  return secret;
}

export type Connection = NonNullable<Awaited<ReturnType<typeof getConnection>>>;

export async function getConnection(organizationId: string, brandId: string) {
  return tenantDb(organizationId).calendarAirtableConnection.findFirst({ where: { brandId } });
}

function tableOf(conn: { eventsTable: string | null; issuesTable: string | null }, entity: SyncEntity): string | null {
  return (entity === "event" ? conn.eventsTable : conn.issuesTable)?.trim() || null;
}

function mapOf(conn: { eventFields: unknown; issueFields: unknown }, entity: SyncEntity): FieldMap {
  return readFieldMap(entity === "event" ? conn.eventFields : conn.issueFields);
}

async function call<T>(token: string, url: string, init: RequestInit, fetcher: Fetch): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string } & T;
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : (body.error?.message ?? "");
    throw new AirtableError(explainAirtableError(response.status, message.slice(0, 200)));
  }
  return body;
}

export type TableSchema = { id: string; name: string; fields: { name: string; type: string }[] };

/** The base's tables and field types (needs the schema.bases:read scope). */
export async function loadSchema(baseId: string, token: string, fetcher: Fetch = fetch): Promise<TableSchema[]> {
  const body = await call<{ tables?: { id: string; name: string; fields: { name: string; type: string }[] }[] }>(token, schemaUrl(baseId), { method: "GET" }, fetcher);
  return (body.tables ?? []).map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => ({ name: f.name, type: f.type })) }));
}

async function log(input: { organizationId: string; brandId: string; direction: "push" | "pull"; entity: SyncEntity; recordId?: string | null; airtableId?: string | null; status: "ok" | "error" | "skipped"; message?: string }) {
  await tenantDb(input.organizationId)
    .calendarSyncLog.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        direction: input.direction,
        entity: input.entity,
        recordId: input.recordId ?? null,
        airtableId: input.airtableId ?? null,
        status: input.status,
        message: input.message?.slice(0, 500) ?? null,
      },
    })
    .catch(() => undefined);
}

/** A local row as calendar values ("YYYY-MM-DD" dates), the shape the field map speaks. */
function localValues(entity: SyncEntity, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of SYNC_FIELDS[entity]) {
    const value = row[field.key];
    out[field.key] = field.type === "date" ? toDay(value as Date | null) : value;
  }
  return out;
}

/** Calendar values → Prisma data for an event or issue row. */
function toRowData(entity: SyncEntity, values: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of SYNC_FIELDS[entity]) {
    if (!(field.key in values)) continue;
    const value = values[field.key];
    if (field.type === "date") data[field.key] = fromDay(value as string | null);
    else if (field.type === "number") data[field.key] = value == null ? null : field.key === "revenue" ? Number(value) : Math.round(Number(value));
    else if (field.type === "list") data[field.key] = (value as string[] | undefined) ?? [];
    else data[field.key] = value ?? null;
  }
  // Required columns never go null.
  if (entity === "event" && "name" in data && !data.name) delete data.name;
  if (entity === "event" && "stage" in data && !data.stage) delete data.stage;
  if (entity === "issue" && "title" in data && !data.title) delete data.title;
  if (entity === "issue" && "status" in data && !data.status) delete data.status;
  if (entity === "issue" && "publicationCode" in data && !data.publicationCode) delete data.publicationCode;
  return data;
}

async function loadRow(organizationId: string, entity: SyncEntity, id: string) {
  const db = tenantDb(organizationId);
  return entity === "event" ? db.calendarEvent.findFirst({ where: { id } }) : db.calendarIssue.findFirst({ where: { id } });
}

async function stamp(organizationId: string, entity: SyncEntity, id: string, data: { airtableId?: string; airtableSyncedAt: Date }, keepUpdatedAt: Date): Promise<void> {
  const db = tenantDb(organizationId);
  // Keep updatedAt as it was: a sync stamp is not an edit (the Brain catch-up and push checks read updatedAt).
  const payload = { ...data, updatedAt: keepUpdatedAt };
  // Only when nobody saved the row meanwhile; a newer edit keeps its updatedAt and is pushed next time.
  const done = entity === "event" ? await db.calendarEvent.updateMany({ where: { id, updatedAt: keepUpdatedAt }, data: payload }) : await db.calendarIssue.updateMany({ where: { id, updatedAt: keepUpdatedAt }, data: payload });
  // Edited meanwhile: still remember a new Airtable id so the next push updates instead of duplicating.
  if (!done.count && data.airtableId) {
    if (entity === "event") await db.calendarEvent.updateMany({ where: { id, airtableId: null }, data: { airtableId: data.airtableId } });
    else await db.calendarIssue.updateMany({ where: { id, airtableId: null }, data: { airtableId: data.airtableId } });
  }
}

/**
 * Write one saved event or issue back to Airtable: mapped, editable fields
 * only. Creates the Airtable record the first time. Soft-fails and logs.
 */
export async function pushRecord(input: { organizationId: string; brandId: string; entity: SyncEntity; id: string; fetcher?: Fetch }): Promise<"ok" | "skipped" | "error"> {
  try {
    const conn = await getConnection(input.organizationId, input.brandId);
    const table = conn ? tableOf(conn, input.entity) : null;
    if (!conn || !conn.enabled || !table) return "skipped";
    const row = (await loadRow(input.organizationId, input.entity, input.id)) as (Record<string, unknown> & { id: string; airtableId: string | null; updatedAt: Date; deletedAt: Date | null }) | null;
    if (!row || row.deletedAt) return "skipped";
    const fields = toAirtableFields(input.entity, localValues(input.entity, row), mapOf(conn, input.entity), conn.readOnlyFields);
    if (!Object.keys(fields).length) return "skipped";
    const token = openToken(conn.tokenEnc, authSecret());
    const fetcher = input.fetcher ?? fetch;
    const existing = isRecordId(row.airtableId) ? row.airtableId : null;
    const body = await call<{ id?: string }>(
      token,
      recordsUrl(conn.baseId, table, existing ?? undefined),
      { method: existing ? "PATCH" : "POST", body: JSON.stringify({ fields, typecast: true }) },
      fetcher,
    );
    const airtableId = existing ?? (isRecordId(body.id) ? body.id : null);
    await stamp(input.organizationId, input.entity, row.id, { ...(airtableId ? { airtableId } : {}), airtableSyncedAt: new Date() }, row.updatedAt);
    await log({ ...input, direction: "push", recordId: row.id, airtableId, status: "ok", message: existing ? "Updated" : "Created" });
    return "ok";
  } catch (error) {
    await log({ ...input, direction: "push", recordId: input.id, status: "error", message: error instanceof Error ? error.message : "Push failed." });
    return "error";
  }
}

type AirtableRecord = { id: string; createdTime?: string; fields: Record<string, unknown> };

async function listRecords(conn: Connection, table: string, token: string, fetcher: Fetch, maxPages = 50): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const url = `${recordsUrl(conn.baseId, table)}?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
    const body = await call<{ records?: AirtableRecord[]; offset?: string }>(token, url, { method: "GET" }, fetcher);
    records.push(...(body.records ?? []));
    offset = body.offset;
    if (!offset) break;
  }
  return records;
}

export type PullCounts = { created: number; updated: number; skipped: number; errors: number };

/** Pull one table into Postgres: upsert by Airtable id under the conflict rule. */
async function pullEntity(conn: Connection, entity: SyncEntity, token: string, fetcher: Fetch): Promise<PullCounts> {
  const counts: PullCounts = { created: 0, updated: 0, skipped: 0, errors: 0 };
  const table = tableOf(conn, entity);
  const map = mapOf(conn, entity);
  if (!table || !Object.keys(map.fields).length) return counts;
  const db = tenantDb(conn.organizationId);
  const records = await listRecords(conn, table, token, fetcher);
  const tombstones = new Set(
    (await db.calendarSyncLog.findMany({ where: { brandId: conn.brandId, entity, status: "tombstone" }, select: { airtableId: true }, take: 10000 })).map((t) => t.airtableId),
  );
  const pubCodes = entity === "issue" ? new Set((await db.calendarPublication.findMany({ where: { brandId: conn.brandId }, select: { code: true } })).map((p) => p.code)) : null;
  for (const record of records) {
    const now = new Date();
    try {
      if (!isRecordId(record.id) || tombstones.has(record.id)) {
        counts.skipped += 1;
        continue;
      }
      const remote = fromAirtableFields(entity, record.fields, map);
      const local = (await (entity === "event"
        ? db.calendarEvent.findFirst({ where: { brandId: conn.brandId, airtableId: record.id } })
        : db.calendarIssue.findFirst({ where: { brandId: conn.brandId, airtableId: record.id } }))) as (Record<string, unknown> & { id: string; updatedAt: Date; airtableSyncedAt: Date | null; deletedAt: Date | null }) | null;
      const changes = local ? changedValues(remote, localValues(entity, local)) : remote;
      const decision = pullDecision({ local, remoteModified: remoteModifiedAt(record.fields, map), changes });
      if (decision === "create") {
        const data = toRowData(entity, remote);
        if (entity === "issue") {
          const code = String(data.publicationCode ?? "");
          if (!data.title || !pubCodes?.has(code)) {
            counts.skipped += 1;
            await log({ organizationId: conn.organizationId, brandId: conn.brandId, direction: "pull", entity, airtableId: record.id, status: "skipped", message: !data.title ? "No title" : `Unknown publication "${code}"` });
            continue;
          }
          await db.calendarIssue.create({ data: { ...(data as Record<string, never>), organizationId: conn.organizationId, brandId: conn.brandId, title: String(data.title), publicationCode: code, airtableId: record.id, airtableSyncedAt: now, updatedAt: now } });
        } else {
          await db.calendarEvent.create({ data: { ...(data as Record<string, never>), organizationId: conn.organizationId, brandId: conn.brandId, name: String(data.name ?? "Untitled event"), airtableId: record.id, airtableSyncedAt: now, updatedAt: now } });
        }
        counts.created += 1;
      } else if (decision === "update" && local) {
        const data = toRowData(entity, changes);
        if (entity === "issue" && "publicationCode" in data && !pubCodes?.has(String(data.publicationCode))) delete data.publicationCode;
        // updatedAt and the sync stamp are the same instant, so the row does not read as edited since its sync.
        if (entity === "event") await db.calendarEvent.updateMany({ where: { id: local.id }, data: { ...data, airtableSyncedAt: now, updatedAt: now } });
        else await db.calendarIssue.updateMany({ where: { id: local.id }, data: { ...data, airtableSyncedAt: now, updatedAt: now } });
        counts.updated += 1;
      } else counts.skipped += 1;
    } catch (error) {
      counts.errors += 1;
      await log({ organizationId: conn.organizationId, brandId: conn.brandId, direction: "pull", entity, airtableId: record.id, status: "error", message: error instanceof Error ? error.message : "Pull failed." });
    }
  }
  return counts;
}

/** Push rows edited since their last sync (soft-failed saves, Mini-Blog issues, job edits). */
async function pushPending(conn: Connection, entity: SyncEntity, fetcher: Fetch, limit = 50): Promise<number> {
  if (!tableOf(conn, entity)) return 0;
  const db = tenantDb(conn.organizationId);
  const rows =
    entity === "event"
      ? await db.calendarEvent.findMany({ where: { brandId: conn.brandId, deletedAt: null }, select: { id: true, updatedAt: true, airtableSyncedAt: true }, orderBy: { updatedAt: "desc" }, take: 2000 })
      : await db.calendarIssue.findMany({ where: { brandId: conn.brandId, deletedAt: null }, select: { id: true, updatedAt: true, airtableSyncedAt: true }, orderBy: { updatedAt: "desc" }, take: 2000 });
  let pushed = 0;
  for (const row of rows.filter(needsPush).slice(0, limit)) {
    if ((await pushRecord({ organizationId: conn.organizationId, brandId: conn.brandId, entity, id: row.id, fetcher })) === "ok") pushed += 1;
  }
  return pushed;
}

/** One full sync for one brand: pull both tables, then push what changed locally. Records the outcome on the connection. */
export async function syncConnection(conn: Connection, fetcher: Fetch = fetch) {
  const db = tenantDb(conn.organizationId);
  try {
    const token = openToken(conn.tokenEnc, authSecret());
    const events = await pullEntity(conn, "event", token, fetcher);
    const issues = await pullEntity(conn, "issue", token, fetcher);
    const pushed = (await pushPending(conn, "event", fetcher)) + (await pushPending(conn, "issue", fetcher));
    const summary = `Pulled ${events.created + issues.created} new, ${events.updated + issues.updated} updated; pushed ${pushed}.`;
    await db.calendarAirtableConnection.updateMany({ where: { id: conn.id }, data: { lastPullAt: new Date(), lastStatus: "ok", lastError: events.errors + issues.errors ? `${events.errors + issues.errors} record(s) failed; see the sync log.` : null } });
    await log({ organizationId: conn.organizationId, brandId: conn.brandId, direction: "pull", entity: "event", status: "ok", message: summary });
    return { events, issues, pushed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    await db.calendarAirtableConnection.updateMany({ where: { id: conn.id }, data: { lastPullAt: new Date(), lastStatus: "error", lastError: message.slice(0, 500) } });
    return { error: message };
  }
}
