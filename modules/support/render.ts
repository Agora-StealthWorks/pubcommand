/**
 * Platform-neutral knowledge documents for one agent profile. ElevenLabs, the export
 * bundle and any later platform are all built from buildDocs(), so what an agent can see
 * is defined in one place. Only published records inside the profile's scope appear.
 * Track record is never rendered: it is live-only through the trades tool.
 */
import { createHash } from "node:crypto";
import { scopeAllows, type Scope } from "./scope";
import { CATEGORIES, type Category } from "./taxonomy";

export type DocRecord = {
  id: string;
  category: string;
  audience: string;
  status: string;
  title: string;
  body: string;
  url: string | null;
  publicationCodes: string[];
  publishedAt?: string | null;
};

export type Doc = { docKey: string; name: string; text: string; hash: string };

/** One document per record for these; everything else is one bundle per category × audience. */
const PER_RECORD: ReadonlySet<string> = new Set(["products", "editors", "pricing"]);
/** ElevenLabs' text-document cap is far above this; smaller documents retrieve better. */
export const PART_CHARS = 90_000;

/** Whitespace-insensitive content hash: a platform that re-wraps text is not an edit. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
}

function header(fields: Record<string, string | undefined>): string {
  return `${Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n\n`;
}

function doc(docKey: string, name: string, text: string): Doc {
  return { docKey, name: name.slice(0, 200), text, hash: contentHash(text) };
}

function label(category: string): string {
  return CATEGORIES[category as Category]?.label ?? category;
}

function split(entries: string[]): string[][] {
  const parts: string[][] = [[]];
  let size = 0;
  for (const entry of entries) {
    if (size + entry.length > PART_CHARS && parts[parts.length - 1]!.length) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1]!.push(entry);
    size += entry.length + 2;
  }
  return parts;
}

export function buildDocs(records: readonly DocRecord[], scope: Scope): Doc[] {
  const visible = records
    .filter((r) => r.status === "published" && r.category !== "trades" && scopeAllows(scope, r.category, r.audience))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const docs: Doc[] = [];
  const bundles = new Map<string, DocRecord[]>();

  for (const record of visible) {
    if (PER_RECORD.has(record.category)) {
      const text =
        header({ Category: label(record.category), Audience: record.audience, Publication: record.publicationCodes.join(", ") || undefined, Id: `record:${record.id}` }) +
        `# ${record.title}\n\n${record.body}\n${record.url ? `\nLink: ${record.url}\n` : ""}`;
      docs.push(doc(`record:${record.id}`, `${label(record.category)}: ${record.title}`, text));
      continue;
    }
    const key = `${record.category}:${record.audience}`;
    bundles.set(key, [...(bundles.get(key) ?? []), record]);
  }

  for (const [key, rows] of [...bundles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [category, audience] = key.split(":") as [string, string];
    const ordered = category === "website" ? [...rows].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.title.localeCompare(b.title)) : rows;
    const entries = ordered.map((r) => `## ${r.title}${r.publicationCodes.length ? ` [${r.publicationCodes.join(", ")}]` : ""}\nId: record:${r.id}\n${r.body}${r.url && !r.body.includes(r.url) ? `\nLink: ${r.url}` : ""}`);
    const parts = split(entries);
    parts.forEach((part, index) => {
      const suffix = parts.length > 1 ? ` (part ${index + 1} of ${parts.length})` : "";
      const text = header({ Category: label(category), Audience: audience, Entries: String(part.length) }) + `# ${label(category)}, ${audience}${suffix}\n\n${part.join("\n\n")}\n`;
      docs.push(doc(`bundle:${key}${index ? `:${index + 1}` : ""}`, `${label(category)} (${audience})${suffix}`, text));
    });
  }
  return docs;
}

/** A safe file name for a document in the export bundle. */
export function docFileName(d: Doc, index: number): string {
  const base = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "document";
  return `${String(index + 1).padStart(3, "0")}-${base}.md`;
}
