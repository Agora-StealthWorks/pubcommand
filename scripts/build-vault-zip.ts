/**
 * Build an importable Brain zip from an Obsidian vault folder.
 *
 *   pnpm --filter @pubcommand/modules exec tsx ../scripts/build-vault-zip.ts <vault dir> <out.zip>
 *
 * Uses the same rules as the in-app importer (modules/knowledge/vault.ts) plus
 * the export rules approved for the MTA vault: no Inbox, AI session logs,
 * meetings, templates, archive, attachments, personal/Work folders, notes
 * tagged personal/private, agent instruction files, or anything that looks
 * like a secret. Writes <out>.manifest.json next to the zip.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { decodeText, exportDecision, MTA_EXPORT_RULES, reportFolder, SKIP_LABELS, type SkipReason } from "../modules/knowledge/vault";
import { writeVaultZip } from "../modules/knowledge/zip";

const [sourceArg, outArg] = process.argv.slice(2);
if (!sourceArg || !outArg) {
  console.error("Usage: build-vault-zip.ts <vault dir> <out.zip>");
  process.exit(1);
}
const source = resolve(sourceArg);
const out = resolve(outArg);

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    // Never descend into git or dependency folders.
    if (stat.isDirectory()) {
      if (name === ".git" || name === "node_modules") {
        files.push(`${full}${sep}`);
        continue;
      }
      walk(full, files);
    } else if (stat.isFile()) files.push(full);
  }
  return files;
}

type FolderCount = { included: number; excluded: number };
const byFolder = new Map<string, FolderCount>();
const reasons: Partial<Record<SkipReason, number>> = {};
const secretFiles: { path: string; detail: string }[] = [];
const personalFiles: string[] = [];
const included: { path: string; text: string }[] = [];

for (const full of walk(source)) {
  const path = relative(source, full).split(sep).join("/");
  const isDir = path.endsWith("/");
  const text = !isDir && /\.md$/i.test(path) ? decodeText(readFileSync(full)) : null;
  const decision = isDir ? ({ ok: false, path, reason: "hidden" } as const) : exportDecision(path, text, MTA_EXPORT_RULES);
  const folder = reportFolder(path, path.startsWith("AI/") || path.startsWith("Resources/") || path.startsWith("Areas/") || path.startsWith("Projects/") ? 2 : 1);
  const count = byFolder.get(folder) ?? { included: 0, excluded: 0 };
  if (decision.ok) {
    included.push({ path: decision.note.path, text: decision.note.body });
    count.included += 1;
  } else {
    count.excluded += 1;
    reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1;
    if (decision.reason === "secret") secretFiles.push({ path, detail: decision.detail ?? "" });
    if (decision.reason === "personal") personalFiles.push(path);
  }
  byFolder.set(folder, count);
}

writeFileSync(out, writeVaultZip(included));
const manifest = {
  source,
  output: out,
  builtAt: new Date().toISOString(),
  rules: MTA_EXPORT_RULES,
  included: included.length,
  excluded: Object.values(reasons).reduce((sum, n) => sum + (n ?? 0), 0),
  excludedByReason: Object.fromEntries(Object.entries(reasons).map(([reason, n]) => [SKIP_LABELS[reason as SkipReason], n])),
  byFolder: Object.fromEntries([...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))),
  secretFiles,
  personalFiles,
  includedFiles: included.map((file) => file.path).sort(),
};
writeFileSync(`${out.replace(/\.zip$/i, "")}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output: out, included: manifest.included, excluded: manifest.excluded, excludedByReason: manifest.excludedByReason, secretFiles: secretFiles.length }, null, 2));
