import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { brainStaff } from "@/features/main-brain/staff";
import { writeDailyNowAction } from "@/features/usage/ops-actions";
import { OPS_KIND_LABELS, listOpsNotes, opsNoteCounts, searchOpsNotes, type OpsKind } from "@/features/usage/ops-brain";
import { when } from "@/features/usage/parts";
import { REFERENCE_FOLDERS } from "@/features/usage/reference";

/** The Operations Brain: strategic notes about how the business runs, separate from the marketing knowledge in Notes. */
export default async function OpsBrainPage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; error?: string; notice?: string }> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const q = query.q?.trim() ?? "";
  const reference = query.kind === "reference" && !q;
  const [notes, counts] = await Promise.all([q ? searchOpsNotes(q, 50) : listOpsNotes({ kind: query.kind, take: 200 }), opsNoteCounts()]);
  const filters: { key: string; label: string }[] = [
    { key: "", label: "Insights" },
    ...(["weekly", "daily", "note"] as OpsKind[]).map((kind) => ({ key: kind, label: `${OPS_KIND_LABELS[kind]} (${counts[kind] ?? 0})` })),
    { key: "reference", label: `How PubCommand works (${counts.reference ?? 0})` },
  ];
  const folders = [...REFERENCE_FOLDERS, null].map((folder) => ({
    folder: folder ?? "Other",
    notes: notes.filter((note) => (folder ? note.folder === folder : !REFERENCE_FOLDERS.includes(note.folder as never))).sort((a, b) => (a.key === "doc:index" ? -1 : b.key === "doc:index" ? 1 : a.title.localeCompare(b.title))),
  }));
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Operations Brain"
          description="How the business really runs: marketing tactics, copy, strategy trends and how people work, learned every night from what people did and made in PubCommand. Kept apart from the marketing notes, never pushed to brands."
        />
        <div className="flex flex-wrap gap-2">
          <form action={writeDailyNowAction}>
            <Button type="submit" variant="secondary" size="sm">Write yesterday&apos;s read now</Button>
          </form>
          <Link href="/brain/ops/new" className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">+ New note</Link>
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.key}
            href={filter.key ? `/brain/ops?kind=${filter.key}` : "/brain/ops"}
            className={`inline-flex min-h-9 items-center rounded-md border px-3 text-sm ${(query.kind ?? "") === filter.key && !q ? "border-[#1e3a8a] bg-[#eef2ff] font-semibold text-[#1e3a8a]" : "border-line bg-white hover:bg-canvas"}`}
          >
            {filter.label}
          </Link>
        ))}
        <form method="get" className="ml-auto flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search the Operations Brain" aria-label="Search" className="w-64" />
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>
      </div>
      {reference ? (
        <div className="space-y-5">
          <p className="text-sm text-muted">Synced from PubCommand&apos;s own documentation every time the app starts and every night, so it always describes the app as it is today.</p>
          {folders
            .filter((group) => group.notes.length)
            .map((group) => (
              <section key={group.folder}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{group.folder}</h2>
                <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                  {group.notes.map((note) => (
                    <li key={note.id}>
                      <Link href={`/brain/ops/${note.id}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 hover:bg-canvas">
                        <span className={note.key === "doc:index" ? "font-semibold" : "font-medium"}>{note.title}</span>
                        <span className="shrink-0 text-xs text-muted">{note.source === "docs" ? `updated ${when(note.updatedAt)}` : "edited by staff"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {notes.length === 0 ? <p className="text-sm text-muted">Nothing yet. These notes appear the next time the app starts.</p> : null}
        </div>
      ) : (
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {notes.map((note) => (
          <li key={note.id}>
            <Link href={`/brain/ops/${note.id}`} className="block px-4 py-3 hover:bg-canvas">
              <p className="text-xs uppercase tracking-wide text-muted">{OPS_KIND_LABELS[note.kind as OpsKind] ?? note.kind}{note.folder ? ` · ${note.folder}` : ""} · {when(note.periodStart ?? note.createdAt)}</p>
              <p className="mt-0.5 font-medium">{note.title}</p>
              {"snippet" in note ? <p className="mt-1 text-sm text-muted" dangerouslySetInnerHTML={{ __html: escapeSnippet(String(note.snippet)) }} /> : null}
            </Link>
          </li>
        ))}
        {notes.length === 0 ? (
          <li className="px-4 py-4 text-sm text-muted">{q ? "No notes match." : "No notes yet. The usage.insights job writes a daily read each night and a weekly strategy note on Mondays."}</li>
        ) : null}
      </ul>
      )}
    </div>
  );
}

/** ts_headline marks matches with «»; escape everything else. */
function escapeSnippet(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/«/g, "<mark>")
    .replace(/»/g, "</mark>");
}
