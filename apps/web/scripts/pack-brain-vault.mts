/**
 * Build a text-only package of a brain vault for the production import
 * (knowledge.vault-import job): Markdown as is, and the text of every Word and
 * PowerPoint file as "<file>.docx.txt" / "<file>.pptx.txt". Images, PDFs and the
 * original documents are left out; the importer only uses text.
 *
 *   cd apps/web && node <tsx cli> scripts/pack-brain-vault.mts <vault dir> <out.zip>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { zipSync, type Zippable } from "fflate";
import mammoth from "mammoth";
import { pptxText } from "../../../modules/promo-studio/vault-promos";

const [vault, out] = process.argv.slice(2);
if (!vault || !out) throw new Error("Usage: pack-brain-vault.mts <vault dir> <out.zip>");
const SKIP_DIRS = new Set([".git", "node_modules", ".smart-env", ".obsidian", ".trash"]);
const files: Zippable = {};
let md = 0;
let docs = 0;
let bytes = 0;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) return SKIP_DIRS.has(name) ? [] : walk(full);
    return stat.isFile() ? [full] : [];
  });
}
for (const full of walk(vault)) {
  const path = relative(vault, full).split(sep).join("/");
  if (/\.md$/i.test(path)) {
    const data = readFileSync(full);
    files[path] = [data, { level: 9 }];
    md += 1;
    bytes += data.length;
  } else if (/\.(docx|pptx)$/i.test(path)) {
    const data = readFileSync(full);
    const text = /\.docx$/i.test(path) ? (await mammoth.extractRawText({ buffer: data })).value.replace(/\n{3,}/g, "\n\n").trim() : pptxText(new Uint8Array(data));
    const encoded = new TextEncoder().encode(text);
    files[`${path}.txt`] = [encoded, { level: 9 }];
    docs += 1;
    bytes += encoded.length;
  } else if (/\.doc$/i.test(path)) {
    // Old binary Word: no text extractor; an empty stand-in keeps the promo grouping.
    files[`${path}.txt`] = new Uint8Array();
  }
}
const zip = zipSync(files);
writeFileSync(out, zip);
console.log(JSON.stringify({ markdown: md, documents: docs, textMB: +(bytes / 1e6).toFixed(1), zipMB: +(zip.length / 1e6).toFixed(1), out }));
