import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { platformTx } from "@pubcommand/db";

/**
 * "How PubCommand works" in the Operations Brain: every doc in the repository (README, docs/*.md,
 * DEPLOY.md and each app's modules/<app>/README.md) is kept as a reference note, organized in
 * folders, with a start-here index. The repository is the source: each boot and each nightly
 * usage.insights run rewrites the notes, adds new docs and retires removed ones. A note staff
 * edit becomes theirs and is left alone.
 *
 * Rule for everyone changing the app (see CLAUDE.md / AGENTS.md): when functionality changes,
 * update the matching doc in the same change, so the Brain always knows how the app works today.
 */

export const REFERENCE_FOLDERS = ["Start here", "Platform", "Apps", "AI agents", "Usage & insights"] as const;
export type ReferenceFolder = (typeof REFERENCE_FOLDERS)[number];

type Doc = { file: string; folder: ReferenceFolder; title?: string };

/** Docs with a fixed place. Any other docs/*.md goes to Platform; every app README goes to Apps. */
const PLACED: Record<string, Omit<Doc, "file">> = {
  "README.md": { folder: "Start here", title: "What PubCommand is" },
  "docs/ARCHITECTURE.md": { folder: "Platform" },
  "docs/MODULES.md": { folder: "Platform" },
  "docs/BUILDING-APPS.md": { folder: "Platform" },
  "DEPLOY.md": { folder: "Platform" },
  "docs/AI-AGENTS.md": { folder: "AI agents" },
  "docs/USAGE.md": { folder: "Usage & insights" },
};

const INDEX_KEY = "doc:index";
const INDEX_TITLE = "How PubCommand works (start here)";

export function repoRoot(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, "docs")) && existsSync(path.join(dir, "modules"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

export function referenceDocs(root: string): Doc[] {
  const docs: Doc[] = [];
  for (const [file, place] of Object.entries(PLACED)) if (existsSync(path.join(root, file))) docs.push({ file, ...place });
  for (const name of readdirSync(path.join(root, "docs")).sort()) {
    const file = `docs/${name}`;
    if (name.endsWith(".md") && !PLACED[file]) docs.push({ file, folder: "Platform" });
  }
  for (const name of readdirSync(path.join(root, "modules")).sort()) {
    const file = `modules/${name}/README.md`;
    if (name !== "example" && existsSync(path.join(root, file))) docs.push({ file, folder: "Apps" });
  }
  return docs;
}

/** Title from the doc's first heading; the heading itself is dropped from the body. */
export function docNote(markdown: string, doc: Doc): { title: string; body: string } {
  const text = markdown.replace(/\r\n/g, "\n");
  const heading = /^#\s+(.+)\n+/.exec(text);
  const title = (doc.title ?? heading?.[1]?.replace(/`/g, "").trim() ?? doc.file).slice(0, 200);
  const body = `${(heading ? text.slice(heading[0].length) : text).trim()}\n\n---\n_Source: \`${doc.file}\` in the PubCommand repository, kept in sync automatically. Folder: ${doc.folder}._`;
  return { title, body };
}

function indexBody(notes: { folder: ReferenceFolder; title: string }[]): string {
  const sections = REFERENCE_FOLDERS.flatMap((folder) => {
    const inFolder = notes.filter((note) => note.folder === folder);
    return inFolder.length ? [`## ${folder}\n\n${inFolder.map((note) => `- [[${note.title}]]`).join("\n")}`] : [];
  });
  return [
    "Everything PubCommand does today, from its own documentation. These notes update themselves whenever the app changes, so this is the current state of the product.",
    "Read **What PubCommand is** first, then **Platform** for how it is built (organizations, brands, permissions, hosts), **Apps** for each app people use, **AI agents** for how agents connect, and **Usage & insights** for how usage is tracked and how the daily and weekly reads are written.",
    ...sections,
  ].join("\n\n");
}

export async function syncReference(root: string | null = repoRoot()): Promise<{ synced: number; updated: number; kept: number; retired: number }> {
  if (!root) return { synced: 0, updated: 0, kept: 0, retired: 0 };
  const docs = referenceDocs(root);
  const notes = docs.map((doc) => ({ key: `doc:${doc.file}`, folder: doc.folder, ...docNote(readFileSync(path.join(root, doc.file), "utf8"), doc) }));
  notes.push({ key: INDEX_KEY, folder: "Start here", title: INDEX_TITLE, body: indexBody(notes) });
  return platformTx(
    async (tx) => {
      let synced = 0;
      let updated = 0;
      let kept = 0;
      const existing = await tx.opsBrainNote.findMany({ where: { key: { startsWith: "doc:" } }, select: { id: true, key: true, source: true, title: true, body: true, folder: true, deletedAt: true } });
      const byKey = new Map(existing.map((row) => [row.key, row]));
      for (const note of notes) {
        const row = byKey.get(note.key);
        if (!row) {
          await tx.opsBrainNote.create({ data: { key: note.key, kind: "reference", folder: note.folder, title: note.title, body: note.body, source: "docs" } });
          synced += 1;
        } else if (row.source !== "docs") {
          kept += 1;
        } else if (row.body !== note.body || row.title !== note.title || row.folder !== note.folder || row.deletedAt) {
          await tx.opsBrainNote.update({ where: { id: row.id }, data: { kind: "reference", folder: note.folder, title: note.title, body: note.body, deletedAt: null } });
          updated += 1;
        }
      }
      const current = new Set(notes.map((note) => note.key));
      const gone = existing.filter((row) => row.source === "docs" && !row.deletedAt && !current.has(row.key)).map((row) => row.id);
      if (gone.length) await tx.opsBrainNote.updateMany({ where: { id: { in: gone } }, data: { deletedAt: new Date() } });
      return { synced, updated, kept, retired: gone.length };
    },
  );
}
