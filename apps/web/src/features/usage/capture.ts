import { SNAPSHOT_SKIP_TARGETS, activityParts, activitySummary, contentSnapshot, isAgentEmail } from "@pubcommand/core";
import { Prisma, platformTx, rawPrisma } from "@pubcommand/db";

/**
 * Turns organization audit entries into usage activities: who did what, in which app, and a
 * plain-text snapshot of what they made (a form's title and every field label, a post's copy,
 * a promo's headline and analysis). Runs incrementally from a cursor (usage.capture job).
 *
 * The thing an entry points at is found by its targetType: "form" → table "forms" → the Form
 * model. Only String and Json columns are read (never Bytes), and contentSnapshot() drops
 * secrets, contact details, ids, URLs and styling. Targets that hold people's data (members,
 * opt-ins, responses, keys, connections) are never read.
 */

const CURSOR_KEY = "usage_capture_cursor";
const BATCH = 400;
const BACKFILL_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CONTENT_VERBS = new Set(["deleted", "purged", "removed", "revoked", "disconnected", "restored"]);

type ModelInfo = { delegate: string; select: Record<string, true> };

let tables: Map<string, ModelInfo> | null = null;

/** table name → Prisma delegate and the String/Json columns to read. */
function modelTables(): Map<string, ModelInfo> {
  if (tables) return tables;
  tables = new Map();
  for (const model of Prisma.dmmf.datamodel.models) {
    const select: Record<string, true> = {};
    for (const field of model.fields) {
      if (field.kind === "scalar" && (field.type === "String" || field.type === "Json")) select[field.name] = true;
    }
    tables.set(model.dbName ?? model.name, { delegate: model.name.charAt(0).toLowerCase() + model.name.slice(1), select });
  }
  return tables;
}

function modelFor(targetType: string): ModelInfo | null {
  const map = modelTables();
  const candidates = [targetType, `${targetType}s`, `${targetType}es`, targetType.replace(/y$/, "ies")];
  for (const name of candidates) {
    const hit = map.get(name);
    if (hit) return hit;
  }
  return null;
}

/** The parts that hold the copy but live in child tables. Never PII tables. */
const CHILDREN: Record<string, { relation: string; model: string; orderBy: Record<string, "asc" | "desc">; take: number }[]> = {
  form: [{ relation: "fields", model: "form_fields", orderBy: { position: "asc" }, take: 60 }],
  promo_package: [{ relation: "components", model: "promo_package_components", orderBy: { position: "asc" }, take: 30 }],
  funnel: [
    { relation: "days", model: "funnel_days", orderBy: { position: "asc" }, take: 20 },
    { relation: "emails", model: "funnel_emails", orderBy: { createdAt: "asc" }, take: 20 },
  ],
  promo: [{ relation: "analyses", model: "promo_analyses", orderBy: { createdAt: "desc" }, take: 1 }],
};

type Delegate = { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };

export async function snapshotTarget(targetType: string, targetId: string | null): Promise<{ title: string | null; content: string | null }> {
  const empty = { title: null, content: null };
  if (!targetId || !UUID.test(targetId) || SNAPSHOT_SKIP_TARGETS.has(targetType)) return empty;
  const model = modelFor(targetType);
  if (!model) return empty;
  const select: Record<string, unknown> = { ...model.select };
  for (const child of CHILDREN[targetType] ?? []) {
    const childModel = modelTables().get(child.model);
    if (childModel) select[child.relation] = { select: childModel.select, orderBy: child.orderBy, take: child.take };
  }
  try {
    const row = await platformTx((tx) => ((tx as unknown as Record<string, Delegate>)[model.delegate] as Delegate).findUnique({ where: { id: targetId }, select }));
    return row ? contentSnapshot(row) : empty;
  } catch {
    // Not every target table has an `id` column of that shape; fall back to no snapshot.
    return empty;
  }
}

function metadataTitle(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ["title", "name", "headline", "subject", "label"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}

async function readCursor(): Promise<{ at: Date; id: string }> {
  const row = await rawPrisma().platformSetting.findUnique({ where: { key: CURSOR_KEY } });
  const value = row?.value as { at?: string; id?: string } | undefined;
  if (value?.at) return { at: new Date(value.at), id: value.id ?? "00000000-0000-0000-0000-000000000000" };
  return { at: new Date(Date.now() - BACKFILL_DAYS * 86_400_000), id: "00000000-0000-0000-0000-000000000000" };
}

async function writeCursor(at: Date, id: string) {
  const value = { at: at.toISOString(), id };
  await rawPrisma().platformSetting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value }, update: { value } });
}

/** Captures new organization audit entries. Idempotent (one activity per audit row). */
export async function captureActivities(options: { maxBatches?: number; log?: (message: string) => void } = {}): Promise<{ captured: number; withContent: number; batches: number }> {
  let captured = 0;
  let withContent = 0;
  let batches = 0;
  const staffIds = new Set((await rawPrisma().platformStaff.findMany({ select: { userId: true } })).map((row) => row.userId));
  for (; batches < (options.maxBatches ?? 25); batches += 1) {
    const cursor = await readCursor();
    const rows = await platformTx((tx) =>
      tx.auditLog.findMany({
        where: { OR: [{ createdAt: { gt: cursor.at } }, { createdAt: cursor.at, id: { gt: cursor.id } }] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH,
      }),
    );
    if (rows.length === 0) break;
    const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];
    const actors = new Map((await rawPrisma().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })).map((user) => [user.id, user.email]));
    // One snapshot per target per batch: the latest state is what matters.
    const snapshots = new Map<string, Promise<{ title: string | null; content: string | null }>>();
    const data: Prisma.UsageActivityCreateManyInput[] = [];
    for (const row of rows) {
      const { app, verb } = activityParts(row.action);
      const email = row.actorId ? actors.get(row.actorId) : undefined;
      const actorKind = !row.actorId ? "system" : isAgentEmail(email) ? "agent" : staffIds.has(row.actorId) ? "staff" : "member";
      const key = `${row.targetType}:${row.targetId ?? ""}`;
      let snap = { title: null as string | null, content: null as string | null };
      if (!NO_CONTENT_VERBS.has(verb)) {
        if (!snapshots.has(key)) snapshots.set(key, snapshotTarget(row.targetType, row.targetId));
        snap = await snapshots.get(key)!;
      }
      const title = snap.title ?? metadataTitle(row.metadata);
      if (snap.content) withContent += 1;
      data.push({
        auditLogId: row.id,
        orgId: row.organizationId,
        actorId: row.actorId,
        actorKind,
        app,
        action: row.action.slice(0, 200),
        verb: verb.slice(0, 60),
        targetType: row.targetType.slice(0, 100),
        targetId: row.targetId,
        title,
        summary: activitySummary({ action: row.action, targetType: row.targetType, title }),
        content: snap.content,
        createdAt: row.createdAt,
      });
    }
    const result = await platformTx((tx) => tx.usageActivity.createMany({ data, skipDuplicates: true }));
    captured += result.count;
    const last = rows[rows.length - 1]!;
    await writeCursor(last.createdAt, last.id);
    options.log?.(`captured ${result.count} of ${rows.length}`);
    if (rows.length < BATCH) {
      batches += 1;
      break;
    }
  }
  return { captured, withContent, batches };
}
