import { appendOrgAudit, Prisma, tenantDb } from "@pubcommand/db";
import {
  ENTITY_KINDS,
  planMerge,
  planRefMove,
  resolveList,
  resolveNames,
  type EmailExtraction,
  type EntityKind,
  type RegistryEntry,
} from "../../../../../modules/intel/index";

const UUID = /^[0-9a-f-]{36}$/i;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Every live registry entry of a brand (ignored ones included, so they are not re-created). */
export async function loadRegistry(organizationId: string, brandId: string): Promise<RegistryEntry[]> {
  const rows = await tenantDb(organizationId).intelEntity.findMany({
    where: { brandId, deletedAt: null },
    select: { id: true, kind: true, name: true, aliases: true, ignored: true },
  });
  return rows.map((row) => ({ ...row, kind: row.kind as EntityKind }));
}

type Target = { emailId: string } | { videoId: string };

/**
 * Links one email or video to its experts, topics and (for emails) list,
 * creating missing entries. Only the kinds given are recomputed. `registry` is
 * updated in place, so a batch can share one load.
 */
export async function linkEntities(input: {
  organizationId: string;
  brandId: string;
  target: Target;
  registry: RegistryEntry[];
  competitorId?: string | null;
  experts?: readonly string[];
  topics?: readonly string[];
  sender?: { fromName: string | null; fromAddress: string };
}): Promise<void> {
  const db = tenantDb(input.organizationId);
  const wanted = new Map<EntityKind, string[]>();

  const create = async (kind: EntityKind, name: string, aliases: string[] = []) => {
    const row = await db.intelEntity.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        kind,
        name,
        aliases,
        competitorId: kind === "topic" ? null : (input.competitorId ?? null),
        autoCreated: true,
      },
      select: { id: true },
    });
    input.registry.push({ id: row.id, kind, name, aliases, ignored: false });
    return row.id;
  };

  for (const kind of ["expert", "topic"] as const) {
    const names = kind === "expert" ? input.experts : input.topics;
    if (!names) continue;
    const resolved = resolveNames(input.registry, kind, names);
    const ids = [...resolved.ids];
    for (const name of resolved.create.slice(0, 10)) ids.push(await create(kind, name));
    wanted.set(kind, ids);
  }
  if (input.sender) {
    const list = resolveList(input.registry, input.sender);
    if (list) wanted.set("list", ["id" in list ? list.id : await create("list", list.create.name, list.create.aliases)]);
    else wanted.set("list", []);
  }
  if (!wanted.size) return;

  const where = "emailId" in input.target ? { emailId: input.target.emailId } : { videoId: input.target.videoId };
  const existing = await db.intelEntityRef.findMany({ where, select: { id: true, entityId: true, entity: { select: { kind: true } } } });
  const keep = new Set([...wanted.values()].flat());
  const stale = existing.filter((ref) => wanted.has(ref.entity.kind as EntityKind) && !keep.has(ref.entityId)).map((ref) => ref.id);
  if (stale.length) await db.intelEntityRef.deleteMany({ where: { id: { in: stale } } });
  const have = new Set(existing.map((ref) => ref.entityId));
  for (const entityId of keep) {
    if (have.has(entityId)) continue;
    try {
      await db.intelEntityRef.create({ data: { organizationId: input.organizationId, entityId, ...where } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
}

/** Link an email from what is stored (sender, plus experts and topics when extracted). */
export async function linkEmail(organizationId: string, brandId: string, emailId: string, registry?: RegistryEntry[]): Promise<void> {
  const email = await tenantDb(organizationId).intelEmail.findFirst({
    where: { id: emailId, brandId, deletedAt: null },
    select: { id: true, fromName: true, fromAddress: true, competitorId: true, extraction: true },
  });
  if (!email) return;
  const extraction = email.extraction as EmailExtraction | null;
  await linkEntities({
    organizationId,
    brandId,
    target: { emailId: email.id },
    registry: registry ?? (await loadRegistry(organizationId, brandId)),
    competitorId: email.competitorId,
    sender: { fromName: email.fromName, fromAddress: email.fromAddress },
    ...(extraction ? { experts: extraction.experts ?? [], topics: extraction.topics ?? [] } : {}),
  });
}

export async function linkVideo(organizationId: string, brandId: string, videoId: string): Promise<void> {
  const video = await tenantDb(organizationId).intelVideo.findFirst({ where: { id: videoId, brandId, deletedAt: null }, select: { id: true, competitorId: true, extraction: true } });
  const extraction = video?.extraction as EmailExtraction | null;
  if (!video || !extraction) return;
  await linkEntities({
    organizationId,
    brandId,
    target: { videoId: video.id },
    registry: await loadRegistry(organizationId, brandId),
    competitorId: video.competitorId,
    experts: extraction.experts ?? [],
    topics: extraction.topics ?? [],
  });
}

/** Link emails that have no registry links yet (older emails, or after "Rebuild links"). */
export async function backfillLinks(organizationId: string, brandId: string, limit = 500): Promise<number> {
  const db = tenantDb(organizationId);
  const rows = await db.intelEmail.findMany({
    where: { brandId, deletedAt: null, entityRefs: { none: {} } },
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  if (!rows.length) return 0;
  const registry = await loadRegistry(organizationId, brandId);
  for (const row of rows) await linkEmail(organizationId, brandId, row.id, registry);
  return rows.length;
}

/** Re-link every email and video of a brand (after big registry edits). Bounded per call. */
export async function relinkAll(organizationId: string, brandId: string, limit = 3000): Promise<number> {
  const db = tenantDb(organizationId);
  const registry = await loadRegistry(organizationId, brandId);
  const emails = await db.intelEmail.findMany({ where: { brandId, deletedAt: null }, orderBy: { receivedAt: "desc" }, take: limit, select: { id: true } });
  for (const row of emails) await linkEmail(organizationId, brandId, row.id, registry);
  const videos = await db.intelVideo.findMany({ where: { brandId, deletedAt: null, extractionStatus: "DONE" }, take: 500, select: { id: true } });
  for (const row of videos) await linkVideo(organizationId, brandId, row.id);
  return emails.length + videos.length;
}

// ── Pages ───────────────────────────────────────────────────────────────────

export type RegistryFilters = { q: string; competitor: string; category: string; show: "active" | "ignored" | "all"; sort: "count" | "name" };

export function readRegistryFilters(search: Record<string, string | undefined>): RegistryFilters {
  return {
    q: (search.q ?? "").trim().slice(0, 120),
    competitor: (search.competitor ?? "").slice(0, 40),
    category: (search.category ?? "").slice(0, 20),
    show: search.show === "ignored" || search.show === "all" ? search.show : "active",
    sort: search.sort === "name" ? "name" : "count",
  };
}

const LIVE_REF = { OR: [{ email: { deletedAt: null } }, { video: { deletedAt: null } }] };

export async function listEntities(organizationId: string, brandId: string, kind: EntityKind, filters: RegistryFilters) {
  const where: Prisma.IntelEntityWhereInput = { brandId, kind, deletedAt: null };
  if (filters.show === "active") where.ignored = false;
  if (filters.show === "ignored") where.ignored = true;
  if (filters.competitor === "none") where.competitorId = null;
  else if (UUID.test(filters.competitor)) where.competitorId = filters.competitor;
  if (filters.category === "none") where.category = null;
  else if (filters.category) where.category = filters.category;
  if (filters.q) where.OR = [{ name: { contains: filters.q, mode: "insensitive" } }, { aliases: { has: filters.q } }];
  const rows = await tenantDb(organizationId).intelEntity.findMany({
    where,
    take: 2000,
    orderBy: { name: "asc" },
    select: { id: true, name: true, aliases: true, category: true, ignored: true, autoCreated: true, competitorId: true, updatedAt: true, _count: { select: { refs: { where: LIVE_REF } } } },
  });
  const list = rows.map(({ _count, ...row }) => ({ ...row, count: _count.refs }));
  if (filters.sort === "count") list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return list;
}

export async function registryCounts(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const counts = await Promise.all(ENTITY_KINDS.map((kind) => db.intelEntity.count({ where: { brandId, kind, deletedAt: null, ignored: false } })));
  return Object.fromEntries(ENTITY_KINDS.map((kind, index) => [kind, counts[index]!])) as Record<EntityKind, number>;
}

export async function entityOptions(organizationId: string, brandId: string, kind: EntityKind) {
  return tenantDb(organizationId).intelEntity.findMany({
    where: { brandId, kind, deletedAt: null, ignored: false },
    orderBy: { name: "asc" },
    take: 1000,
    select: { id: true, name: true },
  });
}

export async function loadEntity(organizationId: string, brandId: string, entityId: string) {
  if (!UUID.test(entityId)) return null;
  const db = tenantDb(organizationId);
  const entity = await db.intelEntity.findFirst({ where: { id: entityId, brandId, deletedAt: null } });
  if (!entity) return null;
  const [count, emails, videos] = await Promise.all([
    db.intelEntityRef.count({ where: { entityId, ...LIVE_REF } }),
    db.intelEmail.findMany({
      where: { brandId, deletedAt: null, entityRefs: { some: { entityId } } },
      orderBy: { receivedAt: "desc" },
      take: 15,
      select: { id: true, subject: true, receivedAt: true, emailType: true, competitor: { select: { name: true } }, fromAddress: true },
    }),
    db.intelVideo.findMany({
      where: { brandId, deletedAt: null, entityRefs: { some: { entityId } } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, url: true, createdAt: true, videoType: true },
    }),
  ]);
  return { ...entity, kind: entity.kind as EntityKind, count, emails, videos };
}

/** Entries an email or video is linked to, grouped by kind. */
export async function entitiesFor(organizationId: string, target: Target) {
  const refs = await tenantDb(organizationId).intelEntityRef.findMany({
    where: "emailId" in target ? { emailId: target.emailId } : { videoId: target.videoId },
    select: { entity: { select: { id: true, kind: true, name: true, ignored: true, deletedAt: true } } },
  });
  const out: Record<EntityKind, { id: string; name: string }[]> = { expert: [], list: [], topic: [] };
  for (const { entity } of refs) {
    if (entity.deletedAt || entity.ignored) continue;
    out[entity.kind as EntityKind]?.push({ id: entity.id, name: entity.name });
  }
  return out;
}

/** Fold `sourceId` into `targetId`: aliases, links and the publisher carry over; the source is retired. */
export async function mergeEntities(input: { organizationId: string; brandId: string; sourceId: string; targetId: string; actorId: string }): Promise<{ ok: true; moved: number } | { error: string }> {
  if (!UUID.test(input.sourceId) || !UUID.test(input.targetId)) return { error: "Pick an entry to merge into." };
  const db = tenantDb(input.organizationId);
  const [source, target] = await Promise.all([
    db.intelEntity.findFirst({ where: { id: input.sourceId, brandId: input.brandId, deletedAt: null } }),
    db.intelEntity.findFirst({ where: { id: input.targetId, brandId: input.brandId, deletedAt: null } }),
  ]);
  if (!source || !target) return { error: "One of those entries no longer exists." };
  const plan = planMerge({ ...source, kind: source.kind as EntityKind }, { ...target, kind: target.kind as EntityKind });
  if ("error" in plan) return plan;
  const [sourceRefs, targetRefs] = await Promise.all([
    db.intelEntityRef.findMany({ where: { entityId: source.id }, select: { id: true, emailId: true, videoId: true } }),
    db.intelEntityRef.findMany({ where: { entityId: target.id }, select: { emailId: true, videoId: true } }),
  ]);
  const moves = planRefMove(sourceRefs, targetRefs);
  if (moves.drop.length) await db.intelEntityRef.deleteMany({ where: { id: { in: moves.drop } } });
  if (moves.move.length) await db.intelEntityRef.updateMany({ where: { id: { in: moves.move } }, data: { entityId: target.id } });
  await db.intelEntity.updateMany({
    where: { id: target.id },
    data: {
      aliases: plan.aliases,
      competitorId: target.competitorId ?? source.competitorId,
      category: target.category ?? source.category,
      notes: [target.notes, source.notes].filter(Boolean).join("\n\n") || null,
      autoCreated: false,
    },
  });
  await db.intelEntity.updateMany({ where: { id: source.id }, data: { deletedAt: new Date(), mergedIntoId: target.id } });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "intel.registry.merged", targetType: "intel_entity", targetId: `${source.id}->${target.id}` });
  return { ok: true, moved: moves.move.length };
}
