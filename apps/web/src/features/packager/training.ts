import { brandProfile } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import type { AnalysisDigest } from "../../../../../modules/promo-studio/stored";
import { exampleFromBestPerformer, exampleFromComponent, type TrainingExample } from "../../../../../modules/promo-studio/training";
import { bestPerformers, latestResults } from "../promos/insights";

type Brand = { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };
type ExampleInput = { kind: string; publication: string | null; niche: string; title: string; content: string; source: string; sourceRef: string; promoId: string | null; note?: string | null };

/** Create or refresh one automatic example. A person's edits are never overwritten. */
async function upsertExample(organizationId: string, brandId: string, input: ExampleInput, actorId: string | null): Promise<"created" | "updated" | "kept"> {
  const db = tenantDb(organizationId);
  const existing = await db.promoTrainingExample.findFirst({ where: { brandId, sourceRef: input.sourceRef } });
  if (!existing) {
    await db.promoTrainingExample.create({ data: { organizationId, brandId, ...input, note: input.note ?? null, createdById: actorId } });
    return "created";
  }
  if (existing.edited) return "kept";
  await db.promoTrainingExample.updateMany({ where: { id: existing.id }, data: { title: input.title, content: input.content, kind: input.kind, publication: input.publication, niche: input.niche, note: input.note ?? existing.note } });
  return "updated";
}

/** An approved component joins the library (or refreshes its example). */
export async function learnFromComponent(input: {
  organizationId: string;
  brand: Brand;
  actorId: string | null;
  component: { id: string; kind: string; content: string };
  promo: { id: string; title: string; publisher: string | null };
}): Promise<void> {
  if (!input.component.content.trim()) return;
  const example = exampleFromComponent({
    componentId: input.component.id,
    kind: input.component.kind,
    content: input.component.content,
    promoTitle: input.promo.title,
    promoId: input.promo.id,
    publication: input.promo.publisher,
    niche: brandProfile(input.brand).niche,
  });
  await upsertExample(input.organizationId, input.brand.id, example, input.actorId);
}

/**
 * Best performers (starred, or in the top band of their type) become headline
 * examples. Ones that no longer qualify are switched off unless a person edited them.
 */
export async function syncBestPerformers(input: { organizationId: string; brand: Brand; actorId: string | null }): Promise<{ added: number; updated: number; retired: number }> {
  const db = tenantDb(input.organizationId);
  const niche = brandProfile(input.brand).niche;
  const best = await bestPerformers(input.organizationId, input.brand.id, 60);
  const results = await latestResults(input.organizationId, best.map((b) => b.id));
  const promos = best.length ? await db.promo.findMany({ where: { id: { in: best.map((b) => b.id) } }, select: { id: true, publisher: true } }) : [];
  const publisher = new Map(promos.map((p) => [p.id, p.publisher]));
  let added = 0;
  let updated = 0;
  const refs: string[] = [];
  for (const promo of best) {
    const result: AnalysisDigest | undefined = results.get(promo.id);
    const example = exampleFromBestPerformer({
      promoId: promo.id,
      title: promo.title,
      publication: publisher.get(promo.id) ?? null,
      niche,
      headline: result ? { eyebrow: result.headline.eyebrow, headline: result.headline.headline, subhead: result.headline.subhead } : null,
      performance: promo.starred ? "Marked best performer" : promo.tier ? `Results tier: ${promo.tier}` : null,
    });
    if (!example) continue;
    refs.push(example.sourceRef);
    const outcome = await upsertExample(input.organizationId, input.brand.id, example, input.actorId);
    if (outcome === "created") added += 1;
    else if (outcome === "updated") updated += 1;
  }
  const retired = await db.promoTrainingExample.updateMany({
    where: { brandId: input.brand.id, source: "best-performer", edited: false, enabled: true, ...(refs.length ? { sourceRef: { notIn: refs } } : {}) },
    data: { enabled: false },
  });
  return { added, updated, retired: retired.count };
}

/** Everything generation may draw from for this brand. */
export async function libraryFor(organizationId: string, brandId: string): Promise<TrainingExample[]> {
  const rows = await tenantDb(organizationId).promoTrainingExample.findMany({
    where: { brandId, enabled: true },
    select: { id: true, kind: true, publication: true, niche: true, title: true, content: true, source: true, sourceRef: true, enabled: true, tags: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });
  return rows;
}
