import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import type { FolderNode } from "../../../../../modules/knowledge/folders";
import { isBestPractice, originLabel, type BrainScope } from "../../../../../modules/knowledge/visibility";
import { brainHref } from "./context";
import { HIT_CLOSE, HIT_OPEN } from "./search";

export type NoteRow = {
  id: string;
  title: string;
  folder: string | null;
  brandId: string | null;
  visibility: "PRIVATE" | "SHARED";
  source: string;
  updatedAt: Date;
};

/** Badges: a best practice, or a note another brand shared (with that brand's name). */
export function NoteBadges({ note, scope, brandNames }: { note: Pick<NoteRow, "brandId" | "visibility" | "source">; scope: BrainScope; brandNames: Map<string, string> }) {
  if (isBestPractice(note)) return <Badge tone="neutral">Best practice</Badge>;
  const foreign = note.brandId !== scope.brandId;
  return (
    <>
      {note.visibility === "SHARED" ? <Badge tone="ok">Shared</Badge> : null}
      {foreign ? <Badge tone="accent">{`From ${originLabel(note, brandNames)}`}</Badge> : null}
    </>
  );
}

export function NoteList({ notes, scope, brandNames, empty, snippets }: { notes: NoteRow[]; scope: BrainScope; brandNames: Map<string, string>; empty: string; snippets?: Map<string, string> }) {
  if (notes.length === 0) return <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
      {notes.map((note) => (
        <li key={note.id}>
          <Link href={brainHref(`/knowledge/${note.id}`)} className="block px-4 py-3 hover:bg-canvas">
            <span className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words text-sm font-semibold text-ink">{note.title}</span>
              <NoteBadges note={note} scope={scope} brandNames={brandNames} />
            </span>
            {snippets?.get(note.id) ? <Snippet text={snippets.get(note.id)!} /> : null}
            <span className="mt-0.5 block truncate text-xs text-muted">
              {note.folder ?? "Top level"} · {note.updatedAt.toISOString().slice(0, 10)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Search snippet with «hits» highlighted, rendered as text (never HTML). */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${HIT_OPEN}[^${HIT_CLOSE}]*${HIT_CLOSE})`));
  return (
    <span className="brain-snippet mt-1 block break-words text-sm text-muted">
      {parts.map((part, index) =>
        part.startsWith(HIT_OPEN) ? <mark key={index}>{part.slice(1, -1)}</mark> : <span key={index}>{part}</span>,
      )}
    </span>
  );
}

export function FolderTree({ nodes, hrefFor, active }: { nodes: FolderNode[]; hrefFor: (path: string) => string; active: string | null }) {
  if (nodes.length === 0) return <p className="px-2 py-1 text-xs text-muted">No folders yet.</p>;
  return <ul className="space-y-0.5">{nodes.map((node) => <FolderItem key={node.path} node={node} hrefFor={hrefFor} active={active} />)}</ul>;
}

function FolderItem({ node, hrefFor, active }: { node: FolderNode; hrefFor: (path: string) => string; active: string | null }) {
  const isActive = active === node.path;
  const open = Boolean(active && (active === node.path || active.startsWith(`${node.path}/`)));
  const link = (
    <Link
      href={hrefFor(node.path)}
      className={`flex min-h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-sm ${isActive ? "bg-[#eef2ff] font-semibold text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
    >
      <span className="truncate">{node.name}</span>
      <span className="shrink-0 text-xs text-muted">{node.total}</span>
    </Link>
  );
  if (node.children.length === 0) return <li className="flex pl-5">{link}</li>;
  return (
    <li>
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
          <span className="w-5 shrink-0 text-center text-xs text-muted transition group-open:rotate-90" aria-hidden>
            ▸
          </span>
          {link}
        </summary>
        <div className="ml-2 border-l border-line pl-1">
          <FolderTree nodes={node.children} hrefFor={hrefFor} active={active} />
        </div>
      </details>
    </li>
  );
}
