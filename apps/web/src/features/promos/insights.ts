import { runStructured } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { PROMO_TYPES, type PromoAnalysisResult } from "../../../../../modules/promo-studio/analysis";
import { ENTITY_KINDS, resolveName, type EntityKind, type EntityOverride } from "../../../../../modules/promo-studio/entities";
import {
  LESSON_SCHEMA,
  LESSON_SYSTEM,
  applyClusters,
  buildLessonItems,
  lessonPrompt,
  lessonsBrainNote,
  sameTheme,
  type LessonAnswer,
} from "../../../../../modules/promo-studio/lessons";
import {
  TIER_LABELS,
  cohortFor,
  computeTiers,
  mapRows,
  parseSheet,
  percentileScore,
  performanceBrainNote,
  promoCodeKeys,
  type ColumnMapping,
  type TierKey,
} from "../../../../../modules/promo-studio/performance";
import { BULK_CONCURRENCY, createQueue } from "../../../../../modules/promo-studio/queue";
import { scoreVector, type CalibrationPoint, type TrainingPair } from "../../../../../modules/promo-studio/similar";
import { runPromoAnalysis } from "./server";

type Brand = { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };

// ---------------------------------------------------------------------------
// Shared reads

/** The newest analysis result per promo (only promos that have one). */
export async function latestResults(organizationId: string, promoIds: string[]): Promise<Map<string, PromoAnalysisResult>> {
  if (!promoIds.length) return new Map();
  const rows = await tenantDb(organizationId).promoAnalysis.findMany({
    where: { promoId: { in: promoIds } },
    orderBy: { version: "desc" },
    select: { promoId: true, result: true },
  });
  const out = new Map<string, PromoAnalysisResult>();
  for (const row of rows) if (!out.has(row.promoId)) out.set(row.promoId, row.result as unknown as PromoAnalysisResult);
  return out;
}

export async function loadOverrides(organizationId: string, brandId: string): Promise<EntityOverride[]> {
  const rows = await tenantDb(organizationId).promoEntityOverride.findMany({ where: { brandId }, orderBy: { createdAt: "asc" } });
  return rows
    .filter((row) => (ENTITY_KINDS as readonly string[]).includes(row.kind))
    .map((row) => ({ kind: row.kind as EntityKind, fromKey: row.fromKey, fromName: row.fromName, toName: row.toName, hidden: row.hidden }));
}

export type PerformanceRecord = Awaited<ReturnType<typeof listPerformance>>[number];

export async function listPerformance(organizationId: string, brandId: string) {
  const rows = await tenantDb(organizationId).promoPerformance.findMany({ where: { brandId }, orderBy: [{ percentile: { sort: "desc", nulls: "last" } }, { promoCode: "asc" }], take: 2000 });
  return rows.map((row) => ({ ...row, tierLabel: row.tier ? (TIER_LABELS[row.tier as TierKey] ?? row.tier) : null }));
}

/** Real-world 1-10 score per promo: what a person entered wins, else the results percentile. */
export async function realWorldScores(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const [promos, perf] = await Promise.all([
    db.promo.findMany({ where: { brandId, deletedAt: null }, select: { id: true, performanceScore: true } }),
    db.promoPerformance.findMany({ where: { brandId, promoId: { not: null } }, select: { promoId: true, percentile: true, tier: true } }),
  ]);
  const byPromo = new Map<string, { score: number; source: "you" | "results" }>();
  const perfByPromo = new Map<string, number>();
  for (const row of perf) if (row.promoId && row.percentile != null && row.tier) perfByPromo.set(row.promoId, row.percentile);
  for (const promo of promos) {
    if (promo.performanceScore != null) byPromo.set(promo.id, { score: promo.performanceScore, source: "you" });
    else if (perfByPromo.has(promo.id)) byPromo.set(promo.id, { score: percentileScore(perfByPromo.get(promo.id)!)!, source: "results" });
  }
  return byPromo;
}

/** Everything the brand-level views need in one go. */
export async function brandPromoData(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const promos = await db.promo.findMany({
    where: { brandId, deletedAt: null },
    select: { id: true, title: true, publisher: true, gurus: true, product: true, promoType: true, promoCode: true, effectivenessScore: true, myScore: true, isBestPerformer: true, analysisStatus: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const [results, real, perf] = await Promise.all([
    latestResults(organizationId, promos.map((p) => p.id)),
    realWorldScores(organizationId, brandId),
    db.promoPerformance.findMany({ where: { brandId, promoId: { not: null } }, select: { promoId: true, percentile: true, tier: true, cohort: true } }),
  ]);
  const perfByPromo = new Map(perf.map((row) => [row.promoId!, row]));
  return { promos, results, real, perfByPromo };
}

export async function trainingPairs(organizationId: string, brandId: string) {
  const { promos, results, real } = await brandPromoData(organizationId, brandId);
  const pairs: TrainingPair[] = [];
  for (const promo of promos) {
    const vector = scoreVector(results.get(promo.id)?.scores);
    const outcome = real.get(promo.id);
    if (vector && outcome) pairs.push({ id: promo.id, title: promo.title, promoType: promo.promoType, vector, outcome: outcome.score });
  }
  return pairs;
}

export async function calibrationPoints(organizationId: string, brandId: string): Promise<CalibrationPoint[]> {
  const { promos, real } = await brandPromoData(organizationId, brandId);
  return promos
    .filter((p) => p.effectivenessScore != null && (p.myScore != null || real.has(p.id)))
    .map((p) => ({ id: p.id, title: p.title, ai: p.effectivenessScore!, mine: p.myScore, real: real.get(p.id)?.score ?? null }));
}

// ---------------------------------------------------------------------------
// Performance import and tiers

/** Re-link every result row to a promo by code, then re-rank every cohort. */
export async function retier(organizationId: string, brandId: string): Promise<{ matched: number; total: number }> {
  const db = tenantDb(organizationId);
  const [rows, promos] = await Promise.all([
    db.promoPerformance.findMany({ where: { brandId }, select: { id: true, codeKey: true, promoId: true, sheetType: true, orders: true, revenue: true, cohort: true, cohortSize: true, metric: true, metricValue: true, percentile: true, tierScheme: true, tier: true } }),
    db.promo.findMany({ where: { brandId, deletedAt: null, promoCode: { not: null } }, select: { id: true, promoCode: true, promoType: true } }),
  ]);
  const promoByCode = new Map<string, { id: string; promoType: string | null }>();
  for (const promo of promos) for (const key of promoCodeKeys(promo.promoCode)) if (!promoByCode.has(key)) promoByCode.set(key, promo);
  const matched = rows.map((row) => {
    const promo = promoByCode.get(row.codeKey) ?? null;
    return { row, promo, cohort: cohortFor(promo?.promoType, row.sheetType, PROMO_TYPES) };
  });
  const tiers = computeTiers(matched.map(({ row, cohort }) => ({ codeKey: row.codeKey, cohort, orders: row.orders, revenue: row.revenue })));
  const tierByCode = new Map(tiers.map((t) => [t.codeKey, t]));
  for (const { row, promo } of matched) {
    const t = tierByCode.get(row.codeKey)!;
    const next = { promoId: promo?.id ?? null, cohort: t.cohort, cohortSize: t.cohortSize, metric: t.metric, metricValue: t.metricValue, percentile: t.percentile, tierScheme: t.scheme, tier: t.tier };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((key) => row[key] !== next[key]);
    if (changed) await db.promoPerformance.updateMany({ where: { id: row.id }, data: next });
  }
  return { matched: matched.filter((m) => m.promo).length, total: rows.length };
}

export async function runPerformanceImport(input: { organizationId: string; brandId: string; importId: string; mapping: ColumnMapping }) {
  const db = tenantDb(input.organizationId);
  try {
    const upload = await db.promoPerformanceImport.findFirst({ where: { id: input.importId, brandId: input.brandId } });
    if (!upload) return;
    const table = parseSheet(upload.filename, new Uint8Array(upload.data));
    const { rows } = mapRows(table, input.mapping);
    if (!rows.length) throw new Error("No rows had a promo code in the chosen column.");
    for (const row of rows) {
      const data = {
        importId: upload.id,
        promoCode: row.promoCode,
        label: row.label,
        sheetType: row.sheetType,
        startDate: row.startDate,
        endDate: row.endDate,
        sent: row.sent,
        views: row.views,
        clicks: row.clicks,
        orders: row.orders,
        revenue: row.revenue,
        cost: row.cost,
        extra: row.extra as Prisma.InputJsonValue,
      };
      const existing = await db.promoPerformance.findFirst({ where: { brandId: input.brandId, codeKey: row.codeKey }, select: { id: true } });
      if (existing) await db.promoPerformance.updateMany({ where: { id: existing.id }, data });
      else await db.promoPerformance.create({ data: { organizationId: input.organizationId, brandId: input.brandId, codeKey: row.codeKey, ...data } });
    }
    await retier(input.organizationId, input.brandId);
    const matchedCount = await db.promoPerformance.count({ where: { importId: upload.id, promoId: { not: null } } });
    await db.promoPerformanceImport.updateMany({
      where: { id: upload.id },
      data: { status: "DONE", error: null, mapping: input.mapping as unknown as Prisma.InputJsonValue, rowCount: Math.max(0, table.length - 1), codeCount: rows.length, matchedCount },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The import failed.";
    await db.promoPerformanceImport.updateMany({ where: { id: input.importId }, data: { status: "FAILED", error: reason } }).catch(() => undefined);
  }
}

/** Write the brand's aggregate results to its mini-brain. Data only, no AI. */
export async function teachPerformance(input: { organizationId: string; brand: Brand; actorId: string | null }) {
  const db = tenantDb(input.organizationId);
  const rows = await db.promoPerformance.findMany({ where: { brandId: input.brand.id } });
  const promoIds = rows.map((r) => r.promoId).filter((id): id is string => Boolean(id));
  const promos = promoIds.length ? await db.promo.findMany({ where: { id: { in: promoIds } }, select: { id: true, title: true, effectivenessScore: true } }) : [];
  const byId = new Map(promos.map((p) => [p.id, p]));
  const note = performanceBrainNote({
    brandName: input.brand.name,
    records: rows.map((row) => {
      const promo = row.promoId ? byId.get(row.promoId) : undefined;
      return { title: promo?.title ?? row.label ?? row.promoCode, cohort: row.cohort, tier: row.tier, aiScore: promo?.effectivenessScore ?? null, percentile: row.percentile };
    }),
  });
  await teachBrain({
    organizationId: input.organizationId,
    brandId: input.brand.id,
    sourceRef: `promo-performance:${input.brand.id}`,
    title: note.title,
    body: note.body,
    folder: "Promo reviews",
    source: "promo-analyzer",
    actorId: input.actorId,
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Lessons

export async function runLessonClustering(input: { organizationId: string; runId: string; brand: Brand; actorId: string | null }) {
  const db = tenantDb(input.organizationId);
  const fail = (reason: string) => db.promoLessonRun.updateMany({ where: { id: input.runId }, data: { status: "FAILED", error: reason } }).catch(() => undefined);
  try {
    await db.promoLessonRun.updateMany({ where: { id: input.runId }, data: { status: "RUNNING" } });
    const { promos, results, perfByPromo } = await brandPromoData(input.organizationId, input.brand.id);
    const items = buildLessonItems(
      promos
        .filter((p) => results.has(p.id))
        .map((p) => {
          const r = results.get(p.id)!;
          const perf = perfByPromo.get(p.id);
          return {
            id: p.id,
            title: p.title,
            promoType: p.promoType,
            lessons: r.lessons ?? [],
            strengths: r.strengths ?? [],
            fixes: r.fixes ?? [],
            percentile: perf?.tier ? perf.percentile : null,
            tierLabel: perf?.tier ? (TIER_LABELS[perf.tier as TierKey] ?? null) : null,
          };
        }),
    );
    await db.promoLessonRun.updateMany({ where: { id: input.runId }, data: { inputCount: items.length } });
    if (!items.length) return void (await fail("No lessons yet. Analyze some promos first."));

    const kept = await db.promoLesson.findMany({
      where: { brandId: input.brand.id, OR: [{ origin: "manual" }, { edited: true }, { pinned: true }, { hidden: true }, { sharedAt: { not: null } }] },
    });
    const answer = await runStructured<LessonAnswer>({
      system: LESSON_SYSTEM,
      input: [{ type: "text", text: lessonPrompt({ brandContext: brandPromptContext(brandProfile(input.brand)), items, existing: kept.map((k) => ({ title: k.title, body: k.body })) }) }],
      schema: LESSON_SCHEMA,
      effort: "medium",
      maxTokens: 16000,
    });
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: input.organizationId, moduleId: "promo-studio", feature: "promo.lessons", actorId: input.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") return void (await fail(answer.reason));

    const themes = applyClusters(answer.data, items);
    // Replace the untouched AI themes; keep anything a person curated.
    await db.promoLesson.deleteMany({ where: { brandId: input.brand.id, origin: "ai", edited: false, pinned: false, hidden: false, sharedAt: null } });
    for (const theme of themes) {
      const match = kept.find((k) => sameTheme(k.title, theme.title));
      if (match) {
        await db.promoLesson.updateMany({
          where: { id: match.id },
          data: {
            promoIds: [...new Set([...match.promoIds, ...theme.promoIds])],
            evidenceCount: new Set([...match.promoIds, ...theme.promoIds]).size,
            fromResults: match.fromResults || theme.fromResults,
            ...(match.edited || match.origin === "manual" ? {} : { body: theme.body, category: theme.category }),
          },
        });
      } else {
        await db.promoLesson.create({
          data: {
            organizationId: input.organizationId,
            brandId: input.brand.id,
            title: theme.title,
            body: theme.body,
            category: theme.category,
            origin: "ai",
            evidenceCount: theme.evidenceCount,
            promoIds: theme.promoIds,
            fromResults: theme.fromResults,
            suggestedShared: theme.suggestedShared,
          },
        });
      }
    }
    await db.promoLessonRun.updateMany({ where: { id: input.runId }, data: { status: "DONE", error: null, themeCount: themes.length } });
    await teachLessons({ organizationId: input.organizationId, brand: input.brand, actorId: input.actorId });
  } catch (error) {
    await fail(error instanceof Error ? error.message : "Lesson clustering failed.");
  }
}

/** Refresh the brand Brain note that lists the visible lessons. */
export async function teachLessons(input: { organizationId: string; brand: Brand; actorId: string | null }) {
  const lessons = await tenantDb(input.organizationId).promoLesson.findMany({
    where: { brandId: input.brand.id, hidden: false },
    orderBy: [{ pinned: "desc" }, { evidenceCount: "desc" }],
    take: 60,
  });
  if (!lessons.length) return;
  const note = lessonsBrainNote(input.brand.name, lessons);
  await teachBrain({
    organizationId: input.organizationId,
    brandId: input.brand.id,
    sourceRef: `promo-lessons:${input.brand.id}`,
    title: note.title,
    body: note.body,
    folder: "Promo reviews",
    source: "promo-analyzer",
    actorId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// Bulk re-analysis: one process-wide queue, at most two analyses at a time.

type BulkJob = { organizationId: string; promoId: string; brand: Brand; actorId: string | null };
const jobs = new Map<string, BulkJob>();
const bulkQueue = createQueue(
  BULK_CONCURRENCY,
  async (key) => {
    const job = jobs.get(key);
    jobs.delete(key);
    if (job) await runPromoAnalysis(job);
  },
  async (waiting) => {
    // Waiting rows stay QUEUED; touching them keeps them from looking stuck.
    const byOrg = new Map<string, string[]>();
    for (const key of waiting) {
      const job = jobs.get(key);
      if (job) byOrg.set(job.organizationId, [...(byOrg.get(job.organizationId) ?? []), job.promoId]);
    }
    for (const [organizationId, ids] of byOrg) {
      await tenantDb(organizationId).promo.updateMany({ where: { id: { in: ids }, analysisStatus: "QUEUED" }, data: { analysisStatus: "QUEUED" } });
    }
  },
);

export async function enqueueBulk(list: BulkJob[]): Promise<void> {
  for (const job of list) jobs.set(`${job.organizationId}:${job.promoId}`, job);
  bulkQueue.add(list.map((job) => `${job.organizationId}:${job.promoId}`));
  await bulkQueue.idle();
}

export function bulkQueueSize() {
  return bulkQueue.size();
}

// ---------------------------------------------------------------------------
// Gallery

/** Starred promos first, then promos in the top band of their type. */
export async function bestPerformers(organizationId: string, brandId: string, limit = 12) {
  const [{ promos, results, perfByPromo }, overrides] = await Promise.all([brandPromoData(organizationId, brandId), loadOverrides(organizationId, brandId)]);
  const top = new Set(["top10", "top25"]);
  return promos
    .filter((p) => p.isBestPerformer || top.has(perfByPromo.get(p.id)?.tier ?? ""))
    .sort((a, b) => Number(b.isBestPerformer) - Number(a.isBestPerformer) || (perfByPromo.get(b.id)?.percentile ?? 0) - (perfByPromo.get(a.id)?.percentile ?? 0) || (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      title: p.title,
      score: p.effectivenessScore,
      headline: results.get(p.id)?.headline.headline ?? "",
      tier: perfByPromo.get(p.id)?.tier ?? null,
      starred: p.isBestPerformer,
      publisher: p.publisher ? resolveName("publisher", p.publisher, overrides) : null,
    }));
}

/** Results row and display overrides for one promo page. */
export async function promoInsights(organizationId: string, brandId: string, promoId: string) {
  const [performance, overrides] = await Promise.all([
    tenantDb(organizationId).promoPerformance.findMany({ where: { brandId, promoId }, orderBy: { updatedAt: "desc" } }),
    loadOverrides(organizationId, brandId),
  ]);
  return { performance, overrides };
}
