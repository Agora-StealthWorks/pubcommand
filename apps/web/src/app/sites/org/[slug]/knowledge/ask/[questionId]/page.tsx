import { Button } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { hideQuestion, retryQuestion, toggleSavedQuestion } from "@/features/brain/actions";
import { STALE_ASK_MS } from "@/features/brain/ask";
import { BrainAutoRefresh } from "@/features/brain/auto-refresh";
import { brainHref, loadBrain } from "@/features/brain/context";
import { renderAnswer } from "@/features/brain/markdown";
import { NOTE_LIST_SELECT } from "@/features/brain/notes";
import { NoteBadges } from "@/features/brain/parts";
import { citationTargets, parseStoredAnswer } from "../../../../../../../../../../modules/knowledge/ask";
import { scopeWhere } from "../../../../../../../../../../modules/knowledge/visibility";

export default async function QuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; questionId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug, questionId } = await params;
  await searchParams;
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const scope = ctx.brain;
  const db = tenantDb(ctx.resolved.id);
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) notFound();
  // A question belongs to one brand's Brain and to the person who asked it.
  const row = await db.knowledgeQuestion.findFirst({ where: { id: questionId, brandId: scope.brandId, createdById: ctx.auth.user.id, hiddenAt: null } });
  if (!row) notFound();
  const answer = parseStoredAnswer(row.answer);
  const stale = (row.status === "QUEUED" || row.status === "RUNNING") && Date.now() - row.updatedAt.getTime() > STALE_ASK_MS;
  const working = (row.status === "QUEUED" || row.status === "RUNNING") && !stale;
  // Re-check every cited note against the current visibility (a note may have been unshared or deleted since).
  const ids = answer ? [...new Set([...answer.consideredIds, ...answer.citations.map((c) => c.noteId)])] : [];
  const visible = ids.length
    ? await db.knowledgePage.findMany({ where: { AND: [scopeWhere(scope), { id: { in: ids } }] }, select: NOTE_LIST_SELECT })
    : [];
  const visibleById = new Map(visible.map((note) => [note.id, note]));
  const targets = answer ? citationTargets(answer) : new Map<number, string>();
  const html = answer?.answer
    ? renderAnswer(answer.answer, (n) => {
        const id = targets.get(n);
        return id && visibleById.has(id) ? brainHref(`/knowledge/${id}`) : null;
      })
    : "";

  return (
    <div className="max-w-3xl">
      <Link href={brainHref("/knowledge/ask")} className="text-sm text-muted hover:text-ink">
        ← Ask the Brain
      </Link>
      <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{row.question}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          Asked {row.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {ctx.scopeLabel}
        </span>
        <form action={toggleSavedQuestion}>
          <input type="hidden" name="questionId" value={row.id} />
          <button type="submit" className="min-h-9 font-semibold text-accent">
            {row.savedAt ? "★ Starred" : "☆ Star"}
          </button>
        </form>
        <form action={hideQuestion}>
          <input type="hidden" name="questionId" value={row.id} />
          <button type="submit" className="min-h-9 text-muted hover:text-ink">
            Remove from history
          </button>
        </form>
      </div>

      {working ? (
        <p className="mt-4 rounded-xl border border-line bg-white px-4 py-5 text-sm text-muted">
          Reading the notes and writing an answer… <BrainAutoRefresh />
        </p>
      ) : null}

      {row.status === "FAILED" || stale ? (
        <div className="mt-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-4 text-sm text-[#93370d]">
          <p className="font-semibold">No answer yet</p>
          <p className="mt-1">{stale ? "The answer was interrupted (the server restarted). Try again." : row.error}</p>
          <form action={retryQuestion} className="mt-3">
            <input type="hidden" name="questionId" value={row.id} />
            <Button type="submit" variant="secondary">
              Try again
            </Button>
          </form>
        </div>
      ) : null}

      {row.status === "DONE" && answer ? (
        <section className="mt-4 rounded-xl border border-line bg-white p-5">
          {!answer.answered ? <p className="mb-3 text-sm font-semibold text-[#b54708]">The notes in this Brain do not fully answer this.</p> : null}
          <div className="brain-prose" dangerouslySetInnerHTML={{ __html: html }} />
          {row.model ? <p className="mt-4 text-xs text-muted">Written by AI from your notes ({row.model}). Check the cited notes before relying on it.</p> : null}
        </section>
      ) : null}

      {answer && answer.citations.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Sources cited</h2>
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {answer.citations.map((citation) => {
              const n = answer.consideredIds.indexOf(citation.noteId) + 1;
              const note = visibleById.get(citation.noteId);
              return (
                <li key={citation.noteId} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-muted">[{n}]</span>
                    {note ? (
                      <Link href={brainHref(`/knowledge/${note.id}`)} className="break-words text-sm font-semibold text-accent hover:underline">
                        {note.title}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted">{citation.title} (no longer in this Brain)</span>
                    )}
                    {note ? <NoteBadges note={note} scope={scope} brandNames={ctx.brandNames} /> : null}
                  </div>
                  {citation.why ? <p className="mt-1 text-sm text-muted">{citation.why}</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {answer && answer.citations.length === 0 && visible.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Notes found for this question</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {answer.consideredIds.flatMap((id) => {
              const note = visibleById.get(id);
              return note
                ? [
                    <li key={id}>
                      <Link href={brainHref(`/knowledge/${id}`)} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-canvas">
                        <span className="break-words">{note.title}</span>
                        <NoteBadges note={note} scope={scope} brandNames={ctx.brandNames} />
                      </Link>
                    </li>,
                  ]
                : [];
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
