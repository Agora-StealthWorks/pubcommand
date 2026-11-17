import { aiConfigured } from "@pubcommand/ai";
import { Button, Input, Textarea } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { askBrain, toggleSavedQuestion } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";

const STATUS: Record<string, string> = { QUEUED: "Waiting", RUNNING: "Thinking", DONE: "Answered", FAILED: "Not answered", DRY_RUN: "" };

export default async function AskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string; q?: string; saved?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const filter = (query.q ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const savedOnly = query.saved === "1";
  // Each person's own questions in this brand's Brain: a saved history, newest first, starred on top.
  const recent = await tenantDb(ctx.resolved.id).knowledgeQuestion.findMany({
    where: {
      brandId: ctx.brain.brandId,
      createdById: ctx.auth.user.id,
      hiddenAt: null,
      ...(filter ? { question: { contains: filter, mode: "insensitive" as const } } : {}),
      ...(savedOnly ? { savedAt: { not: null } } : {}),
    },
    select: { id: true, question: true, status: true, createdAt: true, savedAt: true },
    orderBy: [{ savedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Ask the Brain</h1>
      <p className="mt-1 text-sm text-muted">
        Searches the notes in <strong className="text-ink">{ctx.scopeLabel}</strong> and answers only from them, with links to every note it used. Your questions are saved in your own history below.
      </p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
        {!aiConfigured() ? (
          <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            The AI key is not set yet, so questions are saved and matched to notes but not answered. Add <code>ANTHROPIC_API_KEY</code> in Railway, then press Try again.
          </p>
        ) : null}
      </div>
      <form action={askBrain} className="space-y-3 rounded-xl border border-line bg-white p-5">
        <label htmlFor="ask-question" className="text-sm font-semibold">
          Your question
        </label>
        <Textarea id="ask-question" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="e.g. Which lead types have worked best for us, and why?" />
        <Button type="submit" className="w-full sm:w-auto">
          Ask
        </Button>
      </form>
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Your questions</h2>
          <nav className="flex gap-3 text-xs font-semibold">
            <Link href={brainHref("/knowledge/ask")} className={savedOnly ? "text-muted" : "text-accent"}>
              All
            </Link>
            <Link href={brainHref("/knowledge/ask", { saved: "1" })} className={savedOnly ? "text-accent" : "text-muted"}>
              Starred
            </Link>
          </nav>
        </div>
        <form action="/knowledge/ask" className="pc-form-row mb-2">
          {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
          <Input name="q" defaultValue={filter} placeholder="Search your questions" aria-label="Search your questions" className="sm:flex-1" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">{filter || savedOnly ? "No questions match." : "No questions yet."}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {recent.map((row) => (
              <li key={row.id} className="flex items-start gap-1 pr-2">
                <Link href={brainHref(`/knowledge/ask/${row.id}`)} className="flex min-w-0 flex-1 items-start justify-between gap-3 px-4 py-3 hover:bg-canvas">
                  <span className="min-w-0 break-words text-sm font-medium">{row.question}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {STATUS[row.status]} · {row.createdAt.toISOString().slice(0, 10)}
                  </span>
                </Link>
                <form action={toggleSavedQuestion} className="shrink-0">
                  <input type="hidden" name="questionId" value={row.id} />
                  <input type="hidden" name="back" value="list" />
                  <button type="submit" className={`min-h-11 min-w-11 text-lg ${row.savedAt ? "text-[#f79009]" : "text-muted"}`} aria-label={row.savedAt ? "Unstar" : "Star"} title={row.savedAt ? "Unstar" : "Star"}>
                    {row.savedAt ? "★" : "☆"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
