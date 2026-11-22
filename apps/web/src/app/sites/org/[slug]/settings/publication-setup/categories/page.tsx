import { Button, Input, Label } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createCategory, deleteCategory, moveCategory, renameCategory } from "@/features/pubsetup/category-actions";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { getCategories, getPublications } from "@/features/pubsetup/read";

export default async function CategoriesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const [categories, pubs] = await Promise.all([getCategories(ctx.resolved.id, ctx.brand.id), getPublications(ctx.resolved.id, ctx.brand.id)]);
  const count = (id: string) => pubs.filter((pub) => pub.categoryId === id).length;
  const uncategorized = pubs.filter((pub) => !pub.categoryId).length;

  return (
    <div className="max-w-3xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <p className="text-sm text-muted">Each publication goes in one category. Your website lists publications by category, in this order.</p>

      <ol className="space-y-2">
        {categories.map((category, index) => {
          const used = count(category.id);
          const others = categories.filter((other) => other.id !== category.id);
          return (
            <li key={category.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-end gap-2">
                <form action={renameCategory} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                  <input type="hidden" name="categoryId" value={category.id} />
                  <div className="min-w-0 flex-1 basis-48">
                    <Label htmlFor={`cat-${category.id}`} className="sr-only">
                      Name
                    </Label>
                    <Input id={`cat-${category.id}`} name="name" defaultValue={category.name} maxLength={60} required aria-label={`Name of ${category.name}`} />
                  </div>
                  <Button type="submit" variant="secondary">
                    Rename
                  </Button>
                </form>
                <div className="flex gap-1">
                  <form action={moveCategory}>
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit" variant="secondary" disabled={index === 0} aria-label={`Move ${category.name} up`}>
                      ↑
                    </Button>
                  </form>
                  <form action={moveCategory}>
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button type="submit" variant="secondary" disabled={index === categories.length - 1} aria-label={`Move ${category.name} down`}>
                      ↓
                    </Button>
                  </form>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>
                  {used} publication{used === 1 ? "" : "s"}
                </span>
                <details className="text-sm">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-[#b42318]">Delete…</summary>
                  <form action={deleteCategory} className="mt-2 space-y-2 rounded-md border border-line bg-canvas p-3">
                    <input type="hidden" name="categoryId" value={category.id} />
                    {used ? (
                      <div>
                        <Label htmlFor={`move-${category.id}`}>
                          Its {used} publication{used === 1 ? "" : "s"}
                        </Label>
                        <select id={`move-${category.id}`} name="moveTo" className="pc-control mt-1 w-full" defaultValue={others[0]?.id ?? "none"}>
                          {others.map((other) => (
                            <option key={other.id} value={other.id}>
                              Move to {other.name}
                            </option>
                          ))}
                          <option value="none">Leave uncategorized</option>
                        </select>
                      </div>
                    ) : (
                      <p className="text-muted">No publication uses it.</p>
                    )}
                    <Button type="submit" variant="danger">
                      Delete {category.name}
                    </Button>
                  </form>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
      {categories.length === 0 ? <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">No categories yet. Add the first one below.</p> : null}
      {uncategorized ? (
        <p className="text-sm text-muted">
          {uncategorized} publication{uncategorized === 1 ? " has" : "s have"} no category. Pick one on each publication&apos;s Edit page.
        </p>
      ) : null}

      <form action={createCategory} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3">
        <div className="min-w-0 flex-1 basis-48">
          <Label htmlFor="new-category">New category</Label>
          <Input id="new-category" name="name" maxLength={60} required placeholder="e.g. Trading services" className="mt-1" />
        </div>
        <Button type="submit">Add category</Button>
      </form>
    </div>
  );
}
