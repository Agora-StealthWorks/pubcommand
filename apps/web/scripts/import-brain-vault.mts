/**
 * Import the team's brain vault (an Obsidian repo) into PubCommand, the same way
 * the apps would have learned it:
 *
 *   - general know-how → Master Brain notes (industry lens), Word/PowerPoint guides included
 *   - the publisher's own notes → that organization's Brain (Brain app import rules)
 *   - Resources/Promos/{FE's,BE's} → promos in that organization's Promo Analyzer, files
 *     attached, results tier recorded, queued for analysis
 *   - order forms → Packager training examples in that organization
 *   - then the console sync: promo notes into the Master Brain, industry lens, and copies
 *     into the admin console's Promo Analyzer, Packager and VidRipper
 *
 * Dry run by default (prints the plan). Idempotent with --apply: notes are keyed by
 * vault path, promos by `vault:<path>`, examples by sourceRef.
 *
 *   cd apps/web && DATABASE_URL=… node <tsx cli> scripts/import-brain-vault.mts <vault dir> [--org <slug>] [--apply]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { slugifyName } from "@pubcommand/core";
import { rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { classifyNote, compileRules, publicationsFromTable, type ClassifierRules } from "../../../modules/knowledge/classify";
import { frameNote } from "../../../modules/knowledge/industry-lens";
import { decodeText, exportDecision, MTA_EXPORT_RULES, planVaultImport, type ExistingNote, type VaultDecision } from "../../../modules/knowledge/vault";
import { cleanPromoTitle, codeFromFileName, isOrderForm, parseVaultPromoPath, pptxText, promoFieldsFromVault } from "../../../modules/promo-studio/vault-promos";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const vault = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--org"));
if (!vault) throw new Error("Usage: import-brain-vault.mts <vault dir> [--org <slug>] [--apply]");
const log = (...parts: unknown[]) => console.log(...parts);

// ---------- read the vault ----------
function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === ".git" || name === "node_modules") continue;
      walk(full, files);
    } else if (stat.isFile()) files.push(full);
  }
  return files;
}
const all = walk(vault).map((full) => ({ full, path: relative(vault, full).split(sep).join("/") }));
const mdPaths = new Set(all.filter((f) => /\.md$/i.test(f.path)).map((f) => f.path.toLowerCase()));

async function docText(path: string, bytes: Buffer): Promise<string> {
  if (/\.docx$/i.test(path)) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: bytes })).value.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (/\.pptx$/i.test(path)) return pptxText(new Uint8Array(bytes));
  return "";
}

const isPromoFile = (path: string) => parseVaultPromoPath(path) !== null;
const isOrderFormFile = (path: string) => /\.(docx)$/i.test(path) && (path.startsWith("Resources/Order Forms/") || (isPromoFile(path) && isOrderForm(path)));

// Notes: Markdown, plus Word/PowerPoint documents that are not promos or order forms (lift guides, editorial guides, descriptions…).
const decisions: VaultDecision[] = [];
let converted = 0;
for (const file of all) {
  if (/\.md$/i.test(file.path)) {
    decisions.push(exportDecision(file.path, decodeText(readFileSync(file.full)), MTA_EXPORT_RULES));
    continue;
  }
  if (!/\.(docx|pptx)$/i.test(file.path) || isPromoFile(file.path) || isOrderFormFile(file.path)) continue;
  const notePath = file.path.replace(/\.(docx|pptx)$/i, ".md");
  if (mdPaths.has(notePath.toLowerCase())) continue;
  const text = await docText(file.path, readFileSync(file.full));
  if (text.length < 200) continue;
  const decision = exportDecision(notePath, `${text}\n\n_Converted from ${file.path.split("/").pop()} in the brain vault._`, MTA_EXPORT_RULES);
  decisions.push(decision);
  if (decision.ok) converted += 1;
}
const ok = decisions.filter((d): d is Extract<VaultDecision, { ok: true }> => d.ok);
log(`Vault: ${all.length} files, ${ok.length} notes (${converted} converted from Word/PowerPoint), ${decisions.length - ok.length} skipped by the export rules.`);

// Split brand vs general, with the approved rules (scripts/brain-split.mta.json + the vault's publications ledger).
const config = JSON.parse(readFileSync(new URL("../../../scripts/brain-split.mta.json", import.meta.url), "utf8")) as Omit<ClassifierRules, "people" | "publications" | "publicationCodes">;
const codes = new Set<string>();
const publications = new Set<string>();
try {
  for (const row of publicationsFromTable(readFileSync(join(vault, "Areas/MTA/MTARIX Publications Ledger.md"), "utf8"))) {
    codes.add(row.code);
    publications.add(row.name);
  }
} catch {
  // no ledger
}
for (const code of [...codes]) if (code.length < 3) codes.delete(code);
const compiled = compileRules({ ...config, people: [], publications: [...publications].sort(), publicationCodes: [...codes].sort() });
const brandDecisions: VaultDecision[] = [];
const generalDecisions: VaultDecision[] = [];
for (const d of ok) (classifyNote(d.note.path, d.note.body, compiled).destination === "brand" ? brandDecisions : generalDecisions).push(d);
log(`Split: ${brandDecisions.length} for the publisher's own Brain, ${generalDecisions.length} for the Master Brain.`);

// ---------- find the publisher organization ----------
const prisma = rawPrisma();
const orgSlug = flag("org");
const candidates = orgSlug
  ? await prisma.organization.findMany({ where: { slug: orgSlug, deletedAt: null }, select: { id: true, name: true, slug: true } })
  : await prisma.organization.findMany({
      where: { deletedAt: null, OR: [{ name: { contains: "Monument", mode: "insensitive" } }, { slug: { in: ["mta", "monument", "monument-traders", "monument-traders-alliance"] } }, { brands: { some: { name: { contains: "Monument", mode: "insensitive" } } } }] },
      select: { id: true, name: true, slug: true },
    });
log("Organizations:", (await prisma.organization.findMany({ where: { deletedAt: null }, select: { slug: true, name: true } })).map((o) => `${o.slug} (${o.name})`).join(", "));
if (candidates.length !== 1) throw new Error(`Pick the publisher organization with --org <slug>; matched: ${candidates.map((c) => c.slug).join(", ") || "none"}`);
const org = candidates[0]!;
const db = tenantDb(org.id);
const brands = await db.brand.findMany({ select: { id: true, name: true, niche: true } });
const brand = brands.find((b) => /monument|mta/i.test(b.name)) ?? (brands.length === 1 ? brands[0] : undefined);
if (!brand) throw new Error(`Could not tell which brand of ${org.slug} is MTA: ${brands.map((b) => b.name).join(", ")}`);
log(`Publisher: ${org.name} (${org.slug}), brand ${brand.name}.`);

// ---------- Master Brain notes ----------
async function mainTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}
const framedGeneral = generalDecisions.map((d) => (d.ok ? { ...d, note: frameNote(d.note) } : d));
const mainKeys = framedGeneral.flatMap((d) => (d.ok ? [d.note.sourceRef] : []));
const mainExisting = new Map<string, ExistingNote>();
for (const row of await mainTx((tx) => tx.mainBrainNote.findMany({ where: { key: { in: mainKeys } }, select: { id: true, key: true, title: true, body: true, folder: true, deletedAt: true } })))
  mainExisting.set(row.key, { ...row, brandId: null });
const mainPlan = planVaultImport(framedGeneral, mainExisting, null);
log("Master Brain plan:", { create: mainPlan.report.create, update: mainPlan.report.update, unchanged: mainPlan.report.unchanged, deleted: mainPlan.report.deleted, conflict: mainPlan.report.conflict });

// ---------- the publisher's Brain ----------
const brandRefs = brandDecisions.flatMap((d) => (d.ok ? [d.note.sourceRef] : []));
const brandExisting = new Map<string, ExistingNote>();
for (const row of await db.knowledgePage.findMany({ where: { sourceRef: { in: brandRefs } }, select: { id: true, sourceRef: true, brandId: true, title: true, body: true, folder: true, deletedAt: true } }))
  if (row.sourceRef) brandExisting.set(row.sourceRef, row);
const brandPlan = planVaultImport(brandDecisions, brandExisting, brand.id);
log(`${brand.name} Brain plan:`, { create: brandPlan.report.create, update: brandPlan.report.update, unchanged: brandPlan.report.unchanged, deleted: brandPlan.report.deleted, conflict: brandPlan.report.conflict });

// ---------- promos ----------
type PromoGroup = { key: string; files: { path: string; full: string }[] };
const groups = new Map<string, PromoGroup>();
for (const file of all) {
  const parsed = parseVaultPromoPath(file.path);
  if (!parsed || isOrderForm(file.path) || /\.md$/i.test(file.path)) continue;
  const key = parsed.group ?? file.path;
  const group = groups.get(key) ?? { key, files: [] };
  group.files.push(file);
  groups.set(key, group);
}
const existingPromos = new Set((await db.promo.findMany({ where: { source: { startsWith: "vault:" } }, select: { source: true } })).map((p) => p.source!));
const newGroups = [...groups.values()].filter((g) => !existingPromos.has(`vault:${g.key}`));
log(`Promos: ${groups.size} in the library, ${newGroups.length} new.`);

// ---------- order forms ----------
const orderForms = all.filter((f) => isOrderFormFile(f.path));
const existingExamples = new Set((await db.promoTrainingExample.findMany({ where: { brandId: brand.id, sourceRef: { startsWith: "vault:" } }, select: { sourceRef: true } })).map((e) => e.sourceRef!));
const newForms = orderForms.filter((f) => !existingExamples.has(`vault:${f.path}`));
log(`Order forms: ${orderForms.length} in the vault, ${newForms.length} new training examples.`);

if (!apply) {
  log("\nDry run. Nothing was written. Add --apply to import.");
  await prisma.$disconnect();
  process.exit(0);
}

// ================= apply =================
// Master Brain
{
  const slugs = new Set((await mainTx((tx) => tx.mainBrainNote.findMany({ select: { slug: true } }))).map((r) => r.slug));
  const nextSlug = (title: string) => {
    const base = (slugifyName(title) || "note").slice(0, 60);
    let slug = base;
    for (let n = 2; slugs.has(slug); n += 1) slug = `${base}-${n}`;
    slugs.add(slug);
    return slug;
  };
  const rows = mainPlan.rows.filter((r) => r.action === "create" || r.action === "update");
  let created = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 50) {
    await mainTx(async (tx) => {
      for (const row of rows.slice(i, i + 50)) {
        if (row.action === "create") {
          await tx.mainBrainNote.create({ data: { key: row.note.sourceRef, title: row.note.title, slug: nextSlug(row.note.title), body: row.note.body, folder: row.note.folder, origin: "IMPORTED", source: "vault-import", originSourceRef: row.note.sourceRef } });
          created += 1;
        } else if (row.existingId) {
          await tx.mainBrainNote.updateMany({ where: { id: row.existingId, deletedAt: null }, data: { title: row.note.title, body: row.note.body, folder: row.note.folder } });
          updated += 1;
        }
      }
    });
  }
  log(`Master Brain: ${created} created, ${updated} updated.`);
}

// The publisher's Brain
{
  const slugs = new Set((await db.knowledgePage.findMany({ select: { slug: true } })).map((r) => r.slug));
  const nextSlug = (title: string) => {
    const base = (slugifyName(title) || "note").slice(0, 60);
    let slug = base;
    for (let n = 2; slugs.has(slug); n += 1) slug = `${base}-${n}`;
    slugs.add(slug);
    return slug;
  };
  let created = 0;
  let updated = 0;
  for (const row of brandPlan.rows) {
    if (row.action === "create") {
      await db.knowledgePage.create({ data: { organizationId: org.id, brandId: brand.id, title: row.note.title, slug: nextSlug(row.note.title), body: row.note.body, folder: row.note.folder, source: "vault-import", sourceRef: row.note.sourceRef, visibility: "PRIVATE" } });
      created += 1;
    } else if (row.action === "update" && row.existingId) {
      await db.knowledgePage.updateMany({ where: { id: row.existingId, brandId: brand.id, deletedAt: null }, data: { title: row.note.title, body: row.note.body, folder: row.note.folder } });
      updated += 1;
    }
  }
  await db.auditLog.create({ data: { organizationId: org.id, action: "brain.vault_imported", targetType: "brand", targetId: brand.id, metadata: { created, updated, via: "import-brain-vault" } } });
  log(`${brand.name} Brain: ${created} created, ${updated} updated.`);
}

// Promos (files attached, queued for analysis)
{
  const mime = (path: string) =>
    /\.docx$/i.test(path) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : /\.pptx$/i.test(path) ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : /\.pdf$/i.test(path) ? "application/pdf" : /\.doc$/i.test(path) ? "application/msword" : "text/plain";
  let created = 0;
  let queued = 0;
  for (const group of newGroups) {
    const files = [...group.files].sort((a, b) => Number(/\.pptx$/i.test(a.path)) - Number(/\.pptx$/i.test(b.path)) || a.path.localeCompare(b.path));
    const main = files[0]!;
    const parsed = parseVaultPromoPath(main.path)!;
    const texts: string[] = [];
    for (const file of files) {
      const text = await docText(file.path, readFileSync(file.full));
      if (text) texts.push(files.length > 1 ? `===== ${file.path.split("/").pop()} =====\n${text}` : text);
    }
    const sourceText = texts.join("\n\n").slice(0, 400_000);
    const fields = promoFieldsFromVault(parsed);
    const title = parsed.group ? cleanPromoTitle(parsed.group.split("/").pop() ?? main.path) : cleanPromoTitle(main.path.split("/").pop()!);
    const analyzable = sourceText.trim().length >= 200;
    const promo = await db.promo.create({
      data: {
        organizationId: org.id,
        brandId: brand.id,
        title: title.slice(0, 200),
        filename: main.path.split("/").pop() ?? null,
        inputType: /\.docx$/i.test(main.path) ? "docx" : "text",
        sourceText,
        publisher: brand.name,
        product: parsed.code,
        promoType: fields.promoType,
        promoStatus: fields.promoStatus,
        isBestPerformer: fields.isBestPerformer,
        performanceScore: fields.performanceScore,
        trainingNotes: fields.trainingNotes,
        source: `vault:${group.key}`,
        analysisStatus: analyzable ? "QUEUED" : "NONE",
        analysisError: analyzable ? null : "No readable text in this file type. Open the attached file, or paste the copy and press Re-analyze.",
      },
      select: { id: true },
    });
    for (const [index, file] of files.entries()) {
      const data = readFileSync(file.full);
      await db.promoFile.create({ data: { organizationId: org.id, promoId: promo.id, kind: index === 0 ? "source" : "supplemental", category: index === 0 ? null : /\.pptx$/i.test(file.path) ? "Slides" : "Other", filename: file.path.split("/").pop()!, mimeType: mime(file.path), size: data.length, data } });
    }
    if (analyzable) {
      await db.promoBulkJob.create({ data: { organizationId: org.id, brandId: brand.id, promoId: promo.id, actorId: null } });
      queued += 1;
    }
    await db.auditLog.create({ data: { organizationId: org.id, action: "promo.created", targetType: "promo", targetId: promo.id, metadata: { via: "import-brain-vault" } } });
    created += 1;
  }
  log(`Promo Analyzer: ${created} promos created, ${queued} queued for analysis.`);
}

// Order forms → Packager training examples
{
  let created = 0;
  for (const file of newForms) {
    const text = await docText(file.path, readFileSync(file.full));
    if (text.length < 100) continue;
    const name = file.path.split("/").pop()!;
    await db.promoTrainingExample.create({
      data: { organizationId: org.id, brandId: brand.id, kind: "order-form", publication: codeFromFileName(name), niche: brand.niche ?? "general", title: cleanPromoTitle(name).slice(0, 200), content: text.slice(0, 60_000), source: "vault", sourceRef: `vault:${file.path}`, tags: ["brain-vault"] },
    });
    created += 1;
  }
  log(`Packager training: ${created} order-form examples added.`);
}

// Console sync (the same functions the app's jobs run)
{
  const past = await import("../src/features/console/past-data");
  const lens = await import("../src/features/main-brain/lens");
  log("Promo notes → Master Brain:", await past.syncPromosToMasterBrain());
  log("Industry lens:", await lens.reframeMainBrainNotes());
  for (let round = 0; round < 50; round += 1) {
    const result = await past.copyPromosIntoConsole({ limit: 40 });
    log("Console promos:", result);
    if (!result.remaining) break;
  }
  log("Console Packager:", await past.copyPackagerIntoConsole());
  for (let round = 0; round < 50; round += 1) {
    const result = await past.copyVideosIntoConsole({ limit: 60 });
    log("Console VidRipper:", result);
    if (!result.remaining) break;
  }
}

await prisma.$disconnect();
log("Done.");
