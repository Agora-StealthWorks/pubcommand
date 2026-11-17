import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createProjectForm } from "@/features/charts/actions";
import { ChartGrid } from "@/features/charts/chart-grid";
import { chartsAccess } from "@/features/charts/context";
import { listProjects, listRecentCharts } from "@/features/charts/data";
import { getOrgContext } from "@/lib/org";

export default async function ChartProjectsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { organizationId, brandId, brandName } = access.scope;
  const [projects, loose] = await Promise.all([listProjects(organizationId, brandId), listRecentCharts(organizationId, brandId, { projectId: null }, 12)]);
  return (
    <div className="space-y-6">
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">New project</h2>
        <p className="mt-1 text-sm text-muted">Projects are shared folders of saved charts for {brandName}.</p>
        <form action={createProjectForm} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input name="name" required maxLength={120} placeholder="Project name" aria-label="Project name" />
          <Input name="description" maxLength={500} placeholder="What it is for (optional)" aria-label="Description" />
          <Button type="submit" className="shrink-0">
            Create
          </Button>
        </form>
      </section>
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Projects · {projects.length}</h2>
        {projects.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href={`/charts/projects/${project.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-accent">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="mt-1 block truncate text-sm text-muted">{project.description || "No description"}</span>
                  <span className="mt-2 block text-xs text-muted">
                    {project.chartCount} chart{project.chartCount === 1 ? "" : "s"} · updated {project.updatedAt.toISOString().slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">No projects yet.</p>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent charts not in a project</h2>
        <ChartGrid charts={loose} back="/charts/projects" />
      </section>
    </div>
  );
}
