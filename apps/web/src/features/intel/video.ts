import { aiConfigured, runStructured } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { appendOrgAudit, rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { runPromoAnalysis } from "../promos/server";
import {
  CaptureError,
  EXTRACTION_SCHEMA,
  VIDEO_EXTRACTION_SYSTEM,
  checkUrlShape,
  contentLinks,
  emailBrainNote,
  extractLinks,
  guessLandingUrl,
  hostOf,
  isCommercial,
  isoDay,
  matchVideoCompetitor,
  normalizeExtraction,
  runCapturePipeline,
  videoExtractionPrompt,
  videoLimits,
  type EmailExtraction,
  type VideoStep,
} from "../../../../../modules/intel/index";
import type { IntelBrand } from "./context";
import { loadBrand } from "./gmail";
import { captureLanding, loadLanding, storeLandingHtml } from "./landing";
import { linkVideo } from "./registry";
import { createWorkspace, ToolMissingError } from "./video-tools";

/** A RUNNING capture whose heartbeat stopped this long ago was interrupted (server restart). */
export const VIDEO_STALE_MS = 10 * 60_000;
const HEARTBEAT_MS = 60_000;
/** A whole capture is stopped after this long. */
const CAPTURE_TIMEOUT_MS = 40 * 60_000;
const MAX_ATTEMPTS = 2;

/** Videos are serialized: one capture at a time per server (they are CPU-, disk- and bandwidth-heavy). */
let capturing = false;

function bypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx);
  });
}

export function isVideoStale(status: string, updatedAt: Date): boolean {
  return status === "RUNNING" && Date.now() - updatedAt.getTime() > VIDEO_STALE_MS;
}

/** Queue a capture. Returns the new video id, or an error to show. */
export async function queueVideo(input: { organizationId: string; brandId: string; actorId: string; url: string }): Promise<{ id: string } | { error: string }> {
  const shape = checkUrlShape(input.url);
  if (!shape.ok) return { error: shape.reason };
  const url = shape.url.toString().slice(0, 2000);
  const db = tenantDb(input.organizationId);
  const recent = await db.intelVideo.findFirst({ where: { brandId: input.brandId, url, deletedAt: null, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (recent) return { id: recent.id };
  const row = await db.intelVideo.create({
    data: { organizationId: input.organizationId, brandId: input.brandId, url, platform: null, status: "QUEUED", createdById: input.actorId },
    select: { id: true },
  });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "intel.video.queued", targetType: "intel_video", targetId: row.id });
  return row;
}

/** Interrupted captures go back in the queue once, then fail. */
async function reapStaleVideos(): Promise<void> {
  const cutoff = new Date(Date.now() - VIDEO_STALE_MS);
  await bypass(async (tx) => {
    await tx.intelVideo.updateMany({ where: { status: "RUNNING", updatedAt: { lt: cutoff }, attempts: { lt: MAX_ATTEMPTS } }, data: { status: "QUEUED", step: null } });
    await tx.intelVideo.updateMany({
      where: { status: "RUNNING", updatedAt: { lt: cutoff }, attempts: { gte: MAX_ATTEMPTS } },
      data: { status: "FAILED", step: null, error: "The capture was interrupted twice (the server restarted). Try again.", finishedAt: new Date() },
    });
  });
}

/**
 * Work through the queue (oldest first, every organization) until it is empty
 * or the time budget runs out. One capture at a time, also across servers: a
 * fresh RUNNING row anywhere means another server is busy, so this one waits.
 */
export async function drainVideoQueue(options: { budgetMs?: number } = {}): Promise<{ processed: number; skipped?: string }> {
  if (capturing) return { processed: 0, skipped: "a capture is already running on this server" };
  capturing = true;
  const deadline = Date.now() + (options.budgetMs ?? 50 * 60_000);
  let processed = 0;
  try {
    await reapStaleVideos();
    while (Date.now() < deadline) {
      const { running, next } = await bypass(async (tx) => ({
        running: await tx.intelVideo.count({ where: { status: "RUNNING", deletedAt: null } }),
        next: await tx.intelVideo.findFirst({ where: { status: "QUEUED", deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, organizationId: true, brandId: true } }),
      }));
      if (running > 0) return { processed, skipped: "another capture is running" };
      if (!next) break;
      const claimed = await tenantDb(next.organizationId).intelVideo.updateMany({
        where: { id: next.id, status: "QUEUED" },
        data: { status: "RUNNING", step: null, error: null, startedAt: new Date(), attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      const brand = await loadBrand(next.organizationId, next.brandId);
      if (!brand) {
        await tenantDb(next.organizationId).intelVideo.updateMany({ where: { id: next.id }, data: { status: "FAILED", error: "The brand no longer exists." } });
        continue;
      }
      await captureVideo({ organizationId: next.organizationId, brand, videoId: next.id });
      processed += 1;
    }
    return { processed };
  } finally {
    capturing = false;
  }
}

/** Run one claimed capture end to end. Never throws. */
async function captureVideo(input: { organizationId: string; brand: IntelBrand; videoId: string }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const video = await db.intelVideo.findFirst({ where: { id: input.videoId, brandId: input.brand.id } });
  if (!video) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
  let current: VideoStep | null = null;
  // Rewriting the step bumps updated_at, which tells other servers this capture is alive.
  const heartbeat = setInterval(() => {
    void db.intelVideo.updateMany({ where: { id: video.id, status: "RUNNING" }, data: { step: current } }).catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  const setStep = async (step: VideoStep) => {
    current = step;
    await db.intelVideo.updateMany({ where: { id: video.id }, data: { step } });
  };
  let workspace: Awaited<ReturnType<typeof createWorkspace>> | null = null;
  try {
    const limits = videoLimits(process.env);
    workspace = await createWorkspace({ limits, onStep: setStep, signal: controller.signal });
    const result = await runCapturePipeline(workspace.deps, { url: video.url, limits });

    // The page the video sits on is its landing page; for platform links, the description's main link.
    let landingId: string | null = null;
    if (result.page) {
      landingId = (await storeLandingHtml({ organizationId: input.organizationId, brandId: input.brand.id, url: video.url, finalUrl: result.page.finalUrl, html: result.page.html }))?.id ?? null;
    } else if (result.description) {
      const guess = guessLandingUrl(contentLinks(extractLinks(null, result.description, 40)));
      if (guess) landingId = (await captureLanding({ organizationId: input.organizationId, brandId: input.brand.id, url: guess }).catch(() => null))?.id ?? null;
    }

    const competitors = await db.intelCompetitor.findMany({
      where: { brandId: input.brand.id, deletedAt: null },
      select: { id: true, name: true, products: true, websites: true, senderDomains: true },
    });
    const match = video.matchedBy === "manual" ? null : matchVideoCompetitor({ pageUrl: result.page?.finalUrl ?? video.url, uploader: result.uploader }, competitors);

    await db.intelVideoFrame.deleteMany({ where: { videoId: video.id } });
    for (const [position, frame] of result.frames.entries()) {
      await db.intelVideoFrame.create({ data: { organizationId: input.organizationId, videoId: video.id, position, atSec: frame.atSec, data: new Uint8Array(frame.data), size: frame.data.byteLength } });
    }
    const extract = aiConfigured() && (result.transcript.length > 0 || Boolean(landingId));
    await db.intelVideo.updateMany({
      where: { id: video.id },
      data: {
        status: "DONE",
        step: null,
        finishedAt: new Date(),
        mediaUrl: result.mediaUrl.slice(0, 2000),
        platform: result.platform,
        title: result.title,
        uploader: result.uploader,
        durationSec: result.durationSec,
        thumbnailUrl: result.thumbnailUrl,
        transcript: result.transcript.slice(0, 1_000_000),
        transcriptSource: result.transcriptSource,
        landingPageId: landingId,
        error: result.warnings.join(" ").slice(0, 1000) || null,
        ...(match ? { competitorId: match.competitorId, matchedBy: match.matchedBy } : {}),
        extractionStatus: extract ? "QUEUED" : "NONE",
        extractionError: aiConfigured() ? null : "The AI key is not set, so the video was not extracted. Add ANTHROPIC_API_KEY.",
      },
    });
    await appendOrgAudit(input.organizationId, { actorId: video.createdById, action: "intel.video.captured", targetType: "intel_video", targetId: video.id });
    if (extract) await runVideoExtraction({ organizationId: input.organizationId, brand: input.brand, videoId: video.id, actorId: video.createdById });
  } catch (error) {
    const reason =
      error instanceof CaptureError || error instanceof ToolMissingError
        ? error.message
        : controller.signal.aborted
          ? "The capture took longer than 40 minutes and was stopped."
          : `The capture failed: ${error instanceof Error ? error.message : "unknown error"}`;
    await db.intelVideo.updateMany({ where: { id: video.id }, data: { status: "FAILED", step: null, error: reason.slice(0, 1000), finishedAt: new Date() } }).catch(() => undefined);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    await workspace?.cleanup().catch(() => undefined);
  }
}

/** The same AI extraction emails get, read from the transcript and page. */
export async function runVideoExtraction(input: { organizationId: string; brand: IntelBrand; videoId: string; actorId: string | null }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const video = await db.intelVideo.findFirst({ where: { id: input.videoId, brandId: input.brand.id, deletedAt: null }, include: { competitor: { select: { name: true } } } });
  if (!video) return;
  await db.intelVideo.updateMany({ where: { id: video.id }, data: { extractionStatus: "RUNNING", extractionError: null } });
  try {
    const landing = await loadLanding(input.organizationId, video.landingPageId);
    const page = landing?.status === "OK" ? landing : null;
    const links = contentLinks(page?.links ?? []).slice(0, 40);
    const answer = await runStructured<Parameters<typeof normalizeExtraction>[0]>({
      system: VIDEO_EXTRACTION_SYSTEM,
      input: [
        {
          type: "text",
          text: videoExtractionPrompt({
            brandContext: brandPromptContext(brandProfile(input.brand)),
            competitorName: video.competitor?.name ?? null,
            title: video.title,
            uploader: video.uploader,
            url: video.url,
            durationSec: video.durationSec,
            transcript: video.transcript,
            links,
            landing: page,
          }),
        },
      ],
      schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
      maxTokens: 6000,
    });
    if (answer.status !== "ok") {
      if ("usage" in answer && answer.usage) await logAiUsage({ organizationId: input.organizationId, moduleId: "intel", feature: "intel.video.extract", actorId: input.actorId, usage: answer.usage });
      await db.intelVideo.updateMany({ where: { id: video.id }, data: { extractionStatus: answer.status === "unavailable" ? "NONE" : "FAILED", extractionError: answer.reason } });
      return;
    }
    await logAiUsage({ organizationId: input.organizationId, moduleId: "intel", feature: "intel.video.extract", actorId: input.actorId, usage: answer.usage });
    const extraction = normalizeExtraction(answer.data, links, page?.finalUrl ?? null);
    await db.intelVideo.updateMany({
      where: { id: video.id },
      data: { extractionStatus: "DONE", extractionError: null, extraction: extraction as unknown as Prisma.InputJsonValue, extractionModel: answer.usage.model, extractedAt: new Date(), videoType: extraction.type },
    });
    await linkVideo(input.organizationId, input.brand.id, video.id).catch((error: unknown) => console.error("[intel] video registry link failed", error));
    if (isCommercial(extraction.type)) {
      const note = emailBrainNote({
        competitorName: video.competitor?.name ?? null,
        fromAddress: hostOf(video.url) ?? video.url,
        subject: `Video: ${video.title ?? video.url}`,
        receivedAt: video.createdAt,
        extraction,
      });
      await teachBrain({
        organizationId: input.organizationId,
        brandId: input.brand.id,
        sourceRef: `intel-video:${video.id}`,
        title: note.title,
        body: note.body.replace("Captured by Intel.", "Captured by Intel from a video transcript."),
        folder: "Competitor intel",
        source: "intel",
        actorId: input.actorId,
      });
    }
  } catch (error) {
    await db.intelVideo
      .updateMany({ where: { id: video.id }, data: { extractionStatus: "FAILED", extractionError: error instanceof Error ? error.message : "The extraction failed." } })
      .catch(() => undefined);
  }
}

/** Create a Promo Analyzer promo from a video transcript and start its analysis. */
export async function sendVideoToPromoAnalyzer(input: { organizationId: string; brand: IntelBrand; videoId: string; actorId: string }): Promise<{ promoId: string; start: () => Promise<void> } | { error: string }> {
  const db = tenantDb(input.organizationId);
  const video = await db.intelVideo.findFirst({ where: { id: input.videoId, brandId: input.brand.id, deletedAt: null }, include: { competitor: { select: { name: true } } } });
  if (!video) return { error: "That video no longer exists." };
  if (video.analyzerPromoId) {
    const existing = await db.promo.findFirst({ where: { id: video.analyzerPromoId, deletedAt: null }, select: { id: true } });
    if (existing) return { promoId: existing.id, start: async () => undefined };
  }
  if (video.transcript.trim().length < 200) return { error: "This video has no usable transcript to analyze." };
  const extraction = video.extraction as EmailExtraction | null;
  const landing = await loadLanding(input.organizationId, video.landingPageId);
  const header = [
    `Competitor video${video.competitor ? ` from ${video.competitor.name}` : ""}, captured ${isoDay(video.createdAt)}.`,
    `Page: ${video.url}`,
    video.title ? `Title: ${video.title}` : null,
    landing?.status === "OK" && landing.headings.length ? `Headline on the page: ${landing.headings.slice(0, 3).join(" / ")}` : null,
    "",
    "Transcript:",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const promo = await db.promo.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brand.id,
      title: `${video.competitor?.name ?? hostOf(video.url) ?? "Video"}: ${video.title ?? "video transcript"}`.slice(0, 200),
      inputType: "text",
      sourceText: `${header}\n${video.transcript}`.slice(0, 400_000),
      publisher: video.competitor?.name ?? null,
      gurus: extraction?.experts ?? [],
      product: extraction?.product ?? null,
      source: `intel-video:${video.id}`,
      analysisStatus: "QUEUED",
      uploadedById: input.actorId,
    },
    select: { id: true },
  });
  await db.intelVideo.updateMany({ where: { id: video.id }, data: { analyzerPromoId: promo.id } });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "promo.created", targetType: "promo", targetId: promo.id });
  return { promoId: promo.id, start: () => runPromoAnalysis({ organizationId: input.organizationId, promoId: promo.id, brand: input.brand, actorId: input.actorId }) };
}
