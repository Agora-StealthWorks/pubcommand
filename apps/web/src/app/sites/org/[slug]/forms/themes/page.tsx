import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { deleteTheme, saveTheme } from "@/features/forms/actions";
import { adminLogoSrc, listThemes, previewTheme } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";
import { LiveThemePreview } from "@/features/forms/theme-preview";

export default async function FormThemesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await formsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite } = access;
  const themes = await listThemes(ctx.resolved.id, ctx.brand.id);
  const editing = themes.find((theme) => theme.id === query.edit) ?? null;
  const showForm = canWrite && (editing || query.edit === "new" || themes.length === 0);

  return (
    <div className="max-w-5xl">
      <div className="mb-2 text-sm">
        <Link href="/forms" className="text-accent">
          ← Forms
        </Link>
      </div>
      <PageHeader title="Form themes" description={`The look of ${ctx.brand.name}'s public forms: logo, colours and the privacy-policy link every form must show.`} />
      <Flash error={query.error} notice={query.notice} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2">
          {themes.map((theme) => (
            <Link
              key={theme.id}
              href={`/forms/themes?edit=${theme.id}`}
              className={`block rounded-xl border bg-white p-3 ${editing?.id === theme.id ? "border-accent" : "border-line"}`}
            >
              <span className="flex items-center gap-2">
                <span className="h-5 w-5 shrink-0 rounded" style={{ background: theme.barColor }} aria-hidden />
                <span className="h-5 w-5 shrink-0 rounded" style={{ background: theme.accentColor }} aria-hidden />
                <span className="[overflow-wrap:anywhere] min-w-0 flex-1 text-sm font-semibold">{theme.name}</span>
                {theme.isDefault ? <Badge tone="accent">Default</Badge> : null}
              </span>
              <span className="mt-1 block truncate text-xs text-muted">{theme.privacyPolicyUrl}</span>
            </Link>
          ))}
          {themes.length === 0 ? <p className="text-sm text-muted">No themes yet.</p> : null}
          {canWrite ? (
            <Link href="/forms/themes?edit=new" className="block rounded-xl border border-dashed border-line bg-white p-3 text-sm font-semibold text-accent">
              + New theme
            </Link>
          ) : null}
        </aside>

        {showForm ? (
          <div className="min-w-0 space-y-4">
            <div className="overflow-hidden rounded-xl border border-line">
              <LiveThemePreview formId="theme-form" brandName={ctx.brand.name} uploadedLogoSrc={editing?.logoFileId ? adminLogoSrc(editing) : null} initial={previewTheme(editing, ctx.brand.name)} />
              <p className="bg-white px-4 py-2 text-xs text-muted">Live header preview: it updates as you edit. Without a logo, the brand name is shown.</p>
            </div>
            <form id="theme-form" key={editing?.id ?? "new"} action={saveTheme} encType="multipart/form-data" className="space-y-4 rounded-xl border border-line bg-white p-5">
              {editing ? <input type="hidden" name="themeId" value={editing.id} /> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="theme-name">Theme name</Label>
                  <Input id="theme-name" name="name" required maxLength={120} defaultValue={editing?.name ?? ctx.brand.name} />
                </div>
                <div>
                  <Label htmlFor="theme-company">Company name in the disclaimer</Label>
                  <Input id="theme-company" name="companyName" maxLength={200} defaultValue={editing?.companyName ?? ctx.brand.name} />
                </div>
              </div>
              <div>
                <Label htmlFor="theme-privacy">Privacy-policy URL (required)</Label>
                <Input id="theme-privacy" name="privacyPolicyUrl" type="url" required placeholder="https://" defaultValue={editing?.privacyPolicyUrl ?? ""} />
                <p className="mt-1 text-xs text-muted">Shown under the submit button of every form using this theme. It cannot be turned off.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="theme-logo">Logo image</Label>
                  <input id="theme-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="mt-1 block w-full text-sm" />
                  <p className="mt-1 text-xs text-muted">PNG, JPG, WebP or GIF up to 2 MB.</p>
                  {editing?.logoFileId ? (
                    <label className="mt-1 flex items-center gap-2 text-sm">
                      <input type="checkbox" name="removeLogo" /> Remove the uploaded logo
                    </label>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="theme-logo-url">…or a logo URL</Label>
                  <Input id="theme-logo-url" name="logoUrl" type="url" placeholder="https://" defaultValue={editing?.logoUrl ?? ""} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <Label htmlFor="theme-bar">Header colour</Label>
                  <input id="theme-bar" name="barColor" type="color" defaultValue={editing?.barColor ?? "#0b1220"} className="mt-1 h-11 w-full rounded-md border border-line" />
                </div>
                <div>
                  <Label htmlFor="theme-accent">Button colour</Label>
                  <input id="theme-accent" name="accentColor" type="color" defaultValue={editing?.accentColor ?? "#1d4ed8"} className="mt-1 h-11 w-full rounded-md border border-line" />
                </div>
                <div>
                  <Label htmlFor="theme-size">Header size</Label>
                  <select id="theme-size" name="headerSize" defaultValue={editing?.headerSize ?? "standard"} className="pc-control mt-1 w-full text-sm">
                    <option value="standard">Standard</option>
                    <option value="tall">Tall masthead</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="theme-height">Exact logo height (px)</Label>
                  <Input id="theme-height" name="logoHeight" type="number" min={16} max={160} defaultValue={editing?.logoHeight ?? ""} />
                </div>
              </div>
              <div>
                <Label htmlFor="theme-footer">Footer text (optional)</Label>
                <Textarea id="theme-footer" name="footerText" rows={2} maxLength={500} defaultValue={editing?.footerText ?? ""} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isDefault" defaultChecked={editing?.isDefault ?? themes.length === 0} /> Use for new forms by default
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Save theme</Button>
              </div>
            </form>
            {editing ? (
              <form action={deleteTheme}>
                <input type="hidden" name="themeId" value={editing.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete theme
                </Button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">{canWrite ? "Pick a theme to edit, or add a new one." : "You can view themes. Editing needs forms.write."}</p>
        )}
      </div>
    </div>
  );
}
