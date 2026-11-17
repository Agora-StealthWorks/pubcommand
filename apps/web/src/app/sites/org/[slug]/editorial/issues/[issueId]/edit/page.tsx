import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { updateIssueAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { listPublications, loadIssue } from "@/features/calendar/data";
import { IssueForm } from "@/features/calendar/issue-form";

export default async function EditIssuePage({ params, searchParams }: { params: Promise<{ slug: string; issueId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, issueId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  if (!ctx.canWrite) return <Denied title="You can view the calendar but not edit issues" />;
  const [loaded, publications] = await Promise.all([loadIssue(ctx.resolved.id, ctx.brand.id, issueId), listPublications(ctx.resolved.id, ctx.brand.id, true)]);
  if (!loaded) notFound();
  return (
    <div className="max-w-4xl">
      <p className="mb-2 text-sm">
        <Link href={`/editorial/issues/${loaded.issue.id}`} className="font-medium text-accent">
          ← Back to issue
        </Link>
      </p>
      <h2 className="mb-3 break-words [overflow-wrap:anywhere] text-xl font-semibold">Edit {loaded.issue.title}</h2>
      <Flash error={query.error} />
      <IssueForm action={updateIssueAction} publications={publications} loaded={loaded} />
    </div>
  );
}
