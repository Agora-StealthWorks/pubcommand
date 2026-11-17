import type { Prisma } from "@pubcommand/db";
import { mainBrain } from "../main-brain/db";

const UUID = /^[0-9a-f-]{36}$/i;

export type ConflictFilter = {
  status?: string | null;
  organizationId?: string | null;
  brandId?: string | null;
  kind?: string | null;
  layer?: string | null;
  q?: string | null;
};

export const STATUS_FILTERS = [
  ["OPEN", "Open"],
  ["WAITING", "Waiting on Publication Setup"],
  ["RESOLVED", "Resolved"],
  ["DISMISSED", "Dismissed"],
  ["ALL", "Any status"],
] as const;

export function conflictWhere(filter: ConflictFilter): Prisma.MainBrainConflictWhereInput {
  const and: Prisma.MainBrainConflictWhereInput[] = [];
  const status = filter.status || "OPEN";
  if (status === "WAITING") and.push({ status: "OPEN", resolution: "setup-to-fix" });
  else if (status === "OPEN" || status === "RESOLVED" || status === "DISMISSED") and.push({ status });
  if (filter.organizationId && UUID.test(filter.organizationId)) and.push({ entityOrganizationId: filter.organizationId });
  if (filter.brandId && UUID.test(filter.brandId)) and.push({ entityBrandId: filter.brandId });
  if (filter.kind === "publication" || filter.kind === "editor") and.push({ entityKind: filter.kind });
  if (filter.layer === "rule" || filter.layer === "ai") and.push({ layer: filter.layer });
  const q = (filter.q ?? "").trim().slice(0, 120);
  if (q) and.push({ OR: [{ check: { entityName: { contains: q, mode: "insensitive" } } }, { noteTitle: { contains: q, mode: "insensitive" } }, { quote: { contains: q, mode: "insensitive" } }] });
  return { AND: and };
}

export const CONFLICT_LIST_SELECT = {
  id: true,
  entityKind: true,
  entityId: true,
  entityOrganizationId: true,
  entityBrandId: true,
  factKey: true,
  factValue: true,
  noteId: true,
  noteTitle: true,
  noteSays: true,
  quote: true,
  layer: true,
  confidence: true,
  status: true,
  resolution: true,
  updatedAt: true,
  check: { select: { entityName: true, entityCode: true } },
} as const;

export type ConflictRow = Prisma.MainBrainConflictGetPayload<{ select: typeof CONFLICT_LIST_SELECT }>;

export async function listConflicts(filter: ConflictFilter, take = 200): Promise<ConflictRow[]> {
  return mainBrain((tx) =>
    tx.mainBrainConflict.findMany({ where: conflictWhere(filter), select: CONFLICT_LIST_SELECT, orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }], take }),
  );
}

export async function conflictCounts(filter: Omit<ConflictFilter, "status">) {
  const base = conflictWhere({ ...filter, status: "ALL" });
  return mainBrain(async (tx) => {
    const [byStatus, waiting, byKind, byPlace, checks, running, lastChecked] = await Promise.all([
      tx.mainBrainConflict.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
      tx.mainBrainConflict.count({ where: { AND: [base, { status: "OPEN", resolution: "setup-to-fix" }] } }),
      tx.mainBrainConflict.groupBy({ by: ["entityKind", "status"], where: base, _count: { _all: true } }),
      tx.mainBrainConflict.groupBy({ by: ["entityOrganizationId", "entityBrandId", "status"], where: base, _count: { _all: true } }),
      tx.mainBrainConflictCheck.count(),
      tx.mainBrainConflictCheck.count({ where: { status: { in: ["queued", "running"] } } }),
      tx.mainBrainConflictCheck.findFirst({ where: { checkedAt: { not: null } }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true, aiStatus: true, aiReason: true } }),
    ]);
    const status = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Record<string, number>;
    const kinds: Record<string, Record<string, number>> = {};
    for (const row of byKind) (kinds[row.entityKind] ??= {})[row.status] = row._count._all;
    const places = new Map<string, { organizationId: string; brandId: string; OPEN: number; RESOLVED: number; DISMISSED: number }>();
    for (const row of byPlace) {
      const key = `${row.entityOrganizationId}:${row.entityBrandId}`;
      const item = places.get(key) ?? { organizationId: row.entityOrganizationId, brandId: row.entityBrandId, OPEN: 0, RESOLVED: 0, DISMISSED: 0 };
      item[row.status] += row._count._all;
      places.set(key, item);
    }
    return { status, waiting, kinds, places: [...places.values()], checks, running, lastChecked };
  });
}

export async function listChecks(filter: { organizationId?: string | null; brandId?: string | null; kind?: string | null; q?: string | null }) {
  const where: Prisma.MainBrainConflictCheckWhereInput = {
    ...(filter.organizationId && UUID.test(filter.organizationId) ? { entityOrganizationId: filter.organizationId } : {}),
    ...(filter.brandId && UUID.test(filter.brandId) ? { entityBrandId: filter.brandId } : {}),
    ...(filter.kind === "publication" || filter.kind === "editor" ? { entityKind: filter.kind } : {}),
    ...(filter.q ? { entityName: { contains: filter.q.slice(0, 120), mode: "insensitive" as const } } : {}),
  };
  return mainBrain(async (tx) => {
    const rows = await tx.mainBrainConflictCheck.findMany({
      where,
      orderBy: [{ entityName: "asc" }],
      take: 300,
      select: { id: true, entityKind: true, entityId: true, entityName: true, entityCode: true, entityOrganizationId: true, entityBrandId: true, status: true, aiStatus: true, checkedAt: true, noteIds: true },
    });
    const open = await tx.mainBrainConflict.groupBy({ by: ["entityKind", "entityId"], where: { status: "OPEN", entityId: { in: rows.map((r) => r.entityId) } }, _count: { _all: true } });
    const openBy = new Map(open.map((row) => [`${row.entityKind}:${row.entityId}`, row._count._all]));
    return rows.map((row) => ({ ...row, open: openBy.get(`${row.entityKind}:${row.entityId}`) ?? 0 }));
  });
}

export async function getConflict(id: string) {
  if (!UUID.test(id)) return null;
  return mainBrain((tx) => tx.mainBrainConflict.findUnique({ where: { id }, include: { check: true } }));
}

export async function entityConflicts(kind: string, entityId: string) {
  return mainBrain((tx) =>
    tx.mainBrainConflict.findMany({ where: { entityKind: kind, entityId }, select: CONFLICT_LIST_SELECT, orderBy: [{ status: "asc" }, { confidence: "desc" }] }),
  );
}

export async function entityCheck(kind: string, entityId: string) {
  return mainBrain((tx) => tx.mainBrainConflictCheck.findUnique({ where: { entityKind_entityId: { entityKind: kind, entityId } } }));
}

export const RESOLUTION_LABELS: Record<string, string> = {
  "note-edited": "Note passage corrected",
  "note-rewritten": "Note rewritten with the correct fact",
  "note-superseded": "Note marked outdated",
  dismissed: "Dismissed: not a conflict",
  "setup-to-fix": "Waiting on Publication Setup",
  cleared: "No longer found",
};
