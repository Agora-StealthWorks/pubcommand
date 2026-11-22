import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { componentSpec } from "../../../../../modules/promo-studio/packager";
import { promoCodeKeys } from "../../../../../modules/promo-studio/performance";
import { componentContent, kindForOldCategory, kindForOldSlug, lessonFromOld, matchPackagePromo, performanceFromOld, rawFromOldSections } from "../../../../../modules/promo-studio/oxfordhub";
import { buildStored, effectiveScorecard } from "../../../../../modules/promo-studio/stored";
import { ensureConsoleOrganization } from "@/lib/console-workspace";
import { learnedKey } from "../../../../../modules/knowledge/main-brain";
import { mainBrain } from "../main-brain/db";
import { retier } from "../promos/insights";

/**
 * Bring the old OxfordHub Promo Analyzer and Packager into the admin console's
 * Promo Analyzer (the console workspace), from an export folder:
 *
 *   reviews.json                       the analyzer's saved reviews (sections, scores, training, metadata)
 *   performance.json                   its performance sheet records and promo list
 *   learning.json                      its lessons
 *   packager/package-<id>.json         the Packager's packages
 *   sourcecopy/<reviewId>.txt          each promo's full text (from the brain vault's Source Copy notes)
 *   files/<reviewId>/source__<name>    the original upload (kept when small)
 *   files/<reviewId>/supplemental.json + sup__<fileId>__<name>[.txt]
 *                                      supporting files (the Packager's training files) and their text
 *
 * Reviews keep their original analysis (no AI re-run). Supporting files become
 * promo files and Packager training examples; packages attach to their promo.
 * Idempotent: promos by `oxfordhub:<reviewId>`, examples by sourceRef, packages
 * by direction.oxfordhubId, performance by code, lessons by title.
 */
export async function importOxfordHub(input: { dir: string; apply: boolean; onLine?: (line: string) => void }): Promise<{ applied: boolean; lines: string[] }> {
  const lines: string[] = [];
  const log = (...parts: unknown[]) => {
    const line = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ");
    lines.push(line);
    input.onLine?.(line);
  };
  const dir = input.dir;
  const readJson = <T>(path: string, fallback: T): T => (existsSync(join(dir, path)) ? (JSON.parse(readFileSync(join(dir, path), "utf8")) as T) : fallback);

  type OldReview = {
    id: string;
    filename: string;
    date?: string;
    sections?: Record<string, unknown>;
    subScores?: { dimension?: string; score?: number; rationale?: string }[];
    effectivenessScore?: number | null;
    scoringModel?: string | null;
    fkReadingEase?: number | null;
    fkGradeLevel?: number | null;
    publisher?: string | null;
    gurus?: string[];
    product?: string | null;
    promoType?: string | null;
    promoStatus?: string | null;
    promoCode?: string | null;
    promoRunStartDate?: string | null;
    pricePoint?: number | null;
    inputType?: string | null;
    training?: { performanceScore?: number | null; myScore?: number | null; reasoning?: string | null; notes?: string | null; isBestPerformer?: boolean } | null;
  };
  const reviews = readJson<OldReview[]>("reviews.json", []);
  const performance = readJson<{ views?: { record?: Parameters<typeof performanceFromOld>[0] }[]; promos?: { reviewId: string; name?: string }[] }>("performance.json", {});
  const lessons = readJson<Parameters<typeof lessonFromOld>[0][]>("learning.json", []);
  const packageFiles = existsSync(join(dir, "packager")) ? readdirSync(join(dir, "packager")).filter((name) => /^package-.+\.json$/.test(name)) : [];
  const names = new Map((performance.promos ?? []).map((p) => [p.reviewId, p.name ?? null]));
  log(`Export: ${reviews.length} reviews, ${performance.views?.length ?? 0} performance records, ${lessons.length} lessons, ${packageFiles.length} packages.`);

  const organizationId = await ensureConsoleOrganization();
  const db = tenantDb(organizationId);
  const brand = await db.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, niche: true } });
  if (!brand) throw new Error("The console workspace has no brand.");

  const existing = new Map((await db.promo.findMany({ where: { source: { startsWith: "oxfordhub:" } }, select: { id: true, source: true } })).map((p) => [p.source!.slice("oxfordhub:".length), p.id]));
  const fresh = reviews.filter((r) => !existing.has(r.id));
  log(`Promos: ${fresh.length} new, ${reviews.length - fresh.length} already imported.`);
  if (!input.apply) {
    log("Dry run. Nothing was written.");
    return { applied: false, lines };
  }

  const mime = (name: string) =>
    /\.docx$/i.test(name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : /\.pdf$/i.test(name) ? "application/pdf" : /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.txt|\.md$/i.test(name) ? "text/plain" : "application/octet-stream";
  const titleOf = (r: OldReview) => (names.get(r.id) ?? r.filename.replace(/\.[a-z0-9]+$/i, "")).slice(0, 200);
  const day = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null);

  // ---------- promos with their analysis, files and training examples ----------
  let created = 0;
  let files = 0;
  let examples = 0;
  for (const r of fresh) {
    const folder = join(dir, "files", r.id);
    const sourceText = existsSync(join(dir, "sourcecopy", `${r.id}.txt`)) ? readFileSync(join(dir, "sourcecopy", `${r.id}.txt`), "utf8").trim() : "";
    const stored = buildStored({ raw: rawFromOldSections(r.sections, r.subScores), finished: true, visual: r.inputType === "pdf" || r.inputType === "scanned-pdf", matches: [] });
    const card = effectiveScorecard(stored);
    const title = titleOf(r);
    const createdAt = r.date ? new Date(r.date) : new Date();
    const promo = await db.promo.create({
      data: {
        organizationId,
        brandId: brand.id,
        title,
        filename: r.filename,
        inputType: r.inputType ?? "text",
        sourceText,
        publisher: r.publisher ?? null,
        gurus: r.gurus ?? [],
        product: r.product ?? null,
        promoType: r.promoType ?? null,
        promoStatus: r.promoStatus ?? null,
        promoCode: r.promoCode ?? null,
        runStartDate: day(r.promoRunStartDate),
        pricePoint: typeof r.pricePoint === "number" ? r.pricePoint : null,
        analysisStatus: "DONE",
        effectivenessScore: r.effectivenessScore ?? card.final,
        fkReadingEase: r.fkReadingEase ?? null,
        fkGradeLevel: r.fkGradeLevel ?? null,
        myScore: r.training?.myScore ?? null,
        performanceScore: r.training?.performanceScore ?? null,
        trainingNotes: [r.training?.notes, r.training?.reasoning].filter(Boolean).join("\n\n") || null,
        isBestPerformer: Boolean(r.training?.isBestPerformer),
        source: `oxfordhub:${r.id}`,
        createdAt,
      },
      select: { id: true },
    });
    await db.promoAnalysis.create({
      data: { organizationId, promoId: promo.id, version: 1, model: r.scoringModel ?? "claude (OxfordHub analyzer)", result: stored as unknown as Prisma.InputJsonValue, score: r.effectivenessScore ?? card.final, createdAt },
    });
    existing.set(r.id, promo.id);
    created += 1;
    if (!existsSync(folder)) continue;
    const entries = readdirSync(folder);
    const source = entries.find((name) => name.startsWith("source__"));
    if (source) {
      const data = readFileSync(join(folder, source));
      const filename = source.slice("source__".length);
      await db.promoFile.create({ data: { organizationId, promoId: promo.id, kind: "source", filename, mimeType: mime(filename), size: data.length, data, createdAt } });
      files += 1;
    }
    const supplemental = existsSync(join(folder, "supplemental.json")) ? (JSON.parse(readFileSync(join(folder, "supplemental.json"), "utf8")) as { id: string; filename: string; category?: string }[]) : [];
    for (const file of supplemental) {
      const stem = entries.find((name) => name.startsWith(`sup__${file.id}__`) && !name.endsWith(".txt"));
      if (stem) {
        const data = readFileSync(join(folder, stem));
        await db.promoFile.create({ data: { organizationId, promoId: promo.id, kind: "supplemental", category: file.category ?? null, filename: file.filename, mimeType: mime(file.filename), size: data.length, data, createdAt } });
        files += 1;
      }
      const kind = kindForOldCategory(file.category);
      const textFile = entries.find((name) => name.startsWith(`sup__${file.id}__`) && name.endsWith(".txt"));
      const text = textFile ? readFileSync(join(folder, textFile), "utf8").trim() : "";
      if (!kind || text.length < 100) continue;
      const sourceRef = `oxfordhub-file:${file.id}`;
      if (await db.promoTrainingExample.findFirst({ where: { brandId: brand.id, sourceRef }, select: { id: true } })) continue;
      await db.promoTrainingExample.create({
        data: {
          organizationId,
          brandId: brand.id,
          kind,
          publication: r.publisher ?? null,
          niche: brand.niche ?? "general",
          title: `${componentSpec(kind)?.label ?? kind}: ${title}`.slice(0, 200),
          content: text.slice(0, 60_000),
          source: "oxfordhub",
          sourceRef,
          promoId: promo.id,
          tags: ["oxfordhub", ...(r.training?.isBestPerformer ? ["best-performer"] : [])],
          // Best-performer sync must never retire these.
          edited: true,
        },
      });
      examples += 1;
    }
  }
  log(`Promo Analyzer: ${created} promos with their analyses, ${files} files, ${examples} Packager training examples.`);

  // ---------- performance records ----------
  {
    const promoByCode = new Map<string, string>();
    for (const p of await db.promo.findMany({ where: { deletedAt: null, promoCode: { not: null } }, select: { id: true, promoCode: true } })) for (const key of promoCodeKeys(p.promoCode)) promoByCode.set(key, p.id);
    const have = new Set((await db.promoPerformance.findMany({ where: { brandId: brand.id }, select: { codeKey: true } })).map((row) => row.codeKey));
    let added = 0;
    for (const view of performance.views ?? []) {
      const row = view.record ? performanceFromOld(view.record) : null;
      if (!row || have.has(row.codeKey)) continue;
      await db.promoPerformance.create({
        data: { organizationId, brandId: brand.id, codeKey: row.codeKey, promoCode: row.promoCode, label: row.label, promoId: promoByCode.get(row.codeKey) ?? null, views: row.views, clicks: row.clicks, orders: row.orders, revenue: row.revenue, extra: row.extra as Prisma.InputJsonValue },
      });
      have.add(row.codeKey);
      added += 1;
    }
    const tiers = await retier(organizationId, brand.id).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
    log(`Performance: ${added} records added; tiers:`, tiers);
  }

  // ---------- lessons ----------
  {
    const promoByName = new Map<string, string>();
    for (const r of reviews) {
      const id = existing.get(r.id);
      if (!id) continue;
      promoByName.set(r.filename.replace(/\.[a-z0-9]+$/i, "").toLowerCase(), id);
      promoByName.set(titleOf(r).toLowerCase(), id);
    }
    const titles = new Set((await db.promoLesson.findMany({ where: { brandId: brand.id }, select: { title: true } })).map((l) => l.title));
    let added = 0;
    for (const old of lessons) {
      const lesson = lessonFromOld(old);
      if (!lesson || titles.has(lesson.title)) continue;
      const promoIds = ((old as { supportingPromos?: string[] }).supportingPromos ?? []).flatMap((name) => {
        const id = promoByName.get(name.replace(/\.[a-z0-9]+$/i, "").toLowerCase());
        return id ? [id] : [];
      });
      await db.promoLesson.create({ data: { organizationId, brandId: brand.id, title: lesson.title, body: lesson.body, category: lesson.category, origin: "ai", evidenceCount: Math.max(lesson.evidenceCount, promoIds.length), promoIds, fromResults: lesson.fromResults } });
      titles.add(lesson.title);
      added += 1;
    }
    log(`Lessons: ${added} added.`);
  }

  // ---------- packages ----------
  {
    // Packages join the analyzed promo they were attached to in OxfordHub, and nothing else:
    // a package whose promo was never analyzed is not brought over (it is not a promo of its own).
    const candidates = (await db.promo.findMany({ where: { deletedAt: null, source: { startsWith: "oxfordhub:" } }, select: { id: true, title: true, filename: true, source: true } })).map((p) => ({
      id: p.id,
      reviewId: p.source!.slice("oxfordhub:".length),
      names: [p.title, p.filename ?? ""].filter(Boolean),
    }));
    let added = 0;
    const skipped: string[] = [];
    for (const name of packageFiles) {
      const pkg = (JSON.parse(readFileSync(join(dir, "packager", name), "utf8")) as { package: { id: string; createdAt?: string; brief: Record<string, unknown> & { title?: string; reviewId?: string | null }; components: { slug: string; items?: { text?: string }[] }[] } }).package;
      if (await db.promoPackage.findFirst({ where: { direction: { path: ["oxfordhubId"], equals: pkg.id } }, select: { id: true } })) continue;
      const brief = pkg.brief ?? {};
      const title = String(brief.title ?? "Package").slice(0, 200);
      const promoId = matchPackagePromo({ title, reviewId: (brief.reviewId as string | null | undefined) ?? null }, candidates);
      if (!promoId) {
        skipped.push(title);
        continue;
      }
      await createPackage(db, { organizationId, brandId: brand.id, promoId, pkg, title });
      added += 1;
    }
    log(`Packages: ${added} attached to their analyzed promo; ${skipped.length} not attached to an analyzed promo in OxfordHub, left out${skipped.length ? `: ${skipped.join(", ")}` : ""}.`);
  }

  log("Done.");
  return { applied: true, lines };
}

type OldPackage = { id: string; createdAt?: string; brief: Record<string, unknown>; components: { slug: string; items?: { text?: string }[] }[] };

async function createPackage(db: ReturnType<typeof tenantDb>, input: { organizationId: string; brandId: string; promoId: string; pkg: OldPackage; title: string }) {
  const { organizationId, pkg } = input;
  const createdAt = pkg.createdAt ? new Date(pkg.createdAt) : new Date();
  const brief = Object.fromEntries(Object.entries(pkg.brief ?? {}).filter(([key]) => key !== "promoFullText" && key !== "promoExcerpt"));
  const created = await db.promoPackage.create({
    data: { organizationId, brandId: input.brandId, promoId: input.promoId, title: input.title, direction: { oxfordhubId: pkg.id, brief } as Prisma.InputJsonValue, createdAt },
    select: { id: true },
  });
  let position = 0;
  for (const component of pkg.components ?? []) {
    const kind = kindForOldSlug(component.slug);
    const items = component.items ?? [];
    if (!kind || !items.length) continue;
    const content = componentContent(kind, items);
    const row = await db.promoPackageComponent.create({
      data: { organizationId, packageId: created.id, kind, position: position++, quantity: items.length, content, genStatus: "DONE", currentVersion: 1, createdAt },
      select: { id: true },
    });
    await db.promoPackageComponentVersion.create({ data: { organizationId, componentId: row.id, version: 1, source: "imported", content, createdAt } });
  }
}

/**
 * Undo the placeholder promos an earlier import made for packages: move each
 * package that was attached in OxfordHub to its analyzed promo, and delete the
 * placeholder promos with everything they produced (packages left on them, queued
 * analysis, their notes in the console Brain and the Master Brain). Idempotent.
 */
export async function fixOxfordhubPackages(input: { apply: boolean }): Promise<{ applied: boolean; lines: string[] }> {
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const organizationId = await ensureConsoleOrganization();
  const db = tenantDb(organizationId);
  const placeholders = await db.promo.findMany({ where: { source: { startsWith: "oxfordhub-package:" } }, select: { id: true, title: true } });
  const candidates = (await db.promo.findMany({ where: { deletedAt: null, source: { startsWith: "oxfordhub:" } }, select: { id: true, title: true, filename: true, source: true } })).map((p) => ({
    id: p.id,
    reviewId: p.source!.slice("oxfordhub:".length),
    names: [p.title, p.filename ?? ""].filter(Boolean),
  }));
  const ids = placeholders.map((p) => p.id);
  const packages = ids.length ? await db.promoPackage.findMany({ where: { promoId: { in: ids } }, select: { id: true, title: true, direction: true } }) : [];
  const moves: { packageId: string; title: string; promoId: string }[] = [];
  for (const pkg of packages) {
    const brief = ((pkg.direction ?? {}) as { brief?: { title?: string; reviewId?: string | null } }).brief ?? {};
    const promoId = matchPackagePromo({ title: brief.title ?? pkg.title, reviewId: brief.reviewId ?? null }, candidates);
    if (promoId) moves.push({ packageId: pkg.id, title: pkg.title, promoId });
  }
  const target = new Map(candidates.map((c) => [c.id, c.names[0]]));
  log(`Placeholder promos: ${placeholders.length} (${placeholders.map((p) => p.title).join(", ") || "none"}).`);
  log(`Packages moved to their analyzed promo: ${moves.map((m) => `${m.title} → ${target.get(m.promoId)}`).join("; ") || "none"}.`);
  log(`Packages removed with their placeholder: ${packages.length - moves.length}.`);
  if (!input.apply) {
    log("Dry run. Nothing was written.");
    return { applied: false, lines };
  }
  for (const move of moves) await db.promoPackage.updateMany({ where: { id: move.packageId }, data: { promoId: move.promoId } });
  if (ids.length) {
    const refs = ids.flatMap((id) => [`promo:${id}`, `promo-intel:${id}`, `promo-copy:${id}`]);
    const brandNotes = await db.knowledgePage.updateMany({ where: { sourceRef: { in: refs }, deletedAt: null }, data: { deletedAt: new Date() } });
    // Master Brain copies of those notes: deleted (learn-up never brings a deleted note back).
    const mainNotes = await mainBrain((tx) => tx.mainBrainNote.updateMany({ where: { key: { in: refs.map((ref) => learnedKey(organizationId, ref)) }, deletedAt: null }, data: { deletedAt: new Date() } }));
    const promos = await db.promo.deleteMany({ where: { id: { in: ids } } });
    log(`Removed ${promos.count} placeholder promos (their queued analysis and remaining packages with them), ${brandNotes.count} console Brain notes and ${mainNotes.count} Master Brain notes.`);
  }
  log("Done.");
  return { applied: true, lines };
}
