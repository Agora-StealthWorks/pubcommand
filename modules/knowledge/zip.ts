/** Reading and writing vault zips in memory (fflate). Markdown only is inflated. */
import { unzipSync, zipSync, type Zippable } from "fflate";
import { decodeText, normalizeVaultPath, vaultRootPrefix } from "./vault";

export const MAX_ZIP_ENTRIES = 20_000;
export const MAX_UNZIPPED_BYTES = 400 * 1024 * 1024;

/**
 * Zip tools that do not set the UTF-8 flag (Info-ZIP, some Windows tools) get
 * their names decoded as Latin-1 ("â" for "—"). If the name's bytes are valid
 * UTF-8 when read back as Latin-1, use that.
 */
export function fixZipName(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const bytes = Uint8Array.from(name, (char) => char.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return name;
  }
}

export type ZipFile = { path: string; text: string | null; size: number };

export type ZipRead = { ok: true; files: ZipFile[]; rootPrefix: string } | { ok: false; error: string };

/**
 * List every file in a zip. Markdown files are inflated and decoded; other
 * files are listed (so the report can say they were skipped) but never inflated.
 */
export function readVaultZip(bytes: Uint8Array): ZipRead {
  const listed: { path: string; size: number; markdown: boolean }[] = [];
  let inflated = 0;
  let tooBig = false;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter(file) {
        const path = normalizeVaultPath(fixZipName(file.name));
        if (!path) return false;
        const markdown = /\.md$/i.test(path) && !path.startsWith("__MACOSX/");
        listed.push({ path, size: file.originalSize, markdown });
        if (!markdown) return false;
        inflated += file.originalSize;
        if (inflated > MAX_UNZIPPED_BYTES || listed.length > MAX_ZIP_ENTRIES) {
          tooBig = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    return { ok: false, error: "That file is not a readable .zip." };
  }
  if (tooBig) return { ok: false, error: "That zip is too large. Split the vault into smaller zips." };
  const byPath = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const path = normalizeVaultPath(fixZipName(name));
    if (path) byPath.set(path, data);
  }
  const rootPrefix = vaultRootPrefix(listed.map((file) => file.path));
  const files = listed.map((file) => {
    const data = byPath.get(file.path);
    return {
      path: rootPrefix && file.path.startsWith(rootPrefix) ? file.path.slice(rootPrefix.length) : file.path,
      size: file.size,
      text: file.markdown && data ? decodeText(data) : null,
    };
  });
  return { ok: true, files, rootPrefix };
}

export function writeVaultZip(files: readonly { path: string; text: string }[]): Uint8Array {
  const tree: Zippable = {};
  const encoder = new TextEncoder();
  for (const file of files) tree[file.path] = [encoder.encode(file.text), { level: 9 }];
  return zipSync(tree);
}
