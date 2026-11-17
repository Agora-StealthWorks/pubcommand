import { aiConfigured } from "@pubcommand/ai";
import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { promoPage } from "@/features/promos/guard";
import { deleteLesson, rebuildLessons, saveLesson, shareLesson, toggleLesson } from "@/features/promos/insights-actions";
import { InsightsNav } from "@/features/promos/insights-view";
import { LESSON_CATEGORIES } from "../../../../../../../../../modules/promo-studio/lessons";

const STALE_MS = 10 * 60 * 1000;

export default async function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ show?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await promoPage(slug);
  if ("denied" in access) return access.denied === "notfound" ? notFound() : <Denied title={access.denied} />;
  const { ctx, writable } = access;
  const db = tenantDb(ctx.resolved.id);
  const showHidden = query.show === "hidden";
  const [lessons, run, hiddenCount, analyzed, promos] = await Promise.all([
    db.promoLesson.findMany({ where: { brandId: ctx.brand.id, hidden: showHidden }, orderBy: [{ pinned: "desc" }, { evidenceCount: "desc" }, { createdAt: "asc" }] }),
    db.promoLessonRun.findFirst({ where: { brandId: ctx.brand.id }, orderBy: { createdAt: "desc" } }),
    db.promoLesson.count({ where: { brandId: ctx.brand.id, hidden: true } }),
    db.promo.count({ where: { brandId: ctx.brand.id, deletedAt: null, effectivenessScore: { not: null } } }),
    db.promo.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, select: { id: true, title: true } }),
  ]);
  const titles = new Map(promos.map((p) => [p.id, p.title]));
  const busy = run && (run.status === "QUEUED" || run.status === "RUNNING") && Date.now() - run.updatedAt.getTime() < STALE_MS;

  return (
    <div className="space-y-5">
      <InsightsNav active="lessons" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Lessons learned</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            What {ctx.brand.name}&apos;s promos teach, grouped into themes from {analyzed} analyzed promo{analyzed === 1 ? "" : "s"} and their real
            results. Counts are the promos behind each theme. Pin what matters, hide noise, and share generic best practices with the main Brain.
          </p>
        </div>
        {writable ? (
          <form action={rebuildLessons}>
            <Button type="submit" disabled={Boolean(busy)}>{lessons.length ? "Rebuild themes" : "Build themes"}</Button>
          </form>
        ) : null}
      </header>
      <Flash error={query.error} notice={query.notice} />
      {!aiConfigured() ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          The AI key is not set, so themes cannot be built yet. You can still add, edit, pin and share lessons by hand.
        </p>
      ) : null}
      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          Grouping {run!.inputCount || "the"} lessons into themes… <AutoRefresh />
        </div>
      ) : null}
      {run?.status === "FAILED" && run.error ? (
        <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Last rebuild did not finish: {run.error}</p>
      ) : null}
      {run?.status === "DONE" ? (
        <p className="text-xs text-muted">Last built {run.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC from {run.inputCount} lesson items into {run.themeCount} themes.</p>
      ) : null}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/promo-studio/lessons" className={showHidden ? "text-accent hover:underline" : "font-semibold"}>Visible</Link>
        <Link href="/promo-studio/lessons?show=hidden" className={showHidden ? "font-semibold" : "text-accent hover:underline"}>Hidden ({hiddenCount})</Link>
      </div>

      <ul className="space-y-3">
        {lessons.map((lesson) => (
          <li key={lesson.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="pc-break font-semibold">{lesson.title}</h2>
                <p className="pc-break mt-1 text-sm">{lesson.body}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]" title="Promos behind this lesson">
                {lesson.evidenceCount} promo{lesson.evidenceCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              {lesson.pinned ? <Badge tone="accent">pinned</Badge> : null}
              <Badge>{lesson.category}</Badge>
              {lesson.fromResults ? <Badge tone="ok">backed by results</Badge> : null}
              {lesson.origin === "manual" ? <Badge>added by hand</Badge> : lesson.edited ? <Badge>edited</Badge> : null}
              {lesson.sharedAt ? <Badge tone="accent">shared with main Brain</Badge> : lesson.suggestedShared ? <Badge tone="accent">looks generic</Badge> : null}
            </div>
            {lesson.promoIds.length ? (
              <p className="pc-break mt-2 text-xs text-muted">
                Examples:{" "}
                {lesson.promoIds.slice(0, 5).map((id, i) => (
                  <span key={id}>
                    {i ? " · " : ""}
                    {titles.has(id) ? <Link href={`/promo-studio/${id}`} className="text-accent hover:underline">{titles.get(id)}</Link> : "deleted promo"}
                  </span>
                ))}
                {lesson.promoIds.length > 5 ? ` and ${lesson.promoIds.length - 5} more` : ""}
              </p>
            ) : null}
            {writable ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
                <form action={toggleLesson}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <input type="hidden" name="flag" value="pinned" />
                  <input type="hidden" name="back" value={showHidden ? "hidden" : ""} />
                  <button className="min-h-9 font-semibold text-accent hover:underline">{lesson.pinned ? "Unpin" : "Pin"}</button>
                </form>
                <form action={toggleLesson}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <input type="hidden" name="flag" value="hidden" />
                  <input type="hidden" name="back" value={showHidden ? "hidden" : ""} />
                  <button className="min-h-9 font-semibold text-accent hover:underline">{lesson.hidden ? "Show" : "Hide"}</button>
                </form>
                <details className="w-full">
                  <summary className="cursor-pointer font-semibold text-accent">Edit</summary>
                  <form action={saveLesson} className="mt-2 space-y-2">
                    <input type="hidden" name="lessonId" value={lesson.id} />
                    <Input name="title" defaultValue={lesson.title} maxLength={120} aria-label="Title" />
                    <Textarea name="body" defaultValue={lesson.body} rows={3} maxLength={1200} aria-label="Lesson" />
                    <select name="category" defaultValue={lesson.category} className="pc-control" aria-label="Category">
                      {LESSON_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm">Save</Button>
                    </div>
                  </form>
                  <form action={deleteLesson} className="mt-2">
                    <input type="hidden" name="lessonId" value={lesson.id} />
                    <button className="text-[#b42318] hover:underline">Delete lesson</button>
                  </form>
                </details>
                {!lesson.sharedAt ? (
                  <details className="w-full">
                    <summary className="cursor-pointer font-semibold text-accent">Share with the main Brain</summary>
                    <form action={shareLesson} className="mt-2 space-y-2 rounded-md bg-canvas p-3">
                      <input type="hidden" name="lessonId" value={lesson.id} />
                      <p className="text-xs text-muted">Shared notes are visible to every brand. Only share a general copywriting best practice: no brand, product, person, result or private detail.</p>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="confirmGeneric" className="mt-0.5 h-4 w-4" required />
                        This is a generic best practice and safe for every brand to see.
                      </label>
                      <Button type="submit" size="sm" variant="secondary">Share as best practice</Button>
                    </form>
                  </details>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
        {lessons.length === 0 ? (
          <li className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
            {showHidden ? "No hidden lessons." : analyzed ? "No themes yet. Build them from your analyses, or add one by hand." : "Analyze some promos first; each analysis adds lessons."}
          </li>
        ) : null}
      </ul>

      {writable && !showHidden ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-accent">+ Add a lesson by hand</summary>
          <form action={saveLesson} className="mt-3 space-y-2">
            <Input name="title" placeholder="Short title" maxLength={120} aria-label="Title" required />
            <Textarea name="body" placeholder="The lesson, in a sentence or two" rows={3} maxLength={1200} aria-label="Lesson" required />
            <select name="category" defaultValue="other" className="pc-control" aria-label="Category">
              {LESSON_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <div><Button type="submit" size="sm">Add lesson</Button></div>
          </form>
        </details>
      ) : null}
    </div>
  );
}
