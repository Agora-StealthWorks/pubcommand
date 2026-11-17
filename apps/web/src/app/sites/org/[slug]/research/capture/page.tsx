import { notFound } from "next/navigation";
import { Flash, PageHeader } from "@/components/ui";
import { addCapturedSource } from "@/features/research/actions";
import { CaptureForm } from "@/features/research/capture-form";
import { canEdit, projectFor, researchContext } from "@/features/research/context";
import { listProjects } from "@/features/research/data";

/** Where the bookmarklet sends the page someone is reading. */
export default async function CapturePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await researchContext(slug);
  if (!context.ok) notFound();
  const { viewer } = context;
  const listed = await listProjects(viewer);
  const editable: { id: string; name: string }[] = [];
  for (const project of listed.slice(0, 100)) {
    const found = await projectFor(viewer, project.id);
    if (found && canEdit(found.access)) editable.push({ id: project.id, name: project.name });
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Capture a page" description="The page you sent with the bookmarklet. Pick a project and the AI turns it into index cards." />
      <Flash error={query.error} />
      <CaptureForm projects={editable} canCreate={viewer.canWrite} action={addCapturedSource} />
    </div>
  );
}
