import { tenantDb, type Prisma } from "@pubcommand/db";
import type { EmailExtraction } from "../../../../../modules/intel/index";
import { loadLanding } from "./landing";
import { isVideoStale } from "./video";

const UUID = /^[0-9a-f-]{36}$/i;

export type VideoFilters = { competitor: string; type: string; status: string; q: string; from: string; to: string };

export function readVideoFilters(search: Record<string, string | undefined>): VideoFilters {
  const day = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
  return {
    competitor: (search.competitor ?? "").slice(0, 40),
    type: (search.type ?? "").slice(0, 30),
    status: ["QUEUED", "RUNNING", "DONE", "FAILED"].includes(search.status ?? "") ? search.status! : "",
    q: (search.q ?? "").trim().slice(0, 120),
    from: day(search.from),
    to: day(search.to),
  };
}

export function videoWhere(brandId: string, filters: VideoFilters & { expert?: string; topic?: string }): Prisma.IntelVideoWhereInput {
  const where: Prisma.IntelVideoWhereInput = { brandId, deletedAt: null };
  if (filters.competitor === "none") where.competitorId = null;
  else if (UUID.test(filters.competitor)) where.competitorId = filters.competitor;
  if (filters.type) where.videoType = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
      ...(filters.to ? { lt: new Date(new Date(`${filters.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
    };
  }
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { url: { contains: filters.q, mode: "insensitive" } },
      { transcript: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  const entityIds = [filters.expert, filters.topic].filter((value): value is string => Boolean(value && UUID.test(value)));
  if (entityIds.length) where.AND = entityIds.map((entityId) => ({ entityRefs: { some: { entityId } } }));
  return where;
}

export async function listVideos(organizationId: string, brandId: string, filters: VideoFilters) {
  const rows = await tenantDb(organizationId).intelVideo.findMany({
    where: videoWhere(brandId, filters),
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      url: true,
      title: true,
      platform: true,
      durationSec: true,
      status: true,
      step: true,
      error: true,
      videoType: true,
      transcriptSource: true,
      extractionStatus: true,
      createdAt: true,
      updatedAt: true,
      competitor: { select: { id: true, name: true } },
      frames: { where: { position: 0 }, select: { position: true } },
    },
  });
  return rows.map((row) => ({ ...row, status: isVideoStale(row.status, row.updatedAt) ? "QUEUED" : row.status, hasThumb: row.frames.length > 0 }));
}

export async function videoQueueCounts(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const [queued, running] = await Promise.all([
    db.intelVideo.count({ where: { brandId, deletedAt: null, status: "QUEUED" } }),
    db.intelVideo.count({ where: { brandId, deletedAt: null, status: "RUNNING" } }),
  ]);
  return { queued, running };
}

export async function loadVideo(organizationId: string, brandId: string, videoId: string) {
  if (!UUID.test(videoId)) return null;
  const db = tenantDb(organizationId);
  const video = await db.intelVideo.findFirst({
    where: { id: videoId, brandId, deletedAt: null },
    include: { competitor: { select: { id: true, name: true } }, frames: { orderBy: { position: "asc" }, select: { position: true, atSec: true, size: true } } },
  });
  if (!video) return null;
  const [landing, promo] = await Promise.all([
    loadLanding(organizationId, video.landingPageId),
    video.analyzerPromoId ? db.promo.findFirst({ where: { id: video.analyzerPromoId, deletedAt: null }, select: { id: true, analysisStatus: true, effectivenessScore: true } }) : null,
  ]);
  return {
    ...video,
    status: isVideoStale(video.status, video.updatedAt) ? "QUEUED" : video.status,
    extraction: (video.extraction as unknown as EmailExtraction | null) ?? null,
    landing,
    promo,
  };
}

export type LoadedVideo = NonNullable<Awaited<ReturnType<typeof loadVideo>>>;
