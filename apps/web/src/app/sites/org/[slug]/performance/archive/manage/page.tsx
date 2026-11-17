import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { deleteCategory, deleteExpert, saveCategory, saveExpert } from "@/features/trackrecord/actions";
import { trackAccess } from "@/features/trackrecord/context";
import { CATEGORY_COLORS } from "../../../../../../../../../../modules/performance/archive";

export default async function ManageArchivePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const db = tenantDb(access.scope.organizationId);
  const [experts, categories, counts] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: access.scope.brandId, deletedAt: null }, orderBy: { name: "asc" } }),
    db.trackCategory.findMany({ where: { brandId: access.scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.trackCall.findMany({ where: { brandId: access.scope.brandId, deletedAt: null }, select: { expertId: true } }),
  ]);
  const perExpert = new Map<string, number>();
  for (const row of counts) perExpert.set(row.expertId, (perExpert.get(row.expertId) ?? 0) + 1);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/performance/archive" className="text-sm text-accent">
        ← Call archive
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Experts</h2>
        {experts.map((e) => (
          <div key={e.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3">
            <form action={saveExpert} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
              <input type="hidden" name="expertId" value={e.id} />
              <div className="min-w-0 flex-1">
                <Label htmlFor={`expert-${e.id}`}>Name · {perExpert.get(e.id) ?? 0} calls</Label>
                <Input id={`expert-${e.id}`} name="name" defaultValue={e.name} maxLength={120} required />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Rename
              </Button>
            </form>
            <form action={deleteExpert}>
              <input type="hidden" name="expertId" value={e.id} />
              <Button type="submit" variant="danger" size="sm" disabled={(perExpert.get(e.id) ?? 0) > 0}>
                Remove
              </Button>
            </form>
          </div>
        ))}
        <form action={saveExpert} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line bg-white p-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="expert-new">New expert</Label>
            <Input id="expert-new" name="name" maxLength={120} required placeholder="Name" />
          </div>
          <Button type="submit" size="sm">
            Add expert
          </Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="text-sm text-muted">Groupings for calls, like &quot;10-baggers&quot; or &quot;Energy&quot;. Deleting a category keeps its calls.</p>
        {[...categories, null].map((c) => (
          <div key={c?.id ?? "new"} className={`rounded-xl border bg-white p-3 ${c ? "border-line" : "border-dashed border-line"}`}>
            <form action={saveCategory} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_5rem_auto] sm:items-end">
              {c ? <input type="hidden" name="categoryId" value={c.id} /> : null}
              <div className="min-w-0">
                <Label htmlFor={`cat-name-${c?.id ?? "new"}`}>{c ? "Name" : "New category"}</Label>
                <Input id={`cat-name-${c?.id ?? "new"}`} name="name" defaultValue={c?.name ?? ""} maxLength={80} required />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`cat-desc-${c?.id ?? "new"}`}>Description</Label>
                <Input id={`cat-desc-${c?.id ?? "new"}`} name="description" defaultValue={c?.description ?? ""} maxLength={500} />
              </div>
              <div>
                <Label htmlFor={`cat-color-${c?.id ?? "new"}`}>Colour</Label>
                <select id={`cat-color-${c?.id ?? "new"}`} name="color" className="pc-control w-full" defaultValue={c?.color ?? CATEGORY_COLORS[0]}>
                  {CATEGORY_COLORS.map((color, i) => (
                    <option key={color} value={color}>
                      {["Blue", "Teal", "Green", "Amber", "Red", "Purple", "Grey"][i]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`cat-order-${c?.id ?? "new"}`}>Order</Label>
                <Input id={`cat-order-${c?.id ?? "new"}`} name="sortOrder" inputMode="numeric" defaultValue={String(c?.sortOrder ?? 100)} />
              </div>
              <Button type="submit" variant={c ? "secondary" : "primary"} size="sm">
                {c ? "Save" : "Add"}
              </Button>
            </form>
            {c ? (
              <form action={deleteCategory} className="mt-2">
                <input type="hidden" name="categoryId" value={c.id} />
                <button type="submit" className="text-xs font-semibold text-[#b42318]">
                  Delete category
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
