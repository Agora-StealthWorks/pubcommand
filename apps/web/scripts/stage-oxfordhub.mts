/**
 * Stage the OxfordHub export for the console import (features/console/oxfordhub-import.ts):
 * copies the JSON exports, writes each promo's text (vault "Promo Copy" notes, else the
 * file's own text), keeps source files up to 10 MB, and extracts supporting files' text.
 *
 *   node <tsx> scripts/stage-oxfordhub.mts <export dir> <vault Source Copy dir> <out dir>
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import mammoth from "mammoth";
import { reviewIdFromNote, sourceCopyFromNote } from "../../../modules/promo-studio/oxfordhub";

const [exportDir, sourceCopyDir, out] = process.argv.slice(2);
if (!exportDir || !sourceCopyDir || !out) throw new Error("Usage: stage-oxfordhub.mts <export dir> <Source Copy dir> <out dir>");
const SOURCE_MAX = 10 * 1024 * 1024;

async function textOf(path: string): Promise<string> {
  const data = readFileSync(path);
  if (/\.docx$/i.test(path)) return (await mammoth.extractRawText({ buffer: data })).value.replace(/\n{3,}/g, "\n\n").trim();
  if (/\.pdf$/i.test(path)) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    try {
      const result = await extractText(await getDocumentProxy(new Uint8Array(data)), { mergePages: true });
      return (Array.isArray(result.text) ? result.text.join("\n") : result.text).trim();
    } catch {
      return "";
    }
  }
  if (/\.(txt|md)$/i.test(path)) return data.toString("utf8").trim();
  return "";
}

mkdirSync(join(out, "packager"), { recursive: true });
mkdirSync(join(out, "sourcecopy"), { recursive: true });
for (const name of ["reviews.json", "performance.json", "learning.json"]) copyFileSync(join(exportDir, name), join(out, name));
for (const name of readdirSync(join(exportDir, "packager"))) if (/^package-.+\.json$/.test(name)) copyFileSync(join(exportDir, "packager", name), join(out, "packager", name));

const copies = new Map<string, string>();
for (const name of readdirSync(sourceCopyDir)) {
  const md = readFileSync(join(sourceCopyDir, name), "utf8");
  const id = reviewIdFromNote(md);
  if (id) copies.set(id, sourceCopyFromNote(md));
}
const reviews = JSON.parse(readFileSync(join(exportDir, "reviews.json"), "utf8")) as { id: string }[];
let fromVault = 0, fromFile = 0, sources = 0, supplemental = 0, texts = 0;
for (const r of reviews) {
  const src = join(exportDir, "files", r.id);
  const dst = join(out, "files", r.id);
  mkdirSync(dst, { recursive: true });
  const entries = existsSync(src) ? readdirSync(src) : [];
  let text = copies.get(r.id) ?? "";
  if (text) fromVault += 1;
  for (const name of entries) {
    const full = join(src, name);
    if (name.startsWith("source__")) {
      if (!text) {
        text = await textOf(full);
        if (text) fromFile += 1;
      }
      if (statSync(full).size <= SOURCE_MAX) {
        copyFileSync(full, join(dst, name));
        sources += 1;
      }
    } else if (name === "supplemental.json") copyFileSync(full, join(dst, name));
    else if (name.startsWith("sup__")) {
      copyFileSync(full, join(dst, name));
      supplemental += 1;
      const t = await textOf(full);
      if (t) {
        writeFileSync(join(dst, `${name}.txt`), t);
        texts += 1;
      }
    }
  }
  writeFileSync(join(out, "sourcecopy", `${r.id}.txt`), text);
}
console.log(JSON.stringify({ reviews: reviews.length, textFromVault: fromVault, textFromFile: fromFile, sourcesKept: sources, supplemental, supplementalTexts: texts }));
