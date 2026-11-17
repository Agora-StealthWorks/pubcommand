import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { saveBatchToProjectForm } from "@/features/charts/actions";
import { AutoRefresh } from "@/features/charts/auto-refresh";
import { ChartGrid } from "@/features/charts/chart-grid";
import { chartsAccess } from "@/features/charts/context";
import { listProjects, listRecentCharts, loadBatch } from "@/features/charts/data";
import { getOrgContext } from "@/lib/org";

export default async function ChartBatchPage({ params, searchParams }: { params: Promise<{ slug: string; batchId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, batchId } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { organizationId, brandId } = access.scope;
  const batch = await loadBatch(organizationId, brandId, batchId);
  if (!batch) notFound();
  const [charts, projects] = await Promise.all([listRecentCharts(organizationId, brandId, { batchId }, 100), listProjects(organizationId, brandId)]);
  const running = batch.status === "QUEUED" || batch.status === "RUNNING";
  return (
    <div className="space-y-4">
      <Link href="/charts/bulk" className="text-sm font-semibold text-accent">
        ← Bulk
      </Link>
      <Flash error={query.error} />
      <section className="rounded-xl border border-line bg-white p-4">
        <p className="text-sm">
          <span className="font-semibold">{batch.status}</span> · {batch.done} of {batch.total} made{batch.failed ? ` · ${batch.failed} failed` : ""}
          {running ? (
            <span className="ml-2 text-muted">
              Building… <AutoRefresh />
            </span>
          ) : null}
        </p>
        {batch.stale ? <p className="mt-1 text-sm text-[#912018]">The run was interrupted (the server restarted). Start it again from Bulk.</p> : null}
        {batch.errorsList.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-[#912018]">
            {batch.errorsList.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        {charts.length && !running ? (
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">ZIP:</span>
              {(["png", "jpg", "svg", "pdf"] as const).map((format) => (
                <a key={format} href={`/charts/bulk/${batch.id}/zip?format=${format}`} className="inline-flex min-h-9 items-center rounded-md border border-line px-3 font-semibold">
                  {format.toUpperCase()}
                </a>
              ))}
            </div>
            <form action={saveBatchToProjectForm} className="flex flex-col gap-2 sm:flex-row lg:ml-auto">
              <input type="hidden" name="batchId" value={batch.id} />
              <select name="projectId" className="pc-control" aria-label="Project">
                <option value="">Existing project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Input name="newProject" maxLength={120} placeholder="or a new project name" aria-label="New project name" />
              <Button type="submit" variant="secondary" className="shrink-0">
                Save to project
              </Button>
            </form>
          </div>
        ) : null}
      </section>
      <ChartGrid charts={charts} back={`/charts/bulk/${batch.id}`} />
    </div>
  );
}
