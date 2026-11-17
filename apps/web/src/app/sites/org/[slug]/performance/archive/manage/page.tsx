import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { deleteCategory, deleteExpert, saveCategory, saveExpert } from "@/features/trackrecord/actions";
import { getEditors } from "@/features/pubsetup/read";
import { trackAccess } from "@/features/trackrecord/context";
import { editorForExpertName } from "../../../../../../../../../../modules/performance/attribution";
import { CATEGORY_COLORS } from "../../../../../../../../../../modules/performance/archive";

export default async function ManageArchivePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const db = tenantDb(access.scope.organizationId);
  const [experts, categories, counts, editors] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: access.scope.brandId, deletedAt: null }, orderBy: { name: "asc" } }),
    db.trackCategory.findMany({ where: { brandId: access.scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.trackCall.findMany({ where: { brandId: access.scope.brandId, deletedAt: null }, select: { expertId: true } }),
    getEditors(access.scope.organizationId, access.scope.brandId),
  ]);
  const linkedTo = new Map(experts.filter((e) => e.editorId).map((e) => [e.editorId as string, e.id]));
  const editorName = new Map(editors.map((e) => [e.id, e.name]));
  // An editor can be one expert at a time: each picker offers free editors plus its own.
  // An unlinked expert whose name matches one editor already shows on that editor's profile; saying so avoids surprises.
  const byName = (e: { id: string; name: string; editorId: string | null }) => (e.editorId ? null : editorForExpertName(e.name, editors, experts.filter((x) => x.id !== e.id)));
  const choices = (expertId: string | null) => editors.filter((e) => !linkedTo.has(e.id) || linkedTo.get(e.id) === expertId);
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
        <p className="text-sm text-muted">Link an expert to their editor in Publication Setup and their calls show on the editor&apos;s Wiki profile.</p>
        {experts.map((e) => (
          <div key={e.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3">
            <form action={saveExpert} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
              <input type="hidden" name="expertId" value={e.id} />
              <div className="min-w-0 flex-1 basis-48">
                <Label htmlFor={`expert-${e.id}`}>Name · {perExpert.get(e.id) ?? 0} calls</Label>
                <Input id={`expert-${e.id}`} name="name" defaultValue={e.name} maxLength={120} required />
              </div>
              <div className="min-w-0 flex-1 basis-48">
                <Label htmlFor={`expert-editor-${e.id}`}>Editor profile</Label>
                <select id={`expert-editor-${e.id}`} name="editorId" className="pc-control w-full" defaultValue={e.editorId ?? ""}>
                  <option value="">Not an editor</option>
                  {e.editorId && !editorName.has(e.editorId) ? <option value={e.editorId}>An archived editor</option> : null}
                  {choices(e.id).map((ed) => (
                    <option key={ed.id} value={ed.id}>
                      {ed.name}
                    </option>
                  ))}
                </select>
                {byName(e) ? <p className="mt-1 text-xs text-muted">Shown on {byName(e)?.name}&apos;s profile by name. Pick them here to link for good.</p> : null}
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Save
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
          <div className="min-w-0 flex-1 basis-48">
            <Label htmlFor="expert-new">New expert</Label>
            <Input id="expert-new" name="name" maxLength={120} required placeholder="Name" />
          </div>
          <div className="min-w-0 flex-1 basis-48">
            <Label htmlFor="expert-new-editor">Editor profile</Label>
            <select id="expert-new-editor" name="editorId" className="pc-control w-full" defaultValue="auto">
              <option value="auto">Match an editor by name</option>
              <option value="">Not an editor</option>
              {choices(null).map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.name}
                </option>
              ))}
            </select>
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
