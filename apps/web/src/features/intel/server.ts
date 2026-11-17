import { aiConfigured, runStructured } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { appendOrgAudit, Prisma, tenantDb } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { runPromoAnalysis } from "../promos/server";
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
  RADAR_SCHEMA,
  RADAR_SYSTEM,
  buildRadar,
  competitorKeyOf,
  contentLinks,
  emailBrainNote,
  extractionPrompt,
  isCommercial,
  isoDay,
  matchCompetitor,
  normalizeExtraction,
  normalizeNarrative,
  placementFromTakeoutLabels,
  promoKey,
  radarBrainNote,
  radarPrompt,
  weekEndOf,
  type EmailExtraction,
  type EmailLink,
  type PreparedEmail,
  type RadarEmail,
  type RadarNarrative,
  type RadarSummary,
} from "../../../../../modules/intel/index";
import type { IntelBrand } from "./context";
import { captureEmailLanding, loadLanding } from "./landing";
import { linkEmail, linkEntities, loadRegistry } from "./registry";
import { readSettings } from "./settings";

/** A run stuck this long (server restarted mid-run) is shown as interrupted. */
export const STALE_RUN_MS = 10 * 60 * 1000;

export function isStale(status: string, updatedAt: Date): boolean {
  return (status === "RUNNING" || status === "QUEUED") && Date.now() - updatedAt.getTime() > STALE_RUN_MS;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function competitorMatchers(organizationId: string, brandId: string) {
  return tenantDb(organizationId).intelCompetitor.findMany({
    where: { brandId, deletedAt: null },
    select: { id: true, name: true, senderAddresses: true, senderDomains: true, websites: true },
  });
}

export type StoreResult = { added: number; duplicates: number; ids: string[] };

/** Save prepared emails into the brand inbox: match the sender, skip duplicates, queue extraction. */
export async function storeEmails(input: {
  organizationId: string;
  brandId: string;
  actorId: string | null;
  source: "upload" | "mbox" | "paste" | "gmail";
  emails: readonly (PreparedEmail & { gmailMessageId?: string; placement?: string | null })[];
  gmailAccountId?: string;
}): Promise<StoreResult> {
  const db = tenantDb(input.organizationId);
  const matchers = await competitorMatchers(input.organizationId, input.brandId);
  const queued = aiConfigured() ? "QUEUED" : "NONE";
  const result: StoreResult = { added: 0, duplicates: 0, ids: [] };
  const registry = await loadRegistry(input.organizationId, input.brandId);
  for (const email of input.emails) {
    const match = matchCompetitor(email.fromAddress, matchers);
    try {
      const row = await db.intelEmail.create({
        data: {
          organizationId: input.organizationId,
          brandId: input.brandId,
          competitorId: match?.competitorId ?? null,
          matchedBy: match?.matchedBy ?? null,
          source: input.source,
          gmailAccountId: input.gmailAccountId ?? null,
          gmailMessageId: email.gmailMessageId ?? null,
          messageId: email.messageId,
          dedupeKey: email.dedupeKey,
          subject: email.subject,
          fromName: email.fromName,
          fromAddress: email.fromAddress,
          toAddress: email.toAddress,
          receivedAt: email.receivedAt,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
          snippet: email.snippet,
          links: email.links as unknown as Prisma.InputJsonValue,
          landingUrl: email.landingUrl,
          placement: email.placement ?? placementFromTakeoutLabels(email.headers["x-gmail-labels"]),
          raw: new Uint8Array(email.raw),
          rawSize: email.raw.byteLength,
          extractionStatus: queued,
          createdById: input.actorId,
        },
        select: { id: true },
      });
      result.added += 1;
      result.ids.push(row.id);
      // The sender's list (registry). Never blocks storing the email.
      await linkEntities({
        organizationId: input.organizationId,
        brandId: input.brandId,
        target: { emailId: row.id },
        registry,
        competitorId: match?.competitorId ?? null,
        sender: { fromName: email.fromName, fromAddress: email.fromAddress },
      }).catch((error: unknown) => console.error("[intel] list link failed", error));
    } catch (error) {
      if (isUniqueViolation(error)) {
        result.duplicates += 1;
        continue;
      }
      throw error;
    }
  }
  if (result.added) {
    await appendOrgAudit(input.organizationId, {
      actorId: input.actorId,
      action: "intel.emails.added",
      targetType: "intel_email",
      targetId: `${input.source}:${result.added}`,
    });
  }
  return result;
}

/** Re-run sender matching for emails nobody assigned by hand (after a competitor changes). */
export async function rematchEmails(organizationId: string, brandId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const matchers = await competitorMatchers(organizationId, brandId);
  const rows = await db.intelEmail.findMany({
    where: { brandId, deletedAt: null, OR: [{ matchedBy: null }, { matchedBy: { not: "manual" } }] },
    select: { id: true, fromAddress: true, competitorId: true, matchedBy: true },
  });
  let changed = 0;
  for (const row of rows) {
    const match = matchCompetitor(row.fromAddress, matchers);
    const competitorId = match?.competitorId ?? null;
    if (competitorId === row.competitorId && (match?.matchedBy ?? null) === row.matchedBy) continue;
    await db.intelEmail.updateMany({ where: { id: row.id }, data: { competitorId, matchedBy: match?.matchedBy ?? null } });
    changed += 1;
  }
  return changed;
}

// ── Extraction ──────────────────────────────────────────────────────────────

const draining = new Set<string>();

/** Work through the brand's queued emails one by one. Safe to call repeatedly. */
export async function drainExtractions(input: { organizationId: string; brand: IntelBrand; actorId: string | null; limit?: number }): Promise<void> {
  const key = `${input.organizationId}:${input.brand.id}`;
  if (draining.has(key) || !aiConfigured()) return;
  draining.add(key);
  try {
    const db = tenantDb(input.organizationId);
    for (let done = 0; done < (input.limit ?? 200); done += 1) {
      const next = await db.intelEmail.findFirst({
        where: { brandId: input.brand.id, deletedAt: null, extractionStatus: "QUEUED" },
        orderBy: { receivedAt: "desc" },
        select: { id: true },
      });
      if (!next) break;
      await runEmailExtraction({ organizationId: input.organizationId, brand: input.brand, emailId: next.id, actorId: input.actorId });
    }
  } finally {
    draining.delete(key);
  }
}

/** Run (or re-run) the AI extraction for one email, store it, and teach the Brain for promos. */
export async function runEmailExtraction(input: { organizationId: string; brand: IntelBrand; emailId: string; actorId: string | null }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const email = await db.intelEmail.findFirst({
    where: { id: input.emailId, brandId: input.brand.id, deletedAt: null },
    include: { competitor: { select: { name: true } } },
  });
  if (!email) return;
  await db.intelEmail.updateMany({ where: { id: email.id }, data: { extractionStatus: "RUNNING", extractionError: null } });
  try {
    const links = contentLinks((email.links as unknown as EmailLink[]) ?? []).slice(0, 40);
    // The landing page (text only) goes into the extraction when the brand allows fetching it.
    let landing = await loadLanding(input.organizationId, email.landingPageId);
    if (!landing && email.landingUrl && (await readSettings(input.organizationId, input.brand.id)).autoLanding) {
      landing = await captureEmailLanding({ organizationId: input.organizationId, brandId: input.brand.id, emailId: email.id }).catch(() => null);
    }
    const landingForPrompt = landing?.status === "OK" ? landing : null;
    const answer = await runStructured<Parameters<typeof normalizeExtraction>[0]>({
      system: EXTRACTION_SYSTEM,
      input: [
        {
          type: "text",
          text: extractionPrompt({
            brandContext: brandPromptContext(brandProfile(input.brand)),
            competitorName: email.competitor?.name ?? null,
            fromName: email.fromName,
            fromAddress: email.fromAddress,
            subject: email.subject,
            receivedAt: email.receivedAt,
            text: email.textBody,
            links,
            landing: landingForPrompt,
          }),
        },
      ],
      schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
      maxTokens: 6000,
    });
    if (answer.status !== "ok") {
      if ("usage" in answer && answer.usage) {
        await logAiUsage({ organizationId: input.organizationId, moduleId: "intel", feature: "intel.extract", actorId: input.actorId, usage: answer.usage });
      }
      // No key: leave it un-run rather than failed, so it can be run once a key is added.
      await db.intelEmail.updateMany({
        where: { id: email.id },
        data: { extractionStatus: answer.status === "unavailable" ? "NONE" : "FAILED", extractionError: answer.reason },
      });
      return;
    }
    await logAiUsage({ organizationId: input.organizationId, moduleId: "intel", feature: "intel.extract", actorId: input.actorId, usage: answer.usage });
    const extraction = normalizeExtraction(answer.data, links, email.landingUrl);
    await db.intelEmail.updateMany({
      where: { id: email.id },
      data: {
        extractionStatus: "DONE",
        extractionError: null,
        extraction: extraction as unknown as Prisma.InputJsonValue,
        extractionModel: answer.usage.model,
        extractedAt: new Date(),
        emailType: extraction.type,
        landingUrl: extraction.landingUrl ?? email.landingUrl,
      },
    });
    await linkEmail(input.organizationId, input.brand.id, email.id).catch((error: unknown) => console.error("[intel] registry link failed", error));
    if (isCommercial(extraction.type)) {
      const note = emailBrainNote({
        competitorName: email.competitor?.name ?? null,
        fromAddress: email.fromAddress,
        subject: email.subject,
        receivedAt: email.receivedAt,
        extraction,
      });
      await teachBrain({
        organizationId: input.organizationId,
        brandId: input.brand.id,
        sourceRef: `intel-email:${email.id}`,
        title: note.title,
        body: note.body,
        folder: "Competitor intel",
        source: "intel",
        actorId: input.actorId,
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The extraction failed.";
    await db.intelEmail.updateMany({ where: { id: email.id }, data: { extractionStatus: "FAILED", extractionError: reason } }).catch(() => undefined);
  }
}

// ── Promo Radar ─────────────────────────────────────────────────────────────

function asExtraction(value: unknown): EmailExtraction | null {
  return value && typeof value === "object" && "type" in value ? (value as EmailExtraction) : null;
}

/** The deterministic week summary, from stored emails. */
export async function computeRadar(organizationId: string, brandId: string, weekStart: Date): Promise<RadarSummary> {
  const db = tenantDb(organizationId);
  const end = weekEndOf(weekStart);
  const rows = await db.intelEmail.findMany({
    where: { brandId, deletedAt: null, receivedAt: { gte: weekStart, lt: end } },
    select: { id: true, competitorId: true, fromAddress: true, subject: true, receivedAt: true, extraction: true, competitor: { select: { name: true } } },
    orderBy: { receivedAt: "asc" },
    take: 5000,
  });
  const earlier = await db.intelEmail.findMany({
    where: { brandId, deletedAt: null, receivedAt: { lt: weekStart, gte: new Date(weekStart.getTime() - 180 * 86_400_000) }, extractionStatus: "DONE" },
    select: { competitorId: true, fromAddress: true, subject: true, extraction: true },
    take: 20000,
  });
  const earlierKeys = new Set<string>();
  for (const row of earlier) {
    const extraction = asExtraction(row.extraction);
    if (extraction && isCommercial(extraction.type)) earlierKeys.add(promoKey({ extraction, subject: row.subject, competitorKey: competitorKeyOf(row) }));
  }
  const emails: RadarEmail[] = rows.map((row) => ({
    id: row.id,
    competitorId: row.competitorId,
    competitorName: row.competitor?.name ?? null,
    fromAddress: row.fromAddress,
    subject: row.subject,
    receivedAt: row.receivedAt,
    extraction: asExtraction(row.extraction),
  }));
  return buildRadar({ weekStart, emails, earlierPromoKeys: earlierKeys });
}

/** Rebuild one week's radar, store it, then (with an AI key) write the narrative and teach the Brain. */
export async function buildRadarDigest(input: { organizationId: string; brand: IntelBrand; weekStart: Date; actorId: string | null }): Promise<string> {
  const db = tenantDb(input.organizationId);
  const summary = await computeRadar(input.organizationId, input.brand.id, input.weekStart);
  const status = aiConfigured() && summary.totals.promos > 0 ? "QUEUED" : "NONE";
  const existing = await db.intelRadarDigest.findFirst({ where: { brandId: input.brand.id, weekStart: input.weekStart }, select: { id: true } });
  let id = existing?.id;
  const data = { summary: summary as unknown as Prisma.InputJsonValue, status, error: aiConfigured() ? null : "The AI key is not set, so the radar has no written read. Add ANTHROPIC_API_KEY." };
  if (id) {
    await db.intelRadarDigest.updateMany({ where: { id }, data });
  } else {
    try {
      id = (await db.intelRadarDigest.create({ data: { organizationId: input.organizationId, brandId: input.brand.id, weekStart: input.weekStart, createdById: input.actorId, ...data }, select: { id: true } })).id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      id = (await db.intelRadarDigest.findFirst({ where: { brandId: input.brand.id, weekStart: input.weekStart }, select: { id: true } }))!.id;
      await db.intelRadarDigest.updateMany({ where: { id }, data });
    }
  }
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "intel.radar.built", targetType: "intel_radar", targetId: id });
  if (status === "NONE") {
    // No narrative to wait for: teach the deterministic digest now (only when there is something in it).
    if (summary.totals.promos > 0) await teachRadar(input, summary, null);
  }
  return id;
}

async function teachRadar(input: { organizationId: string; brand: IntelBrand; actorId: string | null }, summary: RadarSummary, narrative: RadarNarrative | null) {
  const note = radarBrainNote({ brandName: input.brand.name, summary, narrative });
  await teachBrain({
    organizationId: input.organizationId,
    brandId: input.brand.id,
    sourceRef: `intel-radar:${input.brand.id}:${summary.weekStart}`,
    title: note.title,
    body: note.body,
    folder: "Competitor intel",
    source: "intel",
    actorId: input.actorId,
  });
}

/** The AI read for a stored radar. Runs after the response. */
export async function runRadarNarrative(input: { organizationId: string; brand: IntelBrand; digestId: string; actorId: string | null }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const digest = await db.intelRadarDigest.findFirst({ where: { id: input.digestId, brandId: input.brand.id } });
  if (!digest || digest.status !== "QUEUED") return;
  await db.intelRadarDigest.updateMany({ where: { id: digest.id }, data: { status: "RUNNING", error: null } });
  const summary = digest.summary as unknown as RadarSummary;
  try {
    const answer = await runStructured<RadarNarrative>({
      system: RADAR_SYSTEM,
      input: [{ type: "text", text: radarPrompt({ brandContext: brandPromptContext(brandProfile(input.brand)), summary }) }],
      schema: RADAR_SCHEMA as unknown as Record<string, unknown>,
      effort: "medium",
      maxTokens: 8000,
    });
    if (answer.status !== "ok") {
      if ("usage" in answer && answer.usage) await logAiUsage({ organizationId: input.organizationId, moduleId: "intel", feature: "intel.radar", actorId: input.actorId, usage: answer.usage });
      await db.intelRadarDigest.updateMany({ where: { id: digest.id }, data: { status: answer.status === "unavailable" ? "NONE" : "FAILED", error: answer.reason } });
      await teachRadar(input, summary, null);
      return;
    }
    await logAiUsage({ organizationId: input.organizationId, moduleId: "intel", feature: "intel.radar", actorId: input.actorId, usage: answer.usage });
    const narrative = normalizeNarrative(answer.data);
    await db.intelRadarDigest.updateMany({
      where: { id: digest.id },
      data: { status: "DONE", error: null, narrative: narrative as unknown as Prisma.InputJsonValue, model: answer.usage.model },
    });
    await teachRadar(input, summary, narrative);
  } catch (error) {
    await db.intelRadarDigest
      .updateMany({ where: { id: digest.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : "The radar failed." } })
      .catch(() => undefined);
  }
}

// ── Promo Analyzer hand-off ─────────────────────────────────────────────────

/**
 * Create a Promo Analyzer promo in this brand from a competitor email and start its
 * analysis. Returns the promo id (an existing one if this email was sent before).
 */
export async function sendToPromoAnalyzer(input: { organizationId: string; brand: IntelBrand; emailId: string; actorId: string }): Promise<{ promoId: string; start: () => Promise<void> } | { error: string }> {
  const db = tenantDb(input.organizationId);
  const email = await db.intelEmail.findFirst({
    where: { id: input.emailId, brandId: input.brand.id, deletedAt: null },
    include: { competitor: { select: { name: true } } },
  });
  if (!email) return { error: "That email no longer exists." };
  if (email.analyzerPromoId) {
    const existing = await db.promo.findFirst({ where: { id: email.analyzerPromoId, deletedAt: null }, select: { id: true } });
    if (existing) return { promoId: existing.id, start: async () => undefined };
  }
  if (email.textBody.trim().length < 80) return { error: "This email has too little text to analyze." };
  const extraction = asExtraction(email.extraction);
  const header = [
    `Competitor email${email.competitor ? ` from ${email.competitor.name}` : ""} (${email.fromAddress}), sent ${isoDay(email.receivedAt)}.`,
    `Subject: ${email.subject}`,
    email.landingUrl ? `Landing page: ${email.landingUrl}` : null,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const promo = await db.promo.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brand.id,
      title: `${email.competitor?.name ?? email.fromAddress}: ${email.subject}`.slice(0, 200),
      inputType: "text",
      sourceText: `${header}\n${email.textBody}`.slice(0, 400_000),
      publisher: email.competitor?.name ?? null,
      gurus: extraction?.experts ?? [],
      product: extraction?.product ?? null,
      source: `intel-email:${email.id}`,
      analysisStatus: "QUEUED",
      uploadedById: input.actorId,
    },
    select: { id: true },
  });
  await db.intelEmail.updateMany({ where: { id: email.id }, data: { analyzerPromoId: promo.id } });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "promo.created", targetType: "promo", targetId: promo.id });
  return {
    promoId: promo.id,
    start: () => runPromoAnalysis({ organizationId: input.organizationId, promoId: promo.id, brand: input.brand, actorId: input.actorId }),
  };
}
