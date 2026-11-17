import { aiConfigured } from "@pubcommand/ai";
import { Button, Textarea } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { askBrain } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";
import { scopeBrandId } from "../../../../../../../../../modules/knowledge/visibility";

const STATUS: Record<string, string> = { QUEUED: "Waiting", RUNNING: "Thinking", DONE: "Answered", FAILED: "Not answered", DRY_RUN: "" };

export default async function AskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scope?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug, query.scope);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const recent = await tenantDb(ctx.resolved.id).knowledgeQuestion.findMany({
    where: { brandId: scopeBrandId(ctx.brain) },
    select: { id: true, question: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Ask the Brain</h1>
      <p className="mt-1 text-sm text-muted">
        Searches the notes in <strong className="text-ink">{ctx.scopeLabel}</strong> and answers only from them, with links to every note it used.
        {ctx.brain.kind === "brand" ? " Other brands' private notes are never searched." : ""}
      </p>
      <div className="mt-4">
        <Flash error={query.error} />
        {!aiConfigured() ? (
          <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            The AI key is not set yet, so questions are saved and matched to notes but not answered. Add <code>ANTHROPIC_API_KEY</code> in Railway, then press Try again.
          </p>
        ) : null}
      </div>
      <form action={askBrain} className="space-y-3 rounded-xl border border-line bg-white p-5">
        {ctx.brain.kind === "main" ? <input type="hidden" name="scope" value="main" /> : null}
        <label htmlFor="ask-question" className="text-sm font-semibold">
          Your question
        </label>
        <Textarea id="ask-question" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="e.g. Which lead types have worked best for us, and why?" />
        <Button type="submit" className="w-full sm:w-auto">
          Ask
        </Button>
      </form>
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent questions in {ctx.scopeLabel}</h2>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">No questions yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {recent.map((row) => (
              <li key={row.id}>
                <Link href={brainHref(`/knowledge/ask/${row.id}`, ctx.brain)} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-canvas">
                  <span className="min-w-0 break-words text-sm font-medium">{row.question}</span>
                  <span className="shrink-0 text-xs text-muted">{STATUS[row.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
