import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { groupByFunnel } from "../../../../../../../../../modules/pubsetup/groups";
import { entitlementActive } from "../../../../../../../../../modules/websites/content";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { saveProduct, toggleProductPublication } from "@/features/websites/actions";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { sitePublications } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; edit?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.members");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const db = tenantDb(ctx.resolved.id);
  const now = new Date();
  const [products, pubs, entitlements] = await Promise.all([
    db.webProduct.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    sitePublications(ctx.resolved.id, ctx.brand.id),
    db.webEntitlement.findMany({ where: { product: { siteId: site.id }, status: { not: "cancelled" } }, select: { productId: true, status: true, startsAt: true, endsAt: true } }),
  ]);
  const holders = new Map<string, number>();
  for (const entitlement of entitlements) if (entitlementActive(entitlement, now)) holders.set(entitlement.productId, (holders.get(entitlement.productId) ?? 0) + 1);
  const paid = groupByFunnel(pubs.paid).flatMap((group) => group.items);
  const editing = products.find((product) => product.id === query.edit);
  return (
    <div>
      <PageHeader title="Products & access" description="What each product unlocks. Tick a box and every member holding that product can read that publication right away. Publications come from Publication Setup." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/products" />
      {paid.length === 0 ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          No paid publications yet. Add them in{" "}
          <Link className="font-semibold underline" href="/publication-setup">
            Publication Setup
          </Link>{" "}
          (anything that is not a free newsletter) and they appear as columns here.
        </p>
      ) : null}
      <div className="rounded-xl border border-line bg-white">
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line bg-canvas text-xs text-muted">
              <tr>
                <th className="px-4 py-3 text-left uppercase tracking-wider">Product</th>
                {paid.map((pub) => (
                  <th key={pub.id} className="max-w-[96px] px-2 py-3 text-center align-bottom font-semibold leading-tight">
                    {pub.hasLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/w/${site.slug}/pub-logo/${pub.id}?bg=light`} alt="" className="mx-auto mb-1 h-7 w-7 rounded object-contain" />
                    ) : null}
                    {pub.name}
                  </th>
                ))}
                <th className="px-3 py-3 text-center uppercase tracking-wider">All</th>
                <th className="px-4 py-3 text-right uppercase tracking-wider">Members</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className={`border-b border-line last:border-0 ${product.allPublications ? "bg-[#fffaf0]" : ""}`}>
                  <td className="px-4 py-3">
                    <Link href={`/websites/products?edit=${product.id}#product-form`} className="font-semibold hover:text-accent">
                      {product.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {[product.priceLabel, product.sku].filter(Boolean).join(" · ")}
                      {product.active ? "" : " · off"}
                    </div>
                  </td>
                  {paid.map((pub) => {
                    const on = product.allPublications || product.publicationIds.includes(pub.id);
                    return (
                      <td key={pub.id} className="px-2 py-3 text-center">
                        <form action={toggleProductPublication}>
                          <input type="hidden" name="productId" value={product.id} />
                          <input type="hidden" name="publicationId" value={pub.id} />
                          <button
                            disabled={product.allPublications}
                            aria-label={`${on ? "Remove" : "Add"} ${pub.name} ${on ? "from" : "to"} ${product.name}`}
                            className={`inline-grid h-7 w-7 place-items-center rounded-md border-2 text-xs font-bold ${on ? "border-accent bg-accent text-white" : "border-line bg-white text-transparent hover:border-accent"}`}
                          >
                            ✓
                          </button>
                        </form>
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-center">{product.allPublications ? "✓ incl. future" : ""}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <Link href={`/websites/members?product=${product.id}`} className="hover:text-accent">
                      {holders.get(product.id) ?? 0}
                    </Link>
                  </td>
                </tr>
              ))}
              {products.length === 0 ? (
                <tr>
                  <td colSpan={paid.length + 3} className="px-4 py-10 text-center text-muted">
                    No products yet. Add one below (e.g. &quot;Free Market Investor — Annual&quot;).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
      </div>

      <form id="product-form" action={saveProduct} className="mt-6 rounded-xl border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">{editing ? `Edit ${editing.name}` : "New product"}</h2>
        <input type="hidden" name="siteId" value={site.id} />
        {editing ? <input type="hidden" name="productId" value={editing.id} /> : null}
        <input type="hidden" name="activeShown" value="1" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" name="name" required maxLength={120} defaultValue={editing?.name ?? ""} placeholder="Free Market Investor — Annual" />
          </div>
          <div>
            <Label htmlFor="p-price">Price (shown to admins)</Label>
            <Input id="p-price" name="priceLabel" maxLength={80} defaultValue={editing?.priceLabel ?? ""} placeholder="$49/yr" />
          </div>
          <div>
            <Label htmlFor="p-sku">SKU / order code</Label>
            <Input id="p-sku" name="sku" maxLength={80} defaultValue={editing?.sku ?? ""} placeholder="FMI-ANN" />
          </div>
          <div>
            <Label htmlFor="p-offer">Upgrade page (offer link)</Label>
            <Input id="p-offer" name="offerUrl" maxLength={1000} defaultValue={editing?.offerUrl ?? ""} placeholder="https://…" />
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Unlocks</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {paid.map((pub) => (
              <label key={pub.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input type="checkbox" name="publicationIds" value={pub.id} defaultChecked={editing?.publicationIds.includes(pub.id) ?? false} /> {pub.name}
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm">
              <input type="checkbox" name="allPublications" defaultChecked={editing?.allPublications ?? false} /> Everything, including future publications
            </label>
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> On sale / in use
          </label>
          <Button>{editing ? "Save product" : "Add product"}</Button>
          {editing ? (
            <>
              <Link href="/websites/products" className="text-sm font-semibold text-muted">
                Cancel
              </Link>
              <button name="delete" value="1" className="ml-auto text-sm font-semibold text-[#b42318]">
                Delete product
              </button>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}
