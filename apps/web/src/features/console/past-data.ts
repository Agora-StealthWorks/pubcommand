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
      // Promos brought over from the OxfordHub analyzer already have their notes in the Master Brain (vault import).
      where: { deletedAt: null, copiedFromId: null, NOT: { source: { startsWith: "oxfordhub" } } },
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
  const counts: SyncCounts = { copied: 0, already: 0, analyses: 0, remaining: 0, filesRemoved: 0 };
  const limit = options.limit ?? 40;
  const copies = await target.promo.findMany({ where: { copiedFromId: { not: null } }, select: { id: true, copiedFromId: true } });
  // Earlier versions copied file bytes too; drop those duplicates (the originals are untouched).
  if (copies.length) counts.filesRemoved = (await target.promoFile.deleteMany({ where: { promoId: { in: copies.map((row) => row.id) } } })).count;
  const copied = new Map(copies.map((row) => [row.copiedFromId!, row.id]));
  for (const organizationId of await allOrganizationIds()) {
    if (organizationId === consoleId) continue;
    const source = tenantDb(organizationId);
    const brandNames = new Map((await source.brand.findMany({ select: { id: true, name: true } })).map((row) => [row.id, row.name]));
    const ids = await source.promo.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    for (const { id } of ids) {
      const copyId = copied.get(id);
      if (copyId) {
        counts.already! += 1;
        counts.analyses! += await syncNewAnalyses(source, target, consoleId, id, copyId);
        continue;
      }
      if (counts.copied! >= limit) {
        counts.remaining! += 1;
        continue;
      }
      const promo = await source.promo.findFirst({ where: { id }, include: { analyses: { orderBy: { version: "asc" } } } });
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
      // File bytes are not copied: they live in Postgres and would double the database's size.
      // The copy keeps the text and analyses; the original file stays with the original promo.
      copied.set(id, created.id);
      counts.copied! += 1;
    }
  }
  return counts;
}

type TenantDb = ReturnType<typeof tenantDb>;

/** Analyses the original got after it was copied (e.g. queued analysis of imported promos) follow to the console's copy. */
async function syncNewAnalyses(source: TenantDb, target: TenantDb, consoleId: string, originalId: string, copyId: string): Promise<number> {
  const have = await target.promoAnalysis.findMany({ where: { promoId: copyId }, select: { version: true } });
  const latest = have.reduce((max, row) => Math.max(max, row.version), 0);
  const newer = await source.promoAnalysis.findMany({ where: { promoId: originalId, version: { gt: latest } }, orderBy: { version: "asc" } });
  if (newer.length === 0) return 0;
  for (const analysis of newer) {
    await target.promoAnalysis.create({
      data: { organizationId: consoleId, promoId: copyId, version: analysis.version, model: analysis.model, result: analysis.result as Prisma.InputJsonValue, score: analysis.score, inputTokens: analysis.inputTokens, outputTokens: analysis.outputTokens, createdById: analysis.createdById, createdAt: analysis.createdAt },
    });
  }
  const original = await source.promo.findFirst({ where: { id: originalId }, select: { analysisStatus: true, analysisError: true, effectivenessScore: true, fkReadingEase: true, fkGradeLevel: true, publisher: true, gurus: true, product: true, promoType: true, pricePoint: true } });
  if (original) {
    await target.promo.updateMany({
      where: { id: copyId },
      data: { ...original, analysisStatus: original.analysisStatus === "RUNNING" || original.analysisStatus === "QUEUED" ? "NONE" : original.analysisStatus },
    });
  }
  return newer.length;
}

/**
 * The Packager's work follows its promos into the console: every copy package
 * (components and their version history) of a copied promo, and every training
 * example (the Packager's library), with promo links pointed at the console's
 * copies. Idempotent: packages by copied_from_id, examples by sourceRef
 * "copied:<original id>". Best-performer copies are marked edited so the
 * console's own best-performer sync never retires them.
 */
export async function copyPackagerIntoConsole(): Promise<SyncCounts> {
  const consoleId = await ensureConsoleOrganization();
  const target = tenantDb(consoleId);
  const brand = await target.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!brand) throw new Error("The console workspace has no brand.");
  const counts: SyncCounts = { packages: 0, components: 0, versions: 0, examples: 0 };
  // Original promo id → the console's copy.
  const promoMap = new Map((await target.promo.findMany({ where: { copiedFromId: { not: null } }, select: { id: true, copiedFromId: true } })).map((row) => [row.copiedFromId!, row.id]));
  const copiedPackages = new Set((await target.promoPackage.findMany({ where: { copiedFromId: { not: null } }, select: { copiedFromId: true } })).map((row) => row.copiedFromId!));
  const copiedExamples = new Set((await target.promoTrainingExample.findMany({ where: { sourceRef: { startsWith: "copied:" } }, select: { sourceRef: true } })).map((row) => row.sourceRef!));
  for (const organizationId of await allOrganizationIds()) {
    if (organizationId === consoleId) continue;
    const source = tenantDb(organizationId);
    const packages = await source.promoPackage.findMany({ where: { deletedAt: null }, include: { components: { include: { versions: { orderBy: { version: "asc" } } } } } });
    for (const pkg of packages) {
      const promoId = promoMap.get(pkg.promoId);
      if (!promoId || copiedPackages.has(pkg.id)) continue;
      const created = await target.promoPackage.create({
        data: {
          organizationId: consoleId,
          brandId: brand.id,
          promoId,
          title: pkg.title,
          status: pkg.status,
          direction: pkg.direction as Prisma.InputJsonValue,
          research: pkg.research as Prisma.InputJsonValue,
          researchStatus: pkg.researchStatus === "RUNNING" ? "NONE" : pkg.researchStatus,
          researchError: pkg.researchError,
          researchedAt: pkg.researchedAt,
          createdById: pkg.createdById,
          approvedById: pkg.approvedById,
          approvedAt: pkg.approvedAt,
          copiedFromId: pkg.id,
          createdAt: pkg.createdAt,
        },
        select: { id: true },
      });
      for (const component of pkg.components) {
        const createdComponent = await target.promoPackageComponent.create({
          data: {
            organizationId: consoleId,
            packageId: created.id,
            kind: component.kind,
            position: component.position,
            quantity: component.quantity,
            content: component.content,
            status: component.status,
            genStatus: component.genStatus === "RUNNING" || component.genStatus === "QUEUED" ? "NONE" : component.genStatus,
            genError: component.genError,
            flags: component.flags as Prisma.InputJsonValue,
            currentVersion: component.currentVersion,
            examplesUsed: component.examplesUsed as Prisma.InputJsonValue,
            createdAt: component.createdAt,
          },
          select: { id: true },
        });
        counts.components! += 1;
        for (const version of component.versions) {
          await target.promoPackageComponentVersion.create({
            data: {
              organizationId: consoleId,
              componentId: createdComponent.id,
              version: version.version,
              source: version.source,
              content: version.content,
              feedback: version.feedback,
              model: version.model,
              inputTokens: version.inputTokens,
              outputTokens: version.outputTokens,
              createdById: version.createdById,
              createdAt: version.createdAt,
            },
          });
          counts.versions! += 1;
        }
      }
      copiedPackages.add(pkg.id);
      counts.packages! += 1;
    }
    const examples = await source.promoTrainingExample.findMany({ orderBy: { createdAt: "asc" } });
    for (const example of examples) {
      const ref = `copied:${example.id}`;
      if (copiedExamples.has(ref)) continue;
      // A promo-linked example points at the console's copy; when that promo is not over yet, it waits for the next run.
      if (example.promoId && !promoMap.has(example.promoId)) continue;
      await target.promoTrainingExample.create({
        data: {
          organizationId: consoleId,
          brandId: brand.id,
          kind: example.kind,
          publication: example.publication,
          niche: example.niche,
          title: example.title,
          content: example.content,
          source: example.source,
          sourceRef: ref,
          promoId: example.promoId ? promoMap.get(example.promoId)! : null,
          tags: example.tags,
          note: example.note,
          enabled: example.enabled,
          // The console's best-performer sync retires unedited best-performer examples it did not make itself; keep the copies.
          edited: example.edited || example.source === "best-performer",
          createdById: example.createdById,
          createdAt: example.createdAt,
        },
      });
      copiedExamples.add(ref);
      counts.examples! += 1;
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
