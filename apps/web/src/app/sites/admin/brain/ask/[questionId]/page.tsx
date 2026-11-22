import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { STALE_ASK_MS } from "@/features/brain/ask";
import { BrainAutoRefresh } from "@/features/brain/auto-refresh";
import { renderAnswer } from "@/features/brain/markdown";
import { hideMainQuestion, retryMainQuestion, toggleSavedMainQuestion } from "@/features/main-brain/actions";
import { mainBrain } from "@/features/main-brain/db";
import { MAIN_LIST_SELECT, provenanceNames } from "@/features/main-brain/notes";
import { provenanceOf } from "@/features/main-brain/parts";
import { brainStaff } from "@/features/main-brain/staff";
import { citationTargets, parseStoredAnswer } from "../../../../../../../../../modules/knowledge/ask";

export default async function MainQuestionPage({ params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  const staff = await brainStaff();
  if (!staff) return <Denied />;
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) notFound();
  const row = await mainBrain((tx) => tx.mainBrainQuestion.findFirst({ where: { id: questionId, askedById: staff.userId, hiddenAt: null } }));
  if (!row) notFound();
  const answer = parseStoredAnswer(row.answer);
  const stale = (row.status === "QUEUED" || row.status === "RUNNING") && Date.now() - row.updatedAt.getTime() > STALE_ASK_MS;
  const working = (row.status === "QUEUED" || row.status === "RUNNING") && !stale;
  const ids = answer ? [...new Set([...answer.consideredIds, ...answer.citations.map((c) => c.noteId)])] : [];
  const [visible, names] = await Promise.all([
    ids.length ? mainBrain((tx) => tx.mainBrainNote.findMany({ where: { deletedAt: null, id: { in: ids } }, select: MAIN_LIST_SELECT })) : Promise.resolve([]),
    provenanceNames(),
  ]);
  const byId = new Map(visible.map((note) => [note.id, note]));
  const targets = answer ? citationTargets(answer) : new Map<number, string>();
  const html = answer?.answer
    ? renderAnswer(answer.answer, (n) => {
        const id = targets.get(n);
        return id && byId.has(id) ? `/brain/${id}` : null;
      })
    : "";
  const list = answer ? (answer.citations.length ? answer.citations.map((c) => c.noteId) : answer.consideredIds) : [];

  return (
    <div className="max-w-3xl">
      <Link href="/brain/ask?history=1" className="text-sm text-muted hover:text-ink">
        ← Ask the main Brain
      </Link>
      <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{row.question}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>Asked {row.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
        <form action={toggleSavedMainQuestion}>
          <input type="hidden" name="questionId" value={row.id} />
          <button type="submit" className="min-h-9 font-semibold text-accent">
            {row.savedAt ? "★ Starred" : "☆ Star"}
          </button>
        </form>
        <form action={hideMainQuestion}>
          <input type="hidden" name="questionId" value={row.id} />
          <button type="submit" className="min-h-9 hover:text-ink">
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
          <form action={retryMainQuestion} className="mt-3">
            <input type="hidden" name="questionId" value={row.id} />
            <Button type="submit" variant="secondary">
              Try again
            </Button>
          </form>
        </div>
      ) : null}
      {row.status === "DONE" && answer ? (
        <section className="mt-4 rounded-xl border border-line bg-white p-5">
          {!answer.answered ? <p className="mb-3 text-sm font-semibold text-[#b54708]">The main-Brain notes do not fully answer this.</p> : null}
          <div className="brain-prose" dangerouslySetInnerHTML={{ __html: html }} />
          {row.model ? <p className="mt-4 text-xs text-muted">Written by AI from main-Brain notes ({row.model}). Check the cited notes before relying on it.</p> : null}
        </section>
      ) : null}
      {list.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{answer?.citations.length ? "Sources cited" : "Notes found for this question"}</h2>
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {list.map((id) => {
              const note = byId.get(id);
              const citation = answer?.citations.find((c) => c.noteId === id);
              const p = note ? provenanceOf(note, names) : null;
              return (
                <li key={id} className="px-4 py-3">
                  {note ? (
                    <Link href={`/brain/${note.id}`} className="break-words text-sm font-semibold text-accent hover:underline">
                      [{(answer?.consideredIds.indexOf(id) ?? 0) + 1}] {note.title}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted">{citation?.title ?? "A note"} (deleted since)</span>
                  )}
                  {p ? <p className="text-xs text-muted">{[p.where, p.how].filter(Boolean).join(" · ")}</p> : null}
                  {citation?.why ? <p className="mt-1 text-sm text-muted">{citation.why}</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
