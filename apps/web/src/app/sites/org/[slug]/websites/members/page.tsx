import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { entitlementActive } from "../../../../../../../../../modules/websites/content";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { addMember } from "@/features/websites/actions";
import { NoSite, SiteBar, formatDate } from "@/features/websites/admin-ui";
import { orgTimezone } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

export default async function MembersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; q?: string; product?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.members");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const db = tenantDb(ctx.resolved.id);
  const q = query.q?.trim().toLowerCase().slice(0, 100);
  const now = new Date();
  const productFilter = query.product && /^[0-9a-f-]{36}$/i.test(query.product) ? query.product : undefined;
  const [members, total, products, timeZone] = await Promise.all([
    db.webMember.findMany({
      where: {
        siteId: site.id,
        ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
        ...(productFilter ? { entitlements: { some: { productId: productFilter, status: { not: "cancelled" } } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { entitlements: { select: { productId: true, status: true, startsAt: true, endsAt: true } } },
    }),
    db.webMember.count({ where: { siteId: site.id } }),
    db.webProduct.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    orgTimezone(ctx.resolved.id),
  ]);
  const productName = new Map(products.map((product) => [product.id, product.name]));
  return (
    <div>
      <PageHeader title="Members" description="Members of the website: the people who can sign in. Access comes from the products they hold. Newsletter sign-ups are not members (see Free sign-ups)." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/members" />
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-4" action="/websites/members">
          <div className="min-w-0 flex-1">
            <Label htmlFor="member-q">Find a member</Label>
            <Input id="member-q" name="q" defaultValue={query.q ?? ""} placeholder="Email or name" />
          </div>
          <select name="product" defaultValue={productFilter ?? ""} className="pc-control" aria-label="Product">
            <option value="">Any product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <Button variant="secondary">Search</Button>
        </form>
        <form action={addMember} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-4">
          <input type="hidden" name="siteId" value={site.id} />
          <div className="min-w-0 flex-1">
            <Label htmlFor="member-email">Add a member</Label>
            <Input id="member-email" name="email" type="email" required placeholder="reader@example.com" />
          </div>
          <Button>Add</Button>
        </form>
      </div>
      <div className="rounded-xl border border-line bg-white">
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line bg-canvas text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Access</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const active = member.entitlements.filter((entitlement) => entitlementActive(entitlement, now));
                return (
                  <tr key={member.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/websites/members/${member.id}`} className="font-semibold hover:text-accent">
                        {member.email}
                      </Link>
                      <div className="text-xs text-muted">
                        {member.name}
                        {member.status === "disabled" ? " · disabled" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {active.length ? active.map((entitlement) => <Badge key={entitlement.productId} tone={entitlement.status === "past_due" ? "warn" : "ok"}>{productName.get(entitlement.productId) ?? "Product"}</Badge>) : <Badge>No active product</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(member.createdAt, timeZone)}</td>
                    <td className="px-4 py-3 text-muted">{member.lastLoginAt ? formatDate(member.lastLoginAt, timeZone, true) : "Never"}</td>
                  </tr>
                );
              })}
              {members.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted">
                    {q || productFilter ? "No members match." : "No members yet. Free sign-ups and members you add appear here."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          {total} member{total === 1 ? "" : "s"} in all{members.length === 100 ? " · showing the newest 100; search to find others" : ""}
        </p>
      </div>
    </div>
  );
}
