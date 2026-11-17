import { tenantDb } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteProjectForm, renameProjectForm } from "@/features/charts/actions";
import { ChartGrid } from "@/features/charts/chart-grid";
import { chartsAccess } from "@/features/charts/context";
import { listRecentCharts } from "@/features/charts/data";
import { getOrgContext } from "@/lib/org";

export default async function ChartProjectPage({ params, searchParams }: { params: Promise<{ slug: string; projectId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, projectId } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  const { organizationId, brandId } = access.scope;
  const project = await tenantDb(organizationId).chartProject.findFirst({ where: { id: projectId, brandId, deletedAt: null } });
  if (!project) notFound();
  const charts = await listRecentCharts(organizationId, brandId, { projectId }, 200);
  const canDelete = project.createdById === access.scope.actorId || access.canManage;
  return (
    <div className="space-y-4">
      <Link href="/charts/projects" className="text-sm font-semibold text-accent">
        ← All projects
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <form action={renameProjectForm} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="projectId" value={project.id} />
          <Input name="name" defaultValue={project.name} required maxLength={120} aria-label="Project name" className="font-semibold" />
          <Input name="description" defaultValue={project.description} maxLength={500} aria-label="Description" placeholder="Description" />
          <Button type="submit" variant="secondary" className="shrink-0">
            Save
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Download all as ZIP:</span>
          {(["png", "jpg", "svg", "pdf"] as const).map((format) => (
            <a key={format} href={`/charts/projects/${project.id}/zip?format=${format}`} className="inline-flex min-h-9 items-center rounded-md border border-line px-3 font-semibold">
              {format.toUpperCase()}
            </a>
          ))}
          <Link href="/charts" className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 font-semibold text-white">
            + New chart
          </Link>
          {canDelete ? (
            <form action={deleteProjectForm} className="ml-auto">
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" variant="danger" size="sm">
                Delete project
              </Button>
            </form>
          ) : null}
        </div>
      </section>
      <ChartGrid charts={charts} back={`/charts/projects/${project.id}`} />
    </div>
  );
}
