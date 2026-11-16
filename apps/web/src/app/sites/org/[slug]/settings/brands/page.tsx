import { can } from "@pubcommand/core";
import { Button, Input } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { createBrand, renameBrand } from "@/server/org-actions";

export default async function BrandsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.manage", ctx.scope)) return <Denied />;
  return (
    <div className="max-w-2xl min-w-0">
      <PageHeader
        title="Brands"
        description="One brand per publisher. Each brand has its own apps data and mini-brain. Switch brands from the menu at the top."
      />
      <Flash error={query.error} notice={query.notice} />
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {ctx.brands.map((brand) => (
          <li key={brand.id} className="px-4 py-3">
            <form action={renameBrand} className="pc-form-row">
              <input type="hidden" name="brandId" value={brand.id} />
              <Input name="name" defaultValue={brand.name} aria-label={`Name for ${brand.name}`} maxLength={80} />
              <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                Rename
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <form action={createBrand} className="mt-6 space-y-3 rounded-lg border border-line bg-white p-5">
        <h2 className="text-sm font-semibold">Add a brand</h2>
        <div className="pc-form-row">
          <Input name="name" placeholder="Publisher name" aria-label="Brand name" required maxLength={80} />
          <Button type="submit" className="w-full sm:w-auto">
            Add brand
          </Button>
        </div>
      </form>
    </div>
  );
}
