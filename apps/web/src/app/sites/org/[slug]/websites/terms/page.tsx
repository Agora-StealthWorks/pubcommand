import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { saveTerm } from "@/features/websites/actions";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { siteTerms } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

export default async function TermsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.write");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const terms = await siteTerms(ctx.resolved.id, site.id);
  const used = await tenantDb(ctx.resolved.id).webPostTerm.findMany({ where: { term: { siteId: site.id } }, select: { termId: true } });
  const counts = new Map<string, number>();
  for (const row of used) counts.set(row.termId, (counts.get(row.termId) ?? 0) + 1);
  return (
    <div>
      <PageHeader title="Categories & tags" description="Categories are the site's sections (shown in menus and on /category/…). Tags are free keywords (on /tag/…)." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/terms" />
      <div className="grid gap-5 lg:grid-cols-2">
        {(["category", "tag"] as const).map((kind) => {
          const list = kind === "category" ? terms.categories : terms.tags;
          return (
            <section key={kind} className="rounded-xl border border-line bg-white">
              <h2 className="border-b border-line px-4 py-3 font-semibold">{kind === "category" ? "Categories" : "Tags"}</h2>
              <form action={saveTerm} className="grid gap-2 border-b border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="kind" value={kind} />
                <div>
                  <Label htmlFor={`${kind}-name`}>New {kind}</Label>
                  <Input id={`${kind}-name`} name="name" required maxLength={60} />
                </div>
                <div>
                  <Label htmlFor={`${kind}-slug`}>Address (optional)</Label>
                  <Input id={`${kind}-slug`} name="slug" maxLength={60} />
                </div>
                <Button type="submit">Add</Button>
              </form>
              <ul>
                {list.map((term) => (
                  <li key={term.id} className="border-b border-line px-4 py-2.5 last:border-0">
                    <form action={saveTerm} className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="hidden" name="siteId" value={site.id} />
                      <input type="hidden" name="termId" value={term.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <Input name="name" defaultValue={term.name} className="h-9 min-h-9 w-40" aria-label="Name" />
                      <Input name="slug" defaultValue={term.slug} className="h-9 min-h-9 w-36" aria-label="Address" />
                      <span className="text-xs text-muted">{counts.get(term.id) ?? 0} posts</span>
                      <button className="ml-auto font-semibold text-accent">Save</button>
                      <button name="delete" value="1" className="font-semibold text-[#b42318]">
                        Delete
                      </button>
                    </form>
                  </li>
                ))}
                {list.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">None yet.</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
