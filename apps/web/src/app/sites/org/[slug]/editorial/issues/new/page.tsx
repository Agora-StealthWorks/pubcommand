import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createIssueAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { listPublications } from "@/features/calendar/data";
import { IssueForm } from "@/features/calendar/issue-form";
import { isDay } from "../../../../../../../../../../modules/editorial/dates";

export default async function NewIssuePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string; pub?: string; error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  if (!ctx.canWrite) return <Denied title="You can view the calendar but not add issues" />;
  const publications = await listPublications(ctx.resolved.id, ctx.brand.id);
  return (
    <div className="max-w-4xl">
      <h2 className="mb-3 text-xl font-semibold">New issue</h2>
      <Flash error={query.error} />
      <IssueForm action={createIssueAction} publications={publications} defaults={{ mailDate: isDay(query.date) ? query.date : undefined, publicationCode: query.pub }} />
    </div>
  );
}
