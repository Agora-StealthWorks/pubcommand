import { Button, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { packagerAccess } from "@/features/packager/access";
import { regenerateComponent, removeComponent, restoreVersion, saveComponent } from "@/features/packager/actions";
import { loadPackage, loadVersions } from "@/features/packager/data";
import { CopyPreview, FlagList, GenBadge, StatusBadge } from "@/features/packager/views";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { TIER_LABEL, componentSpec } from "../../../../../../../../../../../../modules/promo-studio/packager";

const SOURCE_LABEL: Record<string, string> = { ai: "Written by AI", regenerate: "Rewritten by AI", edit: "Edited", restore: "Restored" };

export default async function ComponentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; promoId: string; packageId: string; componentId: string }>;
  searchParams: Promise<{ error?: string; notice?: string; view?: string; v?: string }>;
}) {
  const { slug, promoId, packageId, componentId } = await params;
  const query = await searchParams;
  const access = await packagerAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, writable, approver } = access;
  const loaded = await loadPackage(ctx.resolved.id, ctx.brand.id, promoId, packageId);
  const component = loaded?.components.find((c) => c.id === componentId);
  if (!loaded || !component) notFound();
  const spec = componentSpec(component.kind);
  const versions = await loadVersions(ctx.resolved.id, component.id);
  const base = `/promo-studio/${loaded.promo.id}/package/${loaded.pkg.id}`;
  const here = `${base}/${component.id}`;
  const busy = component.genStatus === "QUEUED" || component.genStatus === "RUNNING";
  const view = writable && query.view === "edit" && !busy ? "edit" : "preview";
  const shown = query.v ? versions.find((v) => String(v.version) === query.v) : undefined;
  const index = loaded.components.findIndex((c) => c.id === component.id);
  const prev = loaded.components[index - 1];
  const next = loaded.components[index + 1];
  const hidden = (
    <>
      <input type="hidden" name="promoId" value={loaded.promo.id} />
      <input type="hidden" name="packageId" value={loaded.pkg.id} />
      <input type="hidden" name="componentId" value={component.id} />
    </>
  );

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Link href={base} className="[overflow-wrap:anywhere] text-sm text-accent hover:underline">
          ← {loaded.pkg.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{component.label}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <StatusBadge status={component.status} />
              <GenBadge status={component.genStatus} />
              <span>
                {component.quantity} {component.quantity === 1 ? "item" : "items"}
                {component.currentVersion ? ` · version ${component.currentVersion}` : ""}
              </span>
              {spec ? <span title={`Effort: ${spec.effort}`}>· {TIER_LABEL[spec.tier]}, {spec.effort} effort</span> : null}
            </p>
            {component.examplesUsed.length ? (
              <p className="[overflow-wrap:anywhere] mt-1 text-xs text-muted">
                Learned from {component.examplesUsed.length} training example{component.examplesUsed.length === 1 ? "" : "s"}: {component.examplesUsed.map((e) => e.title).join(" · ")}{" "}
                <Link href="/promo-studio/training" className="text-accent hover:underline">Training library</Link>
              </p>
            ) : null}
          </div>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Other components">
            {component.content.trim() ? (
              <a href={`${here}/export`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 font-semibold hover:bg-canvas">
                Word file
              </a>
            ) : null}
            {prev ? (
              <Link href={`${base}/${prev.id}`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 hover:bg-canvas">
                ← Prev
              </Link>
            ) : null}
            {next ? (
              <Link href={`${base}/${next.id}`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 hover:bg-canvas">
                Next →
              </Link>
            ) : null}
          </nav>
        </div>
      </header>

      <Flash error={query.error} notice={query.notice} />
      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          <span>
            Writing… usually under two minutes. This page updates by itself. <AutoRefresh />
          </span>
        </div>
      ) : null}
      {component.genStatus === "FAILED" && component.genError ? (
        <p className="[overflow-wrap:anywhere] rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Not written: {component.genError}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-xl border border-line bg-white p-5">
          {shown ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-canvas px-3 py-2 text-sm">
                <span>
                  Viewing version {shown.version} · {SOURCE_LABEL[shown.source] ?? shown.source}
                </span>
                <span className="flex gap-3">
                  {writable && shown.version !== component.currentVersion && !busy ? (
                    <form action={restoreVersion}>
                      {hidden}
                      <input type="hidden" name="versionId" value={shown.id} />
                      <button className="font-semibold text-accent hover:underline">Restore this version</button>
                    </form>
                  ) : null}
                  <Link href={here} className="text-accent hover:underline">Back to current</Link>
                </span>
              </div>
              <CopyPreview content={shown.content} />
            </>
          ) : view === "edit" ? (
            <form action={saveComponent} className="space-y-3">
              {hidden}
              <div>
                <Label htmlFor="content">Copy (Markdown: ### starts an item, **Label:** marks a field)</Label>
                <Textarea id="content" name="content" rows={28} defaultValue={component.content} className="font-mono text-[13px] leading-6" />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="status">Status</Label>
                  <select id="status" name="status" className="pc-control" defaultValue={component.status}>
                    <option value="DRAFT">Draft</option>
                    <option value="NEEDS_EDITS">Needs edits</option>
                    {approver || component.status === "APPROVED" ? <option value="APPROVED">Approved</option> : null}
                  </select>
                </div>
                <Button type="submit">Save</Button>
                <Link href={here} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
                  Cancel
                </Link>
              </div>
            </form>
          ) : (
            <>
              {writable && !busy ? (
                <div className="mb-4 flex justify-end">
                  <Link href={`${here}?view=edit`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
                    Edit copy
                  </Link>
                </div>
              ) : null}
              <CopyPreview content={component.content} />
            </>
          )}
        </section>

        <aside className="space-y-4">
          {writable && view !== "edit" ? (
            <section className="rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold">Status</h2>
              <form action={saveComponent} className="mt-2 flex flex-wrap gap-2">
                {hidden}
                <select name="status" aria-label="Status" className="pc-control min-w-0 flex-1" defaultValue={component.status} disabled={busy}>
                  <option value="DRAFT">Draft</option>
                  <option value="NEEDS_EDITS">Needs edits</option>
                  {approver || component.status === "APPROVED" ? <option value="APPROVED">Approved</option> : null}
                </select>
                <Button type="submit" variant="secondary" disabled={busy}>Set</Button>
              </form>
              {!approver ? <p className="mt-2 text-xs text-muted">Approving needs promo.approve.</p> : null}
            </section>
          ) : null}

          {writable ? (
            <section className="rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold">{component.content.trim() ? "Rewrite with feedback" : "Write it"}</h2>
              <form action={regenerateComponent} className="mt-2 space-y-2">
                {hidden}
                {component.content.trim() ? (
                  <Textarea name="feedback" rows={4} maxLength={2000} placeholder="What to change, e.g. stronger subject lines, less hype, shorter bodies" aria-label="Feedback" />
                ) : null}
                {spec && spec.maxQty > 1 ? (
                  <label className="flex items-center justify-between gap-2 text-sm">
                    How many
                    <input type="number" name="quantity" min={spec.minQty} max={spec.maxQty} defaultValue={component.quantity} className="pc-control w-20" />
                  </label>
                ) : null}
                <Button type="submit" variant="secondary" disabled={busy} className="w-full">
                  {component.content.trim() ? "Rewrite" : "Write"}
                </Button>
                <p className="text-xs text-muted">The current copy is kept as a version.</p>
              </form>
            </section>
          ) : null}

          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold">Claims check</h2>
            <div className="mt-2">
              <FlagList flags={component.flags} />
            </div>
          </section>

          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold">Versions</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {versions.map((v) => (
                <li key={v.id} className="py-2">
                  <Link href={v.version === component.currentVersion ? here : `${here}?v=${v.version}`} className="flex justify-between gap-2 hover:text-accent">
                    <span>
                      v{v.version} · {SOURCE_LABEL[v.source] ?? v.source}
                      {v.version === component.currentVersion ? <span className="text-muted"> (current)</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{v.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  </Link>
                  {v.feedback ? <p className="[overflow-wrap:anywhere] text-xs text-muted">“{v.feedback}”</p> : null}
                </li>
              ))}
              {versions.length === 0 ? <li className="py-2 text-muted">No versions yet.</li> : null}
            </ul>
          </section>

          {writable ? (
            <form action={removeComponent}>
              {hidden}
              <Button type="submit" variant="danger" className="w-full">Remove from package</Button>
            </form>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
