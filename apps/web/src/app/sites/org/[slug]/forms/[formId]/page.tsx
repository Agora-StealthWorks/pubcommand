import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteForm, duplicateForm, setFormStatus } from "@/features/forms/actions";
import { FormBuilder, type BuilderSettings } from "@/features/forms/builder";
import { CopyField } from "@/features/forms/copy-field";
import { listFolders, listThemes, loadForm, previewTheme } from "@/features/forms/data";
import { formsAccess, publicFormUrl } from "@/features/forms/guard";
import { cleanEndRules } from "../../../../../../../../../modules/forms/logic";

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; formId: string }>;
  searchParams: Promise<{ tab?: string; error?: string; notice?: string }>;
}) {
  const { slug, formId } = await params;
  const query = await searchParams;
  const access = await formsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite } = access;
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, formId);
  if (!loaded) notFound();
  const { form, fields } = loaded;
  const [themes, folders] = await Promise.all([listThemes(ctx.resolved.id, ctx.brand.id), listFolders(ctx.resolved.id, ctx.brand.id)]);
  const settings: BuilderSettings = {
    title: form.title,
    internalName: form.internalName ?? "",
    slug: form.slug,
    description: form.description,
    layout: form.layout,
    showProgress: form.showProgress,
    autoAdvance: form.autoAdvance,
    submitLabel: form.submitLabel,
    confirmTitle: form.confirmTitle,
    confirmMessage: form.confirmMessage,
    redirectUrl: form.redirectUrl ?? "",
    closedMessage: form.closedMessage,
    disclaimerOverride: form.disclaimerOverride ?? "",
    themeId: form.themeId ?? "",
    folderId: form.folderId ?? "",
    opensAt: form.opensAt?.toISOString() ?? "",
    closesAt: form.closesAt?.toISOString() ?? "",
    responseLimit: form.responseLimit?.toString() ?? "",
    brainSyncEnabled: form.brainSyncEnabled,
    autoPublish: form.autoPublish,
  };
  const endRules = cleanEndRules(fields, form.endRules);
  const url = await publicFormUrl(ctx.resolved.id, ctx.request.host, ctx.resolved.slug, form.slug);
  const embedUrl = await publicFormUrl(ctx.resolved.id, ctx.request.host, ctx.resolved.slug, form.slug, "embed");
  const embedCode = `<iframe src="${embedUrl}" title="${form.title.replace(/"/g, "&quot;")}" style="width:100%;border:0" height="600" id="pc-form-${form.id.slice(0, 8)}"></iframe>
<script>addEventListener("message",function(e){if(e.data&&e.data.type==="pubcommand-form:height"&&e.data.formId==="${form.id}"){document.getElementById("pc-form-${form.id.slice(0, 8)}").style.height=e.data.height+"px"}});</script>`;
  const tab = query.tab === "settings" || query.tab === "preview" ? query.tab : "build";

  const statusButton = (status: "OPEN" | "CLOSED" | "DRAFT", label: string, variant: "primary" | "secondary") => (
    <form action={setFormStatus}>
      <input type="hidden" name="formId" value={form.id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <Link href={form.folderId ? `/forms?folder=${form.folderId}` : "/forms"} className="text-accent">
          ← Forms
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">{form.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={form.status === "OPEN" ? "ok" : form.status === "CLOSED" ? "warn" : "neutral"}>{form.status === "OPEN" ? "Live" : form.status === "CLOSED" ? "Closed" : "Draft"}</Badge>
            <span>{fields.length} blocks</span>
            {form.internalName ? <span>· {form.internalName}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/forms/${form.id}/results`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold">
            Results
          </Link>
          <Link href={`/forms/${form.id}/connect`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold">
            Notify &amp; share
          </Link>
          {canWrite ? (
            <>
              {form.status !== "OPEN" ? statusButton("OPEN", "Publish", "primary") : statusButton("CLOSED", "Close form", "secondary")}
              {form.status === "CLOSED" ? statusButton("DRAFT", "Back to draft", "secondary") : null}
            </>
          ) : null}
        </div>
      </header>
      <Flash error={query.error} notice={query.notice} />
      {form.scheduleNote ? <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">Scheduled publish did not happen: {form.scheduleNote}</p> : null}
      {form.status === "DRAFT" && form.autoPublish && form.opensAt ? (
        <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">Publishes itself at {form.opensAt.toISOString().slice(0, 16).replace("T", " ")} UTC if it passes the publish checks.</p>
      ) : null}

      <section className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Public link {form.status === "OPEN" ? "" : "(works once published)"}</p>
          <CopyField value={url} label="Public link" />
          {form.status === "OPEN" ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-accent">
              Open the live form ↗
            </a>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Embed on a website</p>
          <CopyField value={embedCode} label="Embed code" multiline />
        </div>
      </section>

      <FormBuilder
        formId={form.id}
        initialFields={fields}
        initialSettings={settings}
        initialEndRules={endRules}
        themes={themes.map((theme) => ({ id: theme.id, name: theme.name, preview: previewTheme(theme, ctx.brand.name) }))}
        folders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
        canWrite={canWrite}
        initialTab={tab}
      />

      {canWrite ? (
        <details className="rounded-xl border border-line bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">More actions</summary>
          <div className="flex flex-wrap items-end gap-4 border-t border-line p-4">
            <form action={duplicateForm}>
              <input type="hidden" name="formId" value={form.id} />
              <Button type="submit" variant="secondary" size="sm">
                Duplicate form
              </Button>
            </form>
            <form action={deleteForm} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="formId" value={form.id} />
              <label className="text-sm">
                <span className="mb-1 block">Type the title to delete this form</span>
                <input name="confirm" className="pc-control w-64 max-w-full text-sm" autoComplete="off" />
              </label>
              <Button type="submit" variant="danger" size="sm">
                Delete form
              </Button>
            </form>
          </div>
        </details>
      ) : null}
    </div>
  );
}
