import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { tenantDb } from "@pubcommand/db";
import { listSites, loadMediums, statusBadge } from "@/features/miniblog/data";
import { miniblogAccess } from "@/features/miniblog/guard";
import { createSite, restoreSite } from "@/features/miniblog/actions";

export default async function MiniBlogsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await miniblogAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canManage } = access;
  const db = tenantDb(ctx.resolved.id);
  const editorial = ctx.subject.entitledModuleIds.includes("editorial");
  const [sites, mediums, publications, deleted] = await Promise.all([
    listSites(ctx.resolved.id, ctx.brand.id),
    loadMediums(ctx.resolved.id),
    editorial ? db.calendarPublication.findMany({ where: { brandId: ctx.brand.id, active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }) : [],
    canManage ? db.textSite.findMany({ where: { brandId: ctx.brand.id, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, take: 50, select: { id: true, name: true, medium: true, deletedAt: true } }) : [],
  ]);
  return (
    <div>
      <PageHeader
        title="Mini-Blogs"
        description={`Small public blogs (T-Letters) for ${ctx.brand.name}: the latest post, an archive, and a subscribe page for its medium (Email, SMS, Push Notification…).`}
        actions={
          canManage ? (
            <Link href="/mini-blog/settings" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
              App settings
            </Link>
          ) : null
        }
      />
      <Flash error={query.error} notice={query.notice} />
      <div className="space-y-4">
        {canWrite ? (
          <details className="rounded-xl border border-line bg-white" open={sites.length === 0}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-accent">+ New Mini-Blog</summary>
            <form action={createSite} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
              <div className="min-w-0">
                <Label htmlFor="site-name">Name</Label>
                <Input id="site-name" name="name" required maxLength={120} placeholder="e.g. Morning briefing" />
              </div>
              <div className="min-w-0">
                <Label htmlFor="site-medium">Medium</Label>
                <select id="site-medium" name="medium" defaultValue={mediums.includes("SMS") ? "SMS" : mediums[0]} className="pc-control mt-1 w-full text-sm" required>
                  {mediums.map((medium) => (
                    <option key={medium} value={medium}>
                      {medium}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="site-calendar">Calendar publication</Label>
                <select id="site-calendar" name="calendarCode" defaultValue={publications[0]?.code ?? ""} className="pc-control mt-1 w-full text-sm">
                  <option value="">Don't add posts to the calendar</option>
                  {publications.map((publication) => (
                    <option key={publication.code} value={publication.code}>
                      {publication.code} · {publication.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Create Mini-Blog</Button>
              <p className="text-xs text-muted sm:col-span-4">The medium is the issue type of its posts on the Calendar. Only Email Mini-Blogs get a sign-up form (email address); SMS and other mediums have none. Each new post goes on the Calendar on its publish date.</p>
            </form>
          </details>
        ) : null}
        <div className="rounded-xl border border-line bg-white">
          <TableScroll>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Mini-Blog</th>
                  <th className="px-4 py-2.5">Medium</th>
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
                        <Link href={`/mini-blog/${site.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-accent">
                          {site.name}
                        </Link>
                        <span className="block truncate text-xs text-muted">/b/{site.slug}</span>
                      </td>
                      <td className="px-4 py-3 text-muted">{site.medium}</td>
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
                    <td colSpan={5} className="px-4 py-8 text-center text-muted">
                      No Mini-Blogs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableScroll>
        </div>
        {deleted.length ? (
          <details className="rounded-xl border border-line bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Recycle bin ({deleted.length})</summary>
            <ul className="divide-y divide-line border-t border-line text-sm">
              {deleted.map((site) => (
                <li key={site.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-semibold [overflow-wrap:anywhere]">{site.name}</span>
                    <span className="block text-xs text-muted">
                      {site.medium} · deleted {site.deletedAt?.toISOString().slice(0, 10)}
                    </span>
                  </span>
                  <form action={restoreSite}>
                    <input type="hidden" name="siteId" value={site.id} />
                    <Button type="submit" variant="secondary">
                      Restore
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
