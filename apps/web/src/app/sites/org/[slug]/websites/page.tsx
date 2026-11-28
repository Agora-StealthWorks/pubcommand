import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { chooseSite, createSite } from "@/features/websites/actions";
import { websitesAccess } from "@/features/websites/guard";
import { websiteLinks } from "@/features/websites/links";

export default async function WebsitesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site, canSettings } = access;
  const db = tenantDb(ctx.resolved.id);
  const now = new Date();
  const stats = await Promise.all(
    sites.map(async (item) => {
      const [posts, pages, members, signups, domains] = await Promise.all([
        db.webPost.count({ where: { siteId: item.id, kind: "post", deletedAt: null, status: { in: ["published", "scheduled"] }, publishedAt: { lte: now } } }),
        db.webPost.count({ where: { siteId: item.id, kind: "page", deletedAt: null } }),
        db.webMember.count({ where: { siteId: item.id } }),
        db.webSignup.count({ where: { siteId: item.id, status: "subscribed" } }),
        db.customDomain.findMany({ where: { targetPath: { in: [`/w/${item.slug}`, `/w/${item.slug}/my`] } }, select: { hostname: true, status: true, targetPath: true } }),
      ]);
      // The site's custom domain when one is Active; the PubCommand address only without one.
      const link = (await websiteLinks(item)).site;
      return { id: item.id, posts, pages, members, signups, domains, link };
    }),
  );
  return (
    <div>
      <PageHeader title="Websites" description={`The public website and members-only site for ${ctx.brand.name}. Publications, editors and logos come from Publication Setup.`} />
      <Flash error={query.error} notice={query.notice} />
      <div className="grid gap-4 lg:grid-cols-2">
        {sites.map((item) => {
          const stat = stats.find((row) => row.id === item.id)!;
          const current = item.id === site?.id;
          return (
            <section key={item.id} className={`rounded-xl border bg-white p-5 ${current ? "border-accent" : "border-line"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{item.name}</h2>
                <Badge tone={item.status === "live" ? "ok" : "warn"}>{item.status === "live" ? "Live" : "Not live yet"}</Badge>
                {current ? <Badge tone="accent">Editing</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                <a className="text-accent [overflow-wrap:anywhere]" href={stat.link} target="_blank" rel="noreferrer">
                  {stat.link.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}
                </a>
                {stat.domains.some((domain) => domain.status !== "ACTIVE") ? ` · ${stat.domains.filter((domain) => domain.status !== "ACTIVE").map((domain) => `${domain.hostname} (DNS pending)`).join(", ")}` : stat.domains.length ? "" : " · no custom domain yet"}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Live posts", stat.posts],
                  ["Pages", stat.pages],
                  ["Members", stat.members],
                  ["Free sign-ups", stat.signups],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-canvas p-3">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {current ? (
                  <>
                    <Link href="/websites/posts/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
                      + New post
                    </Link>
                    <Link href="/websites/posts" className="inline-flex min-h-11 items-center rounded-md border border-line px-3.5 text-sm font-semibold">
                      Posts
                    </Link>
                    {canSettings ? (
                      <Link href="/websites/settings" className="inline-flex min-h-11 items-center rounded-md border border-line px-3.5 text-sm font-semibold">
                        Site settings
                      </Link>
                    ) : null}
                  </>
                ) : (
                  <form action={chooseSite}>
                    <input type="hidden" name="siteId" value={item.id} />
                    <Button variant="secondary">Work on this site</Button>
                  </form>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {canSettings ? (
        <details className="mt-6 rounded-xl border border-line bg-white" open={sites.length === 0}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-accent">+ New website</summary>
          <form action={createSite} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="site-name">Name</Label>
              <Input id="site-name" name="name" required maxLength={120} placeholder={ctx.brand.name} defaultValue={sites.length ? "" : ctx.brand.name} />
            </div>
            <div>
              <Label htmlFor="site-slug">Address on PubCommand</Label>
              <Input id="site-slug" name="slug" maxLength={60} placeholder="e.g. fms" />
            </div>
            <Button type="submit">Create website</Button>
          </form>
        </details>
      ) : null}
      <section className="mt-6 rounded-xl border border-line bg-white p-5 text-sm">
        <h2 className="font-semibold">Putting a site on its own domain</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>Take the site live in Site settings.</li>
          <li>
            In{" "}
            <Link href="/settings/domains" className="font-semibold text-accent">
              Settings → Domains
            </Link>
            , add your domain (e.g. freemarketsociety.org) and point it at the website. Add a second domain (e.g. my.freemarketsociety.org) and point it at its members area if you want one.
          </li>
          <li>Create the DNS records the Domains page shows at your registrar. The page checks them and turns the domain on.</li>
        </ol>
      </section>
    </div>
  );
}
