import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { recheckEntity } from "@/features/brain-conflicts/actions";
import { entityNotes } from "@/features/brain-conflicts/check";
import { loadEntity } from "@/features/brain-conflicts/entities";
import { supersededNoteIds } from "@/features/brain-conflicts/flags";
import { setupUrl } from "@/features/brain-conflicts/links";
import { ConflictCard, ConflictStatusBadge, kindLabel } from "@/features/brain-conflicts/parts";
import { entityCheck, entityConflicts } from "@/features/brain-conflicts/queries";
import { listMainBrainNotesByEntity, provenanceNames } from "@/features/main-brain/notes";
import { OriginBadge } from "@/features/main-brain/parts";
import { brainStaff } from "@/features/main-brain/staff";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { extractStatements, factLabel, factText, type Statement } from "../../../../../../../../../../../modules/knowledge/conflicts";

export default async function ConflictEntityPage({ params, searchParams }: { params: Promise<{ kind: string; entityId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { kind, entityId } = await params;
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  if (kind !== "publication" && kind !== "editor") notFound();
  const record = await loadEntity(kind, entityId);
  if (!record) notFound();
  const [notes, conflicts, check, names, setup, allMatches] = await Promise.all([
    entityNotes(record),
    entityConflicts(kind, entityId),
    entityCheck(kind, entityId),
    provenanceNames(),
    setupUrl({ organizationSlug: record.organizationSlug, kind, id: entityId }),
    listMainBrainNotesByEntity(record.name, { aliases: record.entity.aliases, limit: 60 }),
  ]);
  const outdated = await supersededNoteIds(allMatches.map((n) => n.id));
  const statements = extractStatements(record.entity, notes);
  const byFact = new Map<string, Statement[]>();
  for (const s of statements) {
    const list = byFact.get(s.factKey) ?? [];
    if (!list.some((x) => x.noteId === s.noteId && x.quote === s.quote)) list.push(s);
    byFact.set(s.factKey, list);
  }
  const titles = new Map(notes.map((n) => [n.id, n.title]));
  const openByFact = new Map<string, typeof conflicts>();
  for (const c of conflicts.filter((c) => c.status === "OPEN")) openByFact.set(c.factKey, [...(openByFact.get(c.factKey) ?? []), c]);
  const keys = Object.keys(record.entity.fields);
  const running = check?.status === "queued" || check?.status === "running";

  return (
    <div className="max-w-6xl">
      <Link href="/brain/conflicts?view=entities" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← Conflicts
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
          {record.name}
          {record.code ? ` (${record.code})` : ""}
        </h1>
        <Badge tone="neutral">{kindLabel(kind)}</Badge>
        {record.archived ? <Badge tone="warn">Archived</Badge> : null}
      </div>
      <p className="mt-1 break-words text-sm text-muted">
        {record.organizationName} · {record.brandName} · {notes.length} main-Brain note{notes.length === 1 ? "" : "s"} compared
        {check?.checkedAt ? ` · checked ${check.checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : " · not checked yet"}
      </p>
      {check?.aiReason ? <p className="mt-2 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">{check.aiReason}</p> : null}
      {check?.status === "failed" ? <p className="mt-2 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">The last check failed: {check.error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={recheckEntity}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="entityId" value={entityId} />
          <Button type="submit" disabled={running}>
            {running ? "Checking…" : "Re-check now"}
          </Button>
        </form>
        {running ? <AutoRefresh /> : null}
        <a href={setup} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
          Open in Publication Setup ↗
        </a>
      </div>

      <section className="mt-6" aria-labelledby="facts-h">
        <h2 id="facts-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Facts side by side
        </h2>
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <div className="hidden grid-cols-[160px_minmax(0,1fr)_minmax(0,1.3fr)] gap-4 border-b border-line bg-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
            <span>Fact</span>
            <span>Publication Setup (source of truth)</span>
            <span>What the main Brain says</span>
          </div>
          <ul className="divide-y divide-line">
            {keys.map((key) => {
              const said = byFact.get(key) ?? [];
              const ai = (openByFact.get(key) ?? []).filter((c) => c.layer === "ai");
              return (
                <li key={key} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1.3fr)] md:gap-4">
                  <span className="font-semibold">{factLabel(key)}</span>
                  <span className="min-w-0 whitespace-pre-line break-words">{factText(record.entity.fields[key]).slice(0, 600)}</span>
                  <span className="min-w-0 space-y-1.5">
                    {said.length === 0 && ai.length === 0 ? <span className="text-muted">Nothing specific</span> : null}
                    {said.map((s, i) => (
                      <span key={`${s.noteId}-${i}`} className="block break-words">
                        <Badge tone={s.agrees ? "ok" : "danger"}>{s.agrees ? "Agrees" : "Conflicts"}</Badge> {s.noteSays}{" "}
                        <Link href={`/brain/${s.noteId}`} className="text-xs text-accent hover:underline">
                          {titles.get(s.noteId) ?? "note"}
                        </Link>
                      </span>
                    ))}
                    {ai.map((c) => (
                      <span key={c.id} className="block break-words">
                        <Badge tone="accent">AI</Badge> {c.noteSays}{" "}
                        <Link href={`/brain/conflicts/${c.id}`} className="text-xs text-accent hover:underline">
                          {c.noteTitle}
                        </Link>
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0" aria-labelledby="conf-h">
          <h2 id="conf-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Conflicts · {conflicts.length}
          </h2>
          {conflicts.length === 0 ? <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">No conflicts recorded for it.</p> : null}
          <ul className="space-y-3">
            {conflicts.map((row) => (
              <ConflictCard key={row.id} row={row} names={names} showEntity={false} />
            ))}
          </ul>
        </section>
        <aside className="min-w-0">
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Main-Brain notes about it</h2>
            {allMatches.length === 0 ? <p className="mt-2 text-sm text-muted">No main-Brain note mentions it.</p> : null}
            <ul className="mt-2 space-y-2">
              {allMatches.slice(0, 40).map((note) => {
                const compared = notes.some((n) => n.id === note.id);
                const open = conflicts.filter((c) => c.noteId === note.id && c.status === "OPEN").length;
                return (
                  <li key={note.id} className="text-sm">
                    <Link href={`/brain/${note.id}`} className="break-words font-medium text-accent hover:underline">
                      {note.title}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      <OriginBadge origin={note.origin} />
                      {outdated.has(note.id) ? <Badge tone="warn">Outdated</Badge> : null}
                      {!compared && !outdated.has(note.id) ? <Badge tone="neutral">Other publisher</Badge> : null}
                      {open ? <ConflictStatusBadge status="OPEN" resolution={null} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted">Notes learned from another organization or brand are about a different publisher and are not compared. Outdated notes are skipped.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
