import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { utcToZonedLocal } from "../../../../../../../../../../modules/miniblog/time";
import { ENTITLEMENT_STATUSES, entitlementActive } from "../../../../../../../../../../modules/websites/content";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { emailSignInLink, grantAccess, saveMember, updateAccess } from "@/features/websites/actions";
import { formatDate } from "@/features/websites/admin-ui";
import { orgTimezone, sitePublications } from "@/features/websites/data";
import { UUID_RE, websitesAccess } from "@/features/websites/guard";

const STATUS_LABEL: Record<string, string> = { active: "Active", past_due: "Past due (grace)", cancelled: "Cancelled" };

export default async function MemberPage({ params, searchParams }: { params: Promise<{ slug: string; memberId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, memberId } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.members");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites } = access;
  if (!UUID_RE.test(memberId)) notFound();
  const db = tenantDb(ctx.resolved.id);
  const member = await db.webMember.findFirst({ where: { id: memberId } });
  const site = member ? sites.find((item) => item.id === member.siteId) : undefined;
  if (!member || !site) notFound();
  const now = new Date();
  const [entitlements, products, signups, timeZone, pubs, audit] = await Promise.all([
    db.webEntitlement.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" } }),
    db.webProduct.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.webSignup.findMany({ where: { siteId: site.id, email: member.email }, orderBy: { createdAt: "asc" } }),
    orgTimezone(ctx.resolved.id),
    sitePublications(ctx.resolved.id, ctx.brand.id),
    db.auditLog.findMany({ where: { targetId: member.id }, orderBy: { createdAt: "desc" }, take: 10, select: { action: true, createdAt: true } }),
  ]);
  const productById = new Map(products.map((product) => [product.id, product]));
  const pubName = new Map(pubs.all.map((pub) => [pub.id, pub.name]));
  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <PageHeader title={member.email} description={`${member.name ? `${member.name} · ` : ""}Member of ${site.name} since ${formatDate(member.createdAt, timeZone)} · last sign-in ${member.lastLoginAt ? formatDate(member.lastLoginAt, timeZone, true) : "never"}`} />
        <Link href="/websites/members" className="mt-1 text-sm font-semibold text-accent">
          ← All members
        </Link>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-white">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Access</h2>
            <ul>
              {entitlements.map((entitlement) => {
                const product = productById.get(entitlement.productId);
                const on = entitlementActive(entitlement, now);
                return (
                  <li key={entitlement.id} className="border-b border-line px-4 py-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{product?.name ?? "Deleted product"}</b>
                      <Badge tone={on ? (entitlement.status === "past_due" ? "warn" : "ok") : "neutral"}>{on ? STATUS_LABEL[entitlement.status] : entitlement.status === "cancelled" ? "Cancelled" : "Ended"}</Badge>
                      <span className="text-xs text-muted">
                        {entitlement.source} · from {formatDate(entitlement.startsAt, timeZone)}
                        {entitlement.endsAt ? ` to ${formatDate(entitlement.endsAt, timeZone)}` : " · no end date"}
                        {entitlement.reference ? ` · ${entitlement.reference}` : ""}
                      </span>
                    </div>
                    {product ? (
                      <p className="mt-1 text-xs text-muted">
                        Unlocks: {product.allPublications ? "every publication" : product.publicationIds.map((id) => pubName.get(id) ?? "—").join(", ") || "nothing yet (set it in Products & access)"}
                      </p>
                    ) : null}
                    {entitlement.note ? <p className="mt-1 text-xs">{entitlement.note}</p> : null}
                    <form action={updateAccess} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="memberId" value={member.id} />
                      <input type="hidden" name="entitlementId" value={entitlement.id} />
                      <select name="status" defaultValue={entitlement.status} className="pc-control" aria-label="Status">
                        {ENTITLEMENT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                      <Input type="date" name="endsOn" defaultValue={utcToZonedLocal(entitlement.endsAt, timeZone).slice(0, 10)} className="w-44" aria-label="End date" />
                      <Button variant="secondary" size="sm">
                        Update
                      </Button>
                    </form>
                  </li>
                );
              })}
              {entitlements.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">No paid access. This reader sees public and free-subscriber content.</li> : null}
            </ul>
          </section>
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="mb-3 font-semibold">Grant access</h2>
            {products.length ? (
              <form action={grantAccess} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="memberId" value={member.id} />
                <div>
                  <Label htmlFor="grant-product">Product</Label>
                  <select id="grant-product" name="productId" required className="pc-control w-full">
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                        {product.active ? "" : " (off)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="grant-source">Why</Label>
                  <select id="grant-source" name="source" className="pc-control w-full">
                    <option value="manual">Purchase entered by hand</option>
                    <option value="comp">Complimentary (support / comp)</option>
                    <option value="import">Imported</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="grant-ends">Ends on (empty = no end)</Label>
                  <Input id="grant-ends" name="endsOn" type="date" />
                </div>
                <div>
                  <Label htmlFor="grant-ref">Order number / reference</Label>
                  <Input id="grant-ref" name="reference" maxLength={120} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="grant-note">Note</Label>
                  <Input id="grant-note" name="note" maxLength={500} />
                </div>
                <div>
                  <Button>Grant access</Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted">
                Create products first in{" "}
                <Link href="/websites/products" className="font-semibold text-accent">
                  Products &amp; access
                </Link>
                .
              </p>
            )}
          </section>
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="mb-3 font-semibold">Account</h2>
            <form action={saveMember} className="space-y-3">
              <input type="hidden" name="memberId" value={member.id} />
              <div>
                <Label htmlFor="member-name">Name</Label>
                <Input id="member-name" name="name" defaultValue={member.name} maxLength={120} />
              </div>
              <div>
                <Label htmlFor="member-status">Status</Label>
                <select id="member-status" name="status" defaultValue={member.status} className="pc-control w-full">
                  <option value="active">Active</option>
                  <option value="disabled">Disabled (cannot sign in)</option>
                </select>
              </div>
              <Button variant="secondary">Save</Button>
            </form>
            <form action={emailSignInLink} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="memberId" value={member.id} />
              <Button variant="secondary" className="w-full">
                Email a sign-in link
              </Button>
            </form>
          </section>
          <section className="rounded-xl border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Free newsletters</h2>
            {signups.length ? (
              <ul className="space-y-1">
                {signups.map((signup) => (
                  <li key={signup.id} className="flex justify-between gap-2">
                    <span>{pubName.get(signup.publicationId) ?? "Newsletter"}</span>
                    <span className="text-xs text-muted">{signup.status === "subscribed" ? formatDate(signup.createdAt, timeZone) : "unsubscribed"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None.</p>
            )}
          </section>
          <section className="rounded-xl border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">History</h2>
            <ul className="space-y-1 text-xs text-muted">
              {audit.map((row, index) => (
                <li key={index}>
                  {row.action.replace("websites.", "").replace(/[._]/g, " ")} · {formatDate(row.createdAt, timeZone, true)}
                </li>
              ))}
              {audit.length === 0 ? <li>Nothing yet.</li> : null}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
