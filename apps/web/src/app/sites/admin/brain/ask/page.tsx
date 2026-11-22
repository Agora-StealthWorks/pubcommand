import { aiConfigured } from "@pubcommand/ai";
import { Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { askMainBrain, toggleSavedMainQuestion } from "@/features/main-brain/actions";
import { mainBrain } from "@/features/main-brain/db";
import { brainStaff } from "@/features/main-brain/staff";

const STATUS: Record<string, string> = { QUEUED: "Waiting", RUNNING: "Thinking", DONE: "Answered", FAILED: "Not answered", DRY_RUN: "" };

export default async function MainAskPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; q?: string; saved?: string; history?: string }> }) {
  const query = await searchParams;
  // Asking is a conversation now (BrainChat). This page stays for earlier one-off questions.
  if (query.history !== "1" && !query.q && !query.saved && !query.error && !query.notice) redirect("/brain/chat");
  const staff = await brainStaff();
  if (!staff) return <Denied />;
  const filter = (query.q ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const savedOnly = query.saved === "1";
  const history = await mainBrain((tx) =>
    tx.mainBrainQuestion.findMany({
      where: {
        askedById: staff.userId,
        hiddenAt: null,
        ...(filter ? { question: { contains: filter, mode: "insensitive" as const } } : {}),
        ...(savedOnly ? { savedAt: { not: null } } : {}),
      },
      select: { id: true, question: true, status: true, createdAt: true, savedAt: true },
      orderBy: [{ savedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
    }),
  );
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Earlier questions</h1>
      <p className="mt-1 text-sm"><Link href="/brain/chat" className="font-semibold text-accent underline">Ask in BrainChat</Link> to keep a conversation going.</p>
      <p className="mt-1 text-sm text-muted">Answers only from main-Brain notes (learned from every brand, imported and written here), with links to every note it used. Your questions are saved in your own history.</p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
        {!aiConfigured() ? (
          <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            The AI key is not set yet, so questions are saved and matched to notes but not answered. Add <code>ANTHROPIC_API_KEY</code>, then press Try again.
          </p>
        ) : null}
      </div>
      <form action={askMainBrain} className="space-y-3 rounded-xl border border-line bg-white p-5">
        <label htmlFor="main-ask" className="text-sm font-semibold">
          Your question
        </label>
        <Textarea id="main-ask" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="e.g. Which lead types work across our publishers?" />
        <Button type="submit" className="w-full sm:w-auto">
          Ask
        </Button>
      </form>
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Your questions</h2>
          <nav className="flex gap-3 text-xs font-semibold">
            <Link href="/brain/ask?history=1" className={savedOnly ? "text-muted" : "text-accent"}>
              All
            </Link>
            <Link href="/brain/ask?saved=1" className={savedOnly ? "text-accent" : "text-muted"}>
              Starred
            </Link>
          </nav>
        </div>
        <form action="/brain/ask" className="pc-form-row mb-2">
          <input type="hidden" name="history" value="1" />
          {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
          <Input name="q" defaultValue={filter} placeholder="Search your questions" aria-label="Search your questions" className="sm:flex-1" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {history.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">{filter || savedOnly ? "No questions match." : "No questions yet."}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {history.map((row) => (
              <li key={row.id} className="flex items-start gap-1 pr-2">
                <Link href={`/brain/ask/${row.id}`} className="flex min-w-0 flex-1 items-start justify-between gap-3 px-4 py-3 hover:bg-canvas">
                  <span className="min-w-0 break-words text-sm font-medium">{row.question}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {STATUS[row.status]} · {row.createdAt.toISOString().slice(0, 10)}
                  </span>
                </Link>
                <form action={toggleSavedMainQuestion} className="shrink-0">
                  <input type="hidden" name="questionId" value={row.id} />
                  <input type="hidden" name="back" value="list" />
                  <button type="submit" className={`min-h-11 min-w-11 text-lg ${row.savedAt ? "text-[#f79009]" : "text-muted"}`} aria-label={row.savedAt ? "Unstar" : "Star"}>
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
