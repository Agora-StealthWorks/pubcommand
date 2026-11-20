import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { NoSite, SiteBar, formatDate } from "@/features/websites/admin-ui";
import { orgTimezone, sitePublications } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

export default async function SignupsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; pub?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.members");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const db = tenantDb(ctx.resolved.id);
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const counts = await Promise.all(
    pubs.free.map(async (pub) => ({
      pub,
      total: await db.webSignup.count({ where: { siteId: site.id, publicationId: pub.id, status: "subscribed" } }),
      week: await db.webSignup.count({ where: { siteId: site.id, publicationId: pub.id, status: "subscribed", createdAt: { gte: since } } }),
    })),
  );
  const pubFilter = pubs.free.find((pub) => pub.id === query.pub)?.id;
  const [recent, timeZone] = await Promise.all([
    db.webSignup.findMany({ where: { siteId: site.id, ...(pubFilter ? { publicationId: pubFilter } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
    orgTimezone(ctx.resolved.id),
  ]);
  const name = new Map(pubs.all.map((pub) => [pub.id, pub.name]));
  return (
    <div>
      <PageHeader title="Free sign-ups" description="Website visitors who signed up for a free newsletter. These are email subscriptions, not accounts: only members sign in." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/signups" />
      <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
        The website collects sign-ups; it does not send the newsletters. Export them (CSV) into your email service until a sending connection is added.
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {counts.map(({ pub, total, week }) => (
          <a key={pub.id} href={`/websites/signups?pub=${pub.id}`} className={`rounded-xl border bg-white p-4 ${pubFilter === pub.id ? "border-accent" : "border-line"}`}>
            <p className="font-semibold">{pub.name}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{total}</p>
            <p className="text-xs text-muted">+{week} in the last 7 days</p>
          </a>
        ))}
        {counts.length === 0 ? <p className="text-sm text-muted">No free newsletters in Publication Setup yet (type &quot;Free newsletter&quot; or tier &quot;Free / lead gen&quot;).</p> : null}
      </div>
      <div className="rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Latest{pubFilter ? ` · ${name.get(pubFilter)}` : ""}</h2>
          <a href={`/websites/signups/export${pubFilter ? `?pub=${pubFilter}` : ""}`} className="text-sm font-semibold text-accent">
            Export CSV
          </a>
        </div>
        <TableScroll>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line bg-canvas text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Newsletter</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{row.email}</td>
                  <td className="px-4 py-2.5">{name.get(row.publicationId) ?? "—"}</td>
                  <td className="px-4 py-2.5">{row.status}</td>
                  <td className="px-4 py-2.5 text-muted">{formatDate(row.createdAt, timeZone, true)}</td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No sign-ups yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  );
}
