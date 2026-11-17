/**
 * Split a publisher's Obsidian vault into two importable zips:
 *
 *   <out>/mta-mini-brain.zip   the publisher's own notes -> its brand Brain (org app: Brain → Import)
 *   <out>/main-brain.zip       general know-how          -> the main Brain (admin console: Main Brain → Import)
 *   <out>/brain-split.manifest.json + .csv   every note with its destination, the rule that decided it, and evidence
 *
 *   pnpm --filter @pubcommand/modules exec tsx ../scripts/build-brain-split.ts <vault dir> <out dir> \
 *     [--rules scripts/brain-split.mta.json] [--wiki <mta-wiki dir>] [--mtarix <mtarix dir>]
 *
 * Exclusions are the approved export rules (modules/knowledge/vault.ts MTA_EXPORT_RULES:
 * Inbox, AI session logs, meetings, templates, archive, attachments, personal/Work
 * folders, notes tagged personal/private, agent instruction files) plus secrets.
 * Classification is deterministic (modules/knowledge/classify.ts). Editor and
 * publication names are read from the wiki's lib/gurus.ts, MTARIX's lib/domain.ts
 * and the vault's MTARIX Publications Ledger, so no names live in this repo.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNote, compileRules, namesFromSource, publicationsFromTable, type ClassifierRules } from "../modules/knowledge/classify";
import { decodeText, exportDecision, MTA_EXPORT_RULES, SKIP_LABELS, type SkipReason } from "../modules/knowledge/vault";
import { writeVaultZip } from "../modules/knowledge/zip";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const positional = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const [vaultArg, outArg] = positional;
if (!vaultArg || !outArg) {
  console.error("Usage: build-brain-split.ts <vault dir> <out dir> [--rules file] [--wiki dir] [--mtarix dir]");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const vault = resolve(vaultArg);
const out = resolve(outArg);
const rulesFile = resolve(flag("rules") ?? join(here, "brain-split.mta.json"));
const wiki = flag("wiki") ? resolve(flag("wiki")!) : null;
const mtarix = flag("mtarix") ? resolve(flag("mtarix")!) : null;
mkdirSync(out, { recursive: true });

const config = JSON.parse(readFileSync(rulesFile, "utf8")) as Omit<ClassifierRules, "people" | "publications" | "publicationCodes">;

// Names from source files (read at build time, never committed).
const people = new Set<string>();
const publications = new Set<string>();
const codes = new Set<string>();
if (wiki && existsSync(join(wiki, "lib/gurus.ts"))) namesFromSource(readFileSync(join(wiki, "lib/gurus.ts"), "utf8")).forEach((name) => people.add(name));
if (wiki && existsSync(join(wiki, "lib/descriptions.ts"))) {
  for (const match of readFileSync(join(wiki, "lib/descriptions.ts"), "utf8").matchAll(/^\s{2}([A-Z][A-Z0-9]{1,11}):\s*\{/gm)) codes.add(match[1]!);
}
if (mtarix && existsSync(join(mtarix, "lib/domain.ts"))) {
  const source = readFileSync(join(mtarix, "lib/domain.ts"), "utf8");
  const block = /export const PUBLICATIONS = \[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
  for (const match of block.matchAll(/"([A-Z][A-Z0-9]{1,11})"/g)) codes.add(match[1]!);
}
const ledger = join(vault, "Areas/MTA/MTARIX Publications Ledger.md");
if (existsSync(ledger)) {
  for (const row of publicationsFromTable(readFileSync(ledger, "utf8"))) {
    codes.add(row.code);
    publications.add(row.name);
  }
}
// "TD" was retired; two-letter codes are too ambiguous as words anyway.
for (const code of [...codes]) if (code.length < 3) codes.delete(code);

const rules: ClassifierRules = { ...config, people: [...people].sort(), publications: [...publications].sort(), publicationCodes: [...codes].sort() };
const compiled = compileRules(rules);

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

type Row = { path: string; destination: "mta-mini-brain" | "main-brain"; rule: string; evidence: string[] };
const rows: Row[] = [];
const excluded: Partial<Record<SkipReason, number>> = {};
const secretFiles: { path: string; detail: string }[] = [];
const brand: { path: string; text: string }[] = [];
const general: { path: string; text: string }[] = [];

for (const full of walk(vault)) {
  const path = relative(vault, full).split(sep).join("/");
  const text = /\.md$/i.test(path) ? decodeText(readFileSync(full)) : null;
  const decision = exportDecision(path, text, MTA_EXPORT_RULES);
  if (!decision.ok) {
    excluded[decision.reason] = (excluded[decision.reason] ?? 0) + 1;
    if (decision.reason === "secret") secretFiles.push({ path, detail: decision.detail ?? "" });
    continue;
  }
  const result = classifyNote(decision.note.path, decision.note.body, compiled);
  const destination = result.destination === "brand" ? "mta-mini-brain" : "main-brain";
  rows.push({ path: decision.note.path, destination, rule: result.rule, evidence: result.evidence });
  (result.destination === "brand" ? brand : general).push({ path: decision.note.path, text: decision.note.body });
}
rows.sort((a, b) => a.path.localeCompare(b.path));

writeFileSync(join(out, "mta-mini-brain.zip"), writeVaultZip(brand));
writeFileSync(join(out, "main-brain.zip"), writeVaultZip(general));

const count = (list: Row[], key: (row: Row) => string) => {
  const map: Record<string, number> = {};
  for (const row of list) map[key(row)] = (map[key(row)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
};
const top = (path: string) => path.split("/").slice(0, path.startsWith("Resources/") || path.startsWith("Areas/") ? 2 : 1).join("/").replace(/\.md$/i, "");
const manifest = {
  source: vault,
  builtAt: new Date().toISOString(),
  rulesFile,
  rules: { ...rules, people: rules.people.length, publications: rules.publications, publicationCodes: rules.publicationCodes },
  exportRules: MTA_EXPORT_RULES,
  totals: { notes: rows.length, "mta-mini-brain": brand.length, "main-brain": general.length },
  byRule: { "mta-mini-brain": count(rows.filter((row) => row.destination === "mta-mini-brain"), (row) => row.rule), "main-brain": count(rows.filter((row) => row.destination === "main-brain"), (row) => row.rule) },
  byFolder: Object.fromEntries(
    Object.entries(count(rows, (row) => top(row.path))).map(([folder]) => [
      folder,
      { "mta-mini-brain": rows.filter((row) => top(row.path) === folder && row.destination === "mta-mini-brain").length, "main-brain": rows.filter((row) => top(row.path) === folder && row.destination === "main-brain").length },
    ]),
  ),
  excluded: Object.fromEntries(Object.entries(excluded).map(([reason, n]) => [SKIP_LABELS[reason as SkipReason], n])),
  secretFiles,
  notes: rows,
};
writeFileSync(join(out, "brain-split.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const csv = ["path,destination,rule,evidence", ...rows.map((row) => [row.path, row.destination, row.rule, row.evidence.join("; ")].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))].join("\n");
writeFileSync(join(out, "brain-split.manifest.csv"), `${csv}\n`);
console.log(JSON.stringify({ out, totals: manifest.totals, byRule: manifest.byRule, excluded: manifest.excluded, secretFiles: secretFiles.length }, null, 2));
