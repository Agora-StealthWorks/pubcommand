import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, PageHeader } from "@/components/ui";
import { createProject } from "@/features/research/actions";
import { researchContext } from "@/features/research/context";
import { listProjects } from "@/features/research/data";

export default async function ResearchHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const context = await researchContext(slug);
  if (!context.ok) notFound();
  const { viewer } = context;
  const q = (query.q ?? "").slice(0, 100);
  const projects = await listProjects(viewer, q);

  return (
    <div>
      <PageHeader
        title="Research Extractor"
        description={`Collect research for ${viewer.brand.name}: drop in articles, PDFs, Word files and videos, get index cards with the exact facts and quotes, sort them into piles and build an outline. It organizes research; it does not write copy.`}
      />
      <Flash error={query.error} notice={query.notice} />
      {!aiConfigured() ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          The AI key is not set, so sources are saved but no cards are extracted. Add <code>ANTHROPIC_API_KEY</code>, then press Extract again on each source. You can still add cards by hand.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <form className="mb-3 flex gap-2" action="/research">
            <input name="q" defaultValue={q} placeholder="Search projects" aria-label="Search projects" className="pc-control min-w-0 flex-1 text-sm" />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          {projects.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link href={`/research/${project.id}`} className="block h-full rounded-xl border border-line bg-white p-4 hover:border-accent">
                    <p className="pc-break font-semibold">{project.name}</p>
                    {project.description ? <p className="pc-break mt-1 line-clamp-2 text-sm text-muted">{project.description}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>
                        {project._count.cards} cards · {project._count.sources} sources
                      </span>
                      <span>· {project.ownerName}</span>
                      {project._count.shares ? <Badge>Shared</Badge> : null}
                      {project.publicEnabled ? <Badge tone="warn">Public link</Badge> : null}
                      {project.shareWithBrain ? <Badge tone="accent">Brain</Badge> : null}
                    </div>
                    <p className="mt-2 text-xs text-muted">Updated {project.updatedAt.toISOString().slice(0, 10)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-line bg-white p-6 text-sm text-muted">
              {q ? "No projects match." : "No research projects yet. Start one on the right; it stays private until you share it."}
            </p>
          )}
          {viewer.isAdmin ? <p className="mt-3 text-xs text-muted">As an admin you see every project in this brand, including private ones.</p> : null}
        </section>

        <aside>
          {viewer.canWrite ? (
            <form action={createProject} className="space-y-3 rounded-xl border border-line bg-white p-4">
              <h2 className="font-semibold">New project</h2>
              <div>
                <Label htmlFor="project-name">Name</Label>
                <Input id="project-name" name="name" required maxLength={160} placeholder="What are you researching?" />
              </div>
              <div>
                <Label htmlFor="project-description">Brief (optional)</Label>
                <Textarea id="project-description" name="description" rows={3} maxLength={2000} placeholder="The angle or question. It helps the AI pick what matters." />
              </div>
              <Button type="submit" className="w-full">
                Create project
              </Button>
              <p className="text-xs text-muted">Private to you until you share it.</p>
            </form>
          ) : (
            <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">You can open projects shared with you. Ask an admin for research.write to start your own.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
