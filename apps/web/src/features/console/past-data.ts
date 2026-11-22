import { rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { learnedKey } from "../../../../../modules/knowledge/main-brain";
import { promoMasterNotes } from "../../../../../modules/promo-studio/master-brain";
import { currentAnalysis } from "../../../../../modules/promo-studio/stored";
import { ensureConsoleOrganization } from "@/lib/console-workspace";
import { mainBrain } from "../main-brain/db";
import { learnUp, learnUpBackfill } from "../main-brain/learn";

/**
 * Past Promo Analyzer and VidRipper data, for the admin console.
 *
 * - Every analyzed promo in every organization (deleted ones included) has its
 *   review and copy in the Master Brain (`syncPromosToMasterBrain`).
 * - The console workspace gets a copy of every promo and captured video from the
 *   other organizations, so staff can open them in the console's Promo Analyzer
 *   and VidRipper (`copyPromosIntoConsole`, `copyVideosIntoConsole`). The
 *   originals are never changed or removed.
 * - Videos whose organization is gone survive only as Master Brain notes; the
 *   console lists those too (`pastFromMasterBrain`).
 */

export type SyncCounts = Record<string, number>;

/** Every organization id, deleted ones included (their rows stay until purged). */
async function allOrganizationIds(): Promise<string[]> {
  const rows = await rawPrisma().organization.findMany({ select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Make sure every promo with copy or an analysis is in the Master Brain. Only
 * fills what is missing: a note already there (or deleted by staff) is left as
 * it is; the analyzer refreshes notes itself on every run. Copies made for the
 * console are skipped (the original is the one that counts).
 */
export async function syncPromosToMasterBrain(options: { limitPerOrg?: number } = {}): Promise<SyncCounts> {
  const counts: SyncCounts = { organizations: 0, promos: 0, created: 0, present: 0, failed: 0 };
  for (const organizationId of await allOrganizationIds()) {
    counts.organizations! += 1;
    const db = tenantDb(organizationId);
    const promos = await db.promo.findMany({
      where: { deletedAt: null, copiedFromId: null },
      select: { id: true, brandId: true, title: true, sourceText: true, publisher: true, gurus: true, product: true, promoCode: true, effectivenessScore: true },
      orderBy: { createdAt: "asc" },
      take: options.limitPerOrg ?? 5000,
    });
    if (promos.length === 0) continue;
    const brands = new Map((await db.brand.findMany({ select: { id: true, name: true } })).map((brand) => [brand.id, brand.name]));
    const present = new Set<string>();
    const keys = promos.flatMap((promo) => [learnedKey(organizationId, `promo:${promo.id}`), learnedKey(organizationId, `promo-copy:${promo.id}`)]);
    for (let i = 0; i < keys.length; i += 500) {
      const rows = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { key: { in: keys.slice(i, i + 500) } }, select: { key: true } }));
      for (const row of rows) present.add(row.key);
    }
    for (const promo of promos) {
      counts.promos! += 1;
      const missingReview = !present.has(learnedKey(organizationId, `promo:${promo.id}`));
      const missingCopy = !present.has(learnedKey(organizationId, `promo-copy:${promo.id}`));
      if (!missingReview && !missingCopy) {
        counts.present! += 1;
        continue;
      }
      const rows = missingReview ? await db.promoAnalysis.findMany({ where: { promoId: promo.id }, orderBy: { version: "desc" }, take: 25, select: { result: true, createdAt: true, score: true } }) : [];
      const analysis = currentAnalysis(rows);
      const notes = promoMasterNotes({ promo, brandName: brands.get(promo.brandId) ?? "Unknown brand", analysis });
      for (const note of notes) {
        if (present.has(learnedKey(organizationId, note.sourceRef))) continue;
        const result = await learnUp({ organizationId, brandId: promo.brandId, sourceRef: note.sourceRef, title: note.title, body: note.body, folder: note.folder, source: "promo-analyzer" });
        if (result === "created" || result === "refreshed") counts.created! += 1;
        else if (result === "failed") counts.failed! += 1;
      }
    }
  }
  return counts;
}

/**
 * Everything apps taught any brand Brain, deleted organizations included, is in
 * the Master Brain. (The hourly learn-up job covers live organizations only.)
 */
export async function learnUpEverywhere(): Promise<SyncCounts> {
  return learnUpBackfill({ organizationIds: await allOrganizationIds() });
}

/** Copy promos from every other organization into the console workspace, up to `limit` per call. */
export async function copyPromosIntoConsole(options: { limit?: number } = {}): Promise<SyncCounts> {
  const consoleId = await ensureConsoleOrganization();
  const target = tenantDb(consoleId);
  const brand = await target.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!brand) throw new Error("The console workspace has no brand.");
  const counts: SyncCounts = { copied: 0, already: 0, files: 0, analyses: 0, remaining: 0 };
  const limit = options.limit ?? 40;
  const copied = new Set((await target.promo.findMany({ where: { copiedFromId: { not: null } }, select: { copiedFromId: true } })).map((row) => row.copiedFromId!));
  for (const organizationId of await allOrganizationIds()) {
    if (organizationId === consoleId) continue;
    const source = tenantDb(organizationId);
    const brandNames = new Map((await source.brand.findMany({ select: { id: true, name: true } })).map((row) => [row.id, row.name]));
    const ids = await source.promo.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    for (const { id } of ids) {
      if (copied.has(id)) {
        counts.already! += 1;
        continue;
      }
      if (counts.copied! >= limit) {
        counts.remaining! += 1;
        continue;
      }
      const promo = await source.promo.findFirst({ where: { id }, include: { analyses: { orderBy: { version: "asc" } }, files: true } });
      if (!promo) continue;
      const created = await target.promo.create({
        data: {
          organizationId: consoleId,
          brandId: brand.id,
          title: promo.title,
          filename: promo.filename,
          inputType: promo.inputType,
          sourceText: promo.sourceText,
          // The publisher a promo was made for is worth keeping; the brand name stands in when none was set.
          publisher: promo.publisher ?? brandNames.get(promo.brandId) ?? null,
          gurus: promo.gurus,
          product: promo.product,
          promoType: promo.promoType,
          promoStatus: promo.promoStatus,
          promoCode: promo.promoCode,
          runStartDate: promo.runStartDate,
          pricePoint: promo.pricePoint,
          analysisStatus: promo.analysisStatus === "RUNNING" || promo.analysisStatus === "QUEUED" ? "NONE" : promo.analysisStatus,
          analysisError: promo.analysisError,
          effectivenessScore: promo.effectivenessScore,
          fkReadingEase: promo.fkReadingEase,
          fkGradeLevel: promo.fkGradeLevel,
          myScore: promo.myScore,
          performanceScore: promo.performanceScore,
          trainingNotes: promo.trainingNotes,
          isBestPerformer: promo.isBestPerformer,
          source: promo.source,
          uploadedById: promo.uploadedById,
          copiedFromId: promo.id,
          createdAt: promo.createdAt,
        },
        select: { id: true },
      });
      for (const analysis of promo.analyses) {
        await target.promoAnalysis.create({
          data: {
            organizationId: consoleId,
            promoId: created.id,
            version: analysis.version,
            model: analysis.model,
            result: analysis.result as Prisma.InputJsonValue,
            score: analysis.score,
            inputTokens: analysis.inputTokens,
            outputTokens: analysis.outputTokens,
            createdById: analysis.createdById,
            createdAt: analysis.createdAt,
          },
        });
        counts.analyses! += 1;
      }
      for (const file of promo.files) {
        await target.promoFile.create({
          data: { organizationId: consoleId, promoId: created.id, kind: file.kind, category: file.category, filename: file.filename, mimeType: file.mimeType, size: file.size, data: file.data, createdAt: file.createdAt },
        });
        counts.files! += 1;
      }
      copied.add(id);
      counts.copied! += 1;
    }
  }
  return counts;
}

/** Copy captured videos (transcript, extraction, keyframes) from every other organization into the console's VidRipper. */
export async function copyVideosIntoConsole(options: { limit?: number } = {}): Promise<SyncCounts> {
  const consoleId = await ensureConsoleOrganization();
  const target = tenantDb(consoleId);
  const brand = await target.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!brand) throw new Error("The console workspace has no brand.");
  const counts: SyncCounts = { copied: 0, already: 0, frames: 0, remaining: 0 };
  const limit = options.limit ?? 60;
  const copied = new Set((await target.intelVideo.findMany({ where: { copiedFromId: { not: null } }, select: { copiedFromId: true } })).map((row) => row.copiedFromId!));
  for (const organizationId of await allOrganizationIds()) {
    if (organizationId === consoleId) continue;
    const source = tenantDb(organizationId);
    const ids = await source.intelVideo.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    for (const { id } of ids) {
      if (copied.has(id)) {
        counts.already! += 1;
        continue;
      }
      if (counts.copied! >= limit) {
        counts.remaining! += 1;
        continue;
      }
      const video = await source.intelVideo.findFirst({ where: { id }, include: { frames: true, competitor: { select: { name: true } } } });
      if (!video) continue;
      const running = video.status === "QUEUED" || video.status === "RUNNING";
      const created = await target.intelVideo.create({
        data: {
          organizationId: consoleId,
          brandId: brand.id,
          url: video.url,
          mediaUrl: video.mediaUrl,
          platform: video.platform,
          // Competitors are per organization and are not copied; keep the name on the title.
          title: video.competitor && video.title && !video.title.includes(video.competitor.name) ? `${video.competitor.name}: ${video.title}` : (video.title ?? video.competitor?.name ?? null),
          uploader: video.uploader,
          durationSec: video.durationSec,
          thumbnailUrl: video.thumbnailUrl,
          status: running ? "FAILED" : video.status,
          step: null,
          error: running ? "This capture was still running in its organization when it was copied. Re-capture it here." : video.error,
          attempts: video.attempts,
          transcript: video.transcript,
          transcriptSource: video.transcriptSource,
          videoType: video.videoType,
          extractionStatus: video.extractionStatus === "RUNNING" || video.extractionStatus === "QUEUED" ? "NONE" : video.extractionStatus,
          extractionError: video.extractionError,
          extraction: video.extraction === null ? undefined : (video.extraction as Prisma.InputJsonValue),
          extractionModel: video.extractionModel,
          extractedAt: video.extractedAt,
          startedAt: video.startedAt,
          finishedAt: video.finishedAt,
          createdById: video.createdById,
          copiedFromId: video.id,
          createdAt: video.createdAt,
        },
        select: { id: true },
      });
      for (const frame of video.frames) {
        await target.intelVideoFrame.create({ data: { organizationId: consoleId, videoId: created.id, position: frame.position, atSec: frame.atSec, data: frame.data, size: frame.size, createdAt: frame.createdAt } });
        counts.frames! += 1;
      }
      copied.add(id);
      counts.copied! += 1;
    }
  }
  return counts;
}

export type PastNote = { id: string; title: string; folder: string | null; updatedAt: Date; where: string; sourceRef: string | null; snippet: string };

/**
 * Master Brain notes learned from Promo Analyzer reviews or VidRipper captures,
 * newest first. For videos this is often the only record left.
 */
export async function pastFromMasterBrain(kind: "videos" | "promos", options: { q?: string; take?: number } = {}): Promise<{ notes: PastNote[]; total: number }> {
  const prefix = kind === "videos" ? "intel-video:" : "promo:";
  const q = options.q?.trim();
  const where: Prisma.MainBrainNoteWhereInput = {
    deletedAt: null,
    originSourceRef: { startsWith: prefix },
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, orgs] = await Promise.all([
    mainBrain((tx) =>
      tx.mainBrainNote.findMany({ where, orderBy: { updatedAt: "desc" }, take: options.take ?? 200, select: { id: true, title: true, folder: true, updatedAt: true, body: true, originOrganizationId: true, originSourceRef: true } }),
    ),
    mainBrain((tx) => tx.mainBrainNote.count({ where })),
    rawPrisma().organization.findMany({ select: { id: true, name: true, deletedAt: true } }),
  ]);
  const names = new Map(orgs.map((org) => [org.id, org.deletedAt ? `${org.name} (deleted)` : org.name]));
  return {
    total,
    notes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      folder: row.folder,
      updatedAt: row.updatedAt,
      sourceRef: row.originSourceRef,
      where: row.originOrganizationId ? (names.get(row.originOrganizationId) ?? "An organization that no longer exists") : "An organization that no longer exists",
      snippet: snippetOf(row.body),
    })),
  };
}

function snippetOf(body: string): string {
  const text = body
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .join(" ")
    .replace(/[*_`>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

/** Counts for the console's Past data page. */
export async function pastDataCounts() {
  const consoleId = await ensureConsoleOrganization();
  const orgIds = (await allOrganizationIds()).filter((id) => id !== consoleId);
  let promos = 0;
  let videos = 0;
  for (const id of orgIds) {
    promos += await tenantDb(id).promo.count({ where: { deletedAt: null } });
    videos += await tenantDb(id).intelVideo.count({ where: { deletedAt: null } });
  }
  const target = tenantDb(consoleId);
  const [copiedPromos, copiedVideos, consolePromos, consoleVideos, brainPromos, brainVideos] = await Promise.all([
    target.promo.count({ where: { copiedFromId: { not: null } } }),
    target.intelVideo.count({ where: { copiedFromId: { not: null } } }),
    target.promo.count({ where: { deletedAt: null } }),
    target.intelVideo.count({ where: { deletedAt: null } }),
    mainBrain((tx) => tx.mainBrainNote.count({ where: { deletedAt: null, originSourceRef: { startsWith: "promo:" } } })),
    mainBrain((tx) => tx.mainBrainNote.count({ where: { deletedAt: null, originSourceRef: { startsWith: "intel-video:" } } })),
  ]);
  return { otherOrgPromos: promos, otherOrgVideos: videos, copiedPromos, copiedVideos, consolePromos, consoleVideos, brainPromos, brainVideos };
}
