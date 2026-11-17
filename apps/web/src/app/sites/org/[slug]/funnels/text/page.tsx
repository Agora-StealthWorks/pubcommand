import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { listSites, statusBadge } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { createSite } from "@/features/funnels/text-actions";

export default async function TextSitesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite } = access;
  const sites = await listSites(ctx.resolved.id, ctx.brand.id);
  return (
    <div>
      <PageHeader title="Text-letter sites" description={`A public site per text newsletter for ${ctx.brand.name}: a subscribe page with SMS consent, the latest post and an archive.`} />
      <Flash error={query.error} notice={query.notice} />
      <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
        No text messages are sent from PubCommand yet: there is no SMS provider connected. Sites collect opt-ins (with the exact consent text) for you to export.
      </p>
      <div className="space-y-4">
        {canWrite ? (
          <details className="rounded-xl border border-line bg-white" open={sites.length === 0}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-accent">+ New text-letter site</summary>
            <form action={createSite} className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Label htmlFor="site-name">Name</Label>
                <Input id="site-name" name="name" required maxLength={120} placeholder="e.g. Morning text alerts" />
              </div>
              <Button type="submit">Create site</Button>
            </form>
          </details>
        ) : null}
        <div className="rounded-xl border border-line bg-white">
          <TableScroll>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Site</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Posts</th>
                  <th className="px-4 py-2.5 text-right">Subscribers</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const badge = statusBadge(site.status);
                  return (
                    <tr key={site.id} className="border-b border-line last:border-0">
                      <td className="max-w-[320px] px-4 py-3">
                        <Link href={`/funnels/text/${site.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-accent">
                          {site.name}
                        </Link>
                        <span className="block truncate text-xs text-muted">/t/{site.slug}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{site.postCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{site.optinCount}</td>
                    </tr>
                  );
                })}
                {sites.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted">
                      No text-letter sites yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </div>
    </div>
  );
}
