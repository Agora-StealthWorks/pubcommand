import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { originText, type MainOrigin } from "../../../../../modules/knowledge/main-brain";
import { sourceLabel } from "../../../../../modules/knowledge/visibility";
import { Snippet } from "../brain/parts";
import type { MainNoteRow, provenanceNames } from "./notes";

export type Names = Awaited<ReturnType<typeof provenanceNames>>;

/** "Example Gazette · Gazette Daily" for a learned note, or how it got here. */
export function provenanceOf(note: Pick<MainNoteRow, "origin" | "originOrganizationId" | "originBrandId" | "source">, names: Names): { where: string | null; how: string } {
  const org = note.originOrganizationId ? names.orgs.get(note.originOrganizationId)?.name ?? "Deleted organization" : null;
  const brand = note.originBrandId ? names.brands.get(note.originBrandId)?.name ?? "Deleted brand" : null;
  const where = [org, brand].filter(Boolean).join(" · ") || null;
  const how = note.origin === "LEARNED" ? sourceLabel(note.source) : originText(note.origin as MainOrigin);
  return { where, how };
}

const ORIGIN_TONE: Record<string, "accent" | "ok" | "neutral" | "warn"> = { LEARNED: "accent", IMPORTED: "neutral", AUTHORED: "ok", MIGRATED: "warn" };

export function OriginBadge({ origin }: { origin: string }) {
  const label = origin === "LEARNED" ? "Learned" : origin === "IMPORTED" ? "Imported" : origin === "AUTHORED" ? "Written" : "Migrated";
  return <Badge tone={ORIGIN_TONE[origin] ?? "neutral"}>{label}</Badge>;
}

export function MainNoteList({ notes, names, empty, snippets }: { notes: MainNoteRow[]; names: Names; empty: string; snippets?: Map<string, string> }) {
  if (notes.length === 0) return <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
      {notes.map((note) => {
        const p = provenanceOf(note, names);
        return (
          <li key={note.id}>
            <Link href={`/brain/${note.id}`} className="block px-4 py-3 hover:bg-canvas">
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-semibold text-ink">{note.title}</span>
                <OriginBadge origin={note.origin} />
                {note.pushScope !== "NONE" ? <Badge tone="ok">{note.pushScope === "ALL" ? "Pushed to all brands" : "Pushed to chosen brands"}</Badge> : null}
              </span>
              {snippets?.get(note.id) ? <Snippet text={snippets.get(note.id)!} /> : null}
              <span className="mt-0.5 block break-words text-xs text-muted">
                {[p.where, p.how, note.folder ?? "Top level", note.updatedAt.toISOString().slice(0, 10)].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BrainSubnav({ path }: { path: string }) {
  const item = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium ${active ? "bg-[#eef2ff] text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-line pb-2" aria-label="Main Brain">
      {item("/brain", "Notes", path === "/brain" || (/^\/brain\/[0-9a-f-]{36}/i.test(path) && !path.includes("/ask")))}
      {item("/brain/ask", "Ask the main Brain", path.startsWith("/brain/ask"))}
      {item("/brain/conflicts", "Conflicts", path.startsWith("/brain/conflicts"))}
      {item("/brain/graph", "Graph", path.startsWith("/brain/graph"))}
      {item("/brain/import", "Import", path.startsWith("/brain/import"))}
      {item("/brain/new", "+ New note", path === "/brain/new")}
    </nav>
  );
}
