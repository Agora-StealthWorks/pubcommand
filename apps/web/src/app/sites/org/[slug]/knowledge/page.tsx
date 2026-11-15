import { can } from "@pubcommand/core";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import {
  KNOWLEDGE_READ,
  KNOWLEDGE_WRITE,
  createKnowledgePage,
  loadKnowledge,
} from "../../../../../../../../modules/knowledge/index";

async function saveKnowledgePage(formData: FormData) {
  "use server";
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/knowledge?error=Choose an organization.");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/knowledge?error=You do not have access to that organization.");
  const allowed =
    ctx.subject.entitledModuleIds.includes("knowledge") && can(ctx.subject, KNOWLEDGE_WRITE, ctx.scope);
  if (!allowed) redirect("/knowledge?error=You do not have permission.");
  const result = createKnowledgePage({
    organizationId: ctx.resolved.id,
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    actorId: ctx.effectiveUserId,
  });
  if (!result.ok) redirect(`/knowledge?error=${encodeURIComponent(result.error)}`);
  redirect(`/knowledge?notice=Page saved.&page=${encodeURIComponent(result.page.slug)}`);
}

export default async function KnowledgeRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; page?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!ctx.subject.entitledModuleIds.includes("knowledge")) {
    return (
      <div>
        <PageHeader title="Knowledge" description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it.
        </p>
      </div>
    );
  }
  if (!can(ctx.subject, KNOWLEDGE_READ, ctx.scope)) return <Denied />;

  const writable = can(ctx.subject, KNOWLEDGE_WRITE, ctx.scope);
  const view = loadKnowledge(ctx.resolved.id, { q: query.q, page: query.page });

  return (
    <div>
      <PageHeader
        title="Knowledge"
        description="Markdown pages for this organization. Search by keyword and open a citation."
      />
      <Flash error={query.error} notice={query.notice} />
      <form action="/knowledge" className="mb-6 flex max-w-xl gap-2">
        <Input name="q" defaultValue={view.query} placeholder="Search pages" aria-label="Search pages" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-6">
          {view.query ? (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Citations</h2>
              {view.citations.length === 0 ? (
                <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">No matching pages.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                  {view.citations.map((citation) => (
                    <li key={citation.pageId}>
                      <Link href={citation.href} className="block px-4 py-3 hover:bg-canvas">
                        <span className="text-sm font-semibold text-ink">{citation.title}</span>
                        <span className="mt-1 block text-sm text-muted">{citation.excerpt}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Pages</h2>
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {view.pages.map((page) => {
                const active = view.selected?.id === page.id;
                return (
                  <li key={page.id}>
                    <Link
                      href={`/knowledge?page=${page.slug}`}
                      className={`block px-4 py-3 text-sm font-medium ${active ? "bg-[#dbe7ff] text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <div className="space-y-6">
          {view.selected ? (
            <article className="rounded-lg border border-line bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink">{view.selected.title}</h2>
                {view.selected.source === "example" ? <Badge tone="accent">EXAMPLE</Badge> : null}
              </div>
              <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-6 text-ink">{view.selected.body}</pre>
            </article>
          ) : null}
          {writable ? (
            <form action={saveKnowledgePage} className="space-y-3 rounded-lg border border-line bg-white p-5">
              <h2 className="text-sm font-semibold text-ink">New page</h2>
              <Label htmlFor="knowledge-title">Title</Label>
              <Input id="knowledge-title" name="title" required maxLength={140} />
              <Label htmlFor="knowledge-body">Markdown</Label>
              <Textarea id="knowledge-body" name="body" required maxLength={20000} />
              <Button type="submit">Save page</Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
