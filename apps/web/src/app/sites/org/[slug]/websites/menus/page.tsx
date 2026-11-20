import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { navItemsFrom } from "../../../../../../../../../modules/websites/content";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { addMenuItems, saveMenu } from "@/features/websites/actions";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { isFreePublication, sitePublications, siteTerms } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

const BUILTIN = [
  ["Home", "/"],
  ["Latest articles", "/latest"],
  ["Free newsletters", "/newsletters"],
  ["Our research", "/research"],
  ["Editors", "/editors"],
  ["Member login", "/sign-in"],
  ["My account", "/my"],
] as const;

function AddBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-line bg-white" open>
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold">{title}</summary>
      <div className="max-h-56 space-y-1 overflow-y-auto border-t border-line px-3 py-2 text-sm">{children}</div>
    </details>
  );
}

/** Menus, like WordPress: pick a menu, add pages/categories/publications/links, then arrange, rename, nest or remove. */
export default async function MenusPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ menu?: string; error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.settings");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const which = query.menu === "topics" ? "topics" : "header";
  const key = which === "topics" ? "topics" : "menu";
  const items = navItemsFrom(site[key]);
  const [pages, terms, pubs] = await Promise.all([
    tenantDb(ctx.resolved.id).webPost.findMany({ where: { siteId: site.id, kind: "page", deletedAt: null }, orderBy: { title: "asc" }, select: { title: true, slug: true, status: true } }),
    siteTerms(ctx.resolved.id, site.id),
    sitePublications(ctx.resolved.id, ctx.brand.id),
  ]);
  const topLevel = items.filter((item) => !item.parent);
  const tick = (kind: string, label: string, href: string) => (
    <label key={`${kind}${href}`} className="flex items-center gap-2">
      <input type="checkbox" name="item" value={`${kind}|${label}|${href}`} /> {label}
      <span className="ml-auto truncate text-xs text-muted">{href}</span>
    </label>
  );
  return (
    <div>
      <PageHeader title="Menus" description="Build the site's menus: add items from the left, put them in order with the numbers, rename them, or tuck one under another to make a dropdown." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/menus" />
      <nav className="mb-4 flex gap-2 text-sm" aria-label="Menu">
        {(
          [
            ["header", "Header menu"],
            ["topics", "Topic bar (under the header)"],
          ] as const
        ).map(([value, label]) => (
          <Link key={value} href={`/websites/menus?menu=${value}`} className={`rounded-md border px-3 py-2 font-semibold ${which === value ? "border-accent bg-[#e8efff] text-[#1e3a8a]" : "border-line bg-white"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <form action={addMenuItems} className="space-y-3">
          <input type="hidden" name="siteId" value={site.id} />
          <input type="hidden" name="menu" value={key} />
          <h2 className="text-sm font-semibold">Add to menu</h2>
          <AddBox title="Site pages">{BUILTIN.map(([label, href]) => tick("builtin", label, href))}</AddBox>
          <AddBox title="Pages">
            {pages.length ? pages.map((page) => tick("page", page.title || page.slug, `/${page.slug}`)) : <p className="text-muted">No pages yet.</p>}
          </AddBox>
          <AddBox title="Categories">
            {terms.categories.length ? terms.categories.map((term) => tick("category", term.name, `/category/${term.slug}`)) : <p className="text-muted">No categories yet.</p>}
          </AddBox>
          <AddBox title="Newsletters & research">
            {pubs.all.length ? pubs.all.map((pub) => tick("publication", pub.name, `/${isFreePublication(pub) ? "newsletters" : "research"}/${pub.slug}`)) : <p className="text-muted">No publications in Publication Setup yet.</p>}
          </AddBox>
          <AddBox title="Custom link">
            <div className="space-y-2 py-1">
              <Input name="customLabel" placeholder="Label" maxLength={40} aria-label="Link label" />
              <Input name="customHref" placeholder="/about or https://…" maxLength={300} aria-label="Link address" />
            </div>
          </AddBox>
          <Button variant="secondary" className="w-full">
            Add to menu
          </Button>
        </form>

        <form action={saveMenu} className="rounded-xl border border-line bg-white">
          <input type="hidden" name="siteId" value={site.id} />
          <input type="hidden" name="menu" value={key} />
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">{which === "topics" ? "Topic bar" : "Header menu"}</h2>
            <span className="text-xs text-muted">{items.length} items</span>
          </div>
          <ol>
            {items.map((item, index) => (
              <li key={item.id} className={`grid gap-2 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_170px_auto] sm:items-end ${item.parent ? "bg-canvas sm:pl-12" : ""}`}>
                <div>
                  <Label htmlFor={`pos_${item.id}`} className="text-xs">
                    Order
                  </Label>
                  <input id={`pos_${item.id}`} name={`pos_${item.id}`} type="number" min={1} max={99} defaultValue={index + 1} className="pc-control w-full text-center" />
                </div>
                <div>
                  <Label htmlFor={`label_${item.id}`} className="text-xs">
                    {item.parent ? "↳ Label (in dropdown)" : "Label"}
                  </Label>
                  <Input id={`label_${item.id}`} name={`label_${item.id}`} defaultValue={item.label} maxLength={40} />
                </div>
                <div>
                  <Label htmlFor={`href_${item.id}`} className="text-xs">
                    Link <span className="text-muted">({item.kind})</span>
                  </Label>
                  <Input id={`href_${item.id}`} name={`href_${item.id}`} defaultValue={item.href} maxLength={300} />
                </div>
                <div>
                  <Label htmlFor={`parent_${item.id}`} className="text-xs">
                    Dropdown under
                  </Label>
                  <select id={`parent_${item.id}`} name={`parent_${item.id}`} defaultValue={item.parent ?? ""} className="pc-control w-full">
                    <option value="">— Top level —</option>
                    {topLevel
                      .filter((top) => top.id !== item.id)
                      .map((top) => (
                        <option key={top.id} value={top.id}>
                          {top.label}
                        </option>
                      ))}
                  </select>
                </div>
                <label className="flex min-h-11 items-center gap-2 text-sm text-[#b42318]">
                  <input type="checkbox" name={`remove_${item.id}`} /> Remove
                </label>
              </li>
            ))}
            {items.length === 0 ? <li className="px-4 py-10 text-center text-sm text-muted">This menu is empty. Add items from the left.</li> : null}
          </ol>
          {items.length ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              <Button>Save menu</Button>
              <span className="text-xs text-muted">Items in a dropdown follow their parent. Dropdowns are one level deep.</span>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
