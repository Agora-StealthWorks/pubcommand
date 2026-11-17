import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteExample, saveExample, syncBestPerformerExamples, toggleExample } from "@/features/packager/training-actions";
import { promoPage } from "@/features/promos/guard";
import { InsightsNav } from "@/features/promos/insights-view";
import { PACKAGE_COMPONENTS, componentSpec, preview } from "../../../../../../../../../modules/promo-studio/packager";
import { EXAMPLE_SOURCE_LABEL, EXAMPLES_PER_COMPONENT, coverage } from "../../../../../../../../../modules/promo-studio/training";

export default async function TrainingLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; edit?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await promoPage(slug);
  if ("denied" in access) return access.denied === "notfound" ? notFound() : <Denied title={access.denied} />;
  const { ctx, writable } = access;
  const all = await tenantDb(ctx.resolved.id).promoTrainingExample.findMany({ where: { brandId: ctx.brand.id }, orderBy: [{ kind: "asc" }, { updatedAt: "desc" }], take: 1000 });
  const kind = query.kind && componentSpec(query.kind) ? query.kind : "";
  const shown = kind ? all.filter((e) => e.kind === kind) : all;
  const counts = coverage(all);
  const editing = query.edit ? all.find((e) => e.id === query.edit) : undefined;

  return (
    <div className="space-y-5">
      <InsightsNav active="training" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Training library</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Copy {ctx.brand.name} has approved, kept as examples for the Packager. Each time it writes a component it reads up to {EXAMPLES_PER_COMPONENT} examples of the same type
          (same publication first, then best performers, then the newest) to learn the format and voice, never the claims. Approved components join automatically; best performers
          add their headlines. Switch an example off to keep it out of new packages.
        </p>
      </header>
      <Flash error={query.error} notice={query.notice} />

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Coverage</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          <li>
            <Link href="/promo-studio/training" className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm ${!kind ? "border-accent bg-accent text-white" : "border-line bg-white hover:bg-canvas"}`}>
              All · {all.length}
            </Link>
          </li>
          {PACKAGE_COMPONENTS.map((spec) => (
            <li key={spec.kind}>
              <Link
                href={`/promo-studio/training?kind=${spec.kind}`}
                className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm ${kind === spec.kind ? "border-accent bg-accent text-white" : "border-line bg-white hover:bg-canvas"} ${counts.get(spec.kind) ? "" : "text-muted"}`}
              >
                {spec.label} · {counts.get(spec.kind) ?? 0}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {writable ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <details className="rounded-xl border border-line bg-white p-4" open={Boolean(editing)}>
            <summary className="cursor-pointer text-sm font-semibold text-accent">{editing ? `Edit: ${editing.title}` : "Add an example by hand"}</summary>
            <form action={saveExample} className="mt-3 space-y-3">
              {editing ? <input type="hidden" name="exampleId" value={editing.id} /> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ex-kind">Component type</Label>
                  <select id="ex-kind" name="kind" defaultValue={editing?.kind ?? (kind || "vsl-lift-notes")} className="pc-control mt-1 w-full">
                    {PACKAGE_COMPONENTS.map((spec) => (
                      <option key={spec.kind} value={spec.kind}>{spec.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="ex-pub">Publication (optional)</Label>
                  <Input id="ex-pub" name="publication" maxLength={120} defaultValue={editing?.publication ?? ""} />
                </div>
              </div>
              <div>
                <Label htmlFor="ex-title">Title</Label>
                <Input id="ex-title" name="title" maxLength={200} required defaultValue={editing?.title ?? ""} />
              </div>
              <div>
                <Label htmlFor="ex-content">Copy</Label>
                <Textarea id="ex-content" name="content" rows={10} required defaultValue={editing?.content ?? ""} placeholder="Paste the finished copy. Use ### before each item when there are several." />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ex-tags">Tags (comma separated)</Label>
                  <Input id="ex-tags" name="tags" maxLength={400} defaultValue={editing?.tags.join(", ") ?? ""} />
                </div>
                <div>
                  <Label htmlFor="ex-note">Why it is a good example (optional)</Label>
                  <Input id="ex-note" name="note" maxLength={500} defaultValue={editing?.note ?? ""} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">{editing ? "Save example" : "Add example"}</Button>
                {editing ? <Link href="/promo-studio/training" className="inline-flex min-h-11 items-center px-3 text-sm text-muted hover:underline">Cancel</Link> : null}
              </div>
            </form>
          </details>
          <form action={syncBestPerformerExamples} className="space-y-2 rounded-xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold">Best performers</h2>
            <p className="text-sm text-muted">Add the opening (eyebrow, headline, subhead) of every starred or top-tier promo as a headline example. Ones that drop out are switched off.</p>
            <Button type="submit" variant="secondary">Update from best performers</Button>
          </form>
        </div>
      ) : null}

      <ul className="space-y-3">
        {shown.map((example) => (
          <li key={example.id} id={`ex-${example.id}`} className={`rounded-xl border border-line bg-white p-4 ${example.enabled ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">{example.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge tone="neutral">{componentSpec(example.kind)?.label ?? example.kind}</Badge>
                  <Badge tone={example.source === "best-performer" ? "ok" : example.source === "manual" ? "accent" : "neutral"}>{EXAMPLE_SOURCE_LABEL[example.source] ?? example.source}</Badge>
                  {example.publication ? <span>{example.publication}</span> : null}
                  <span>· {example.niche}</span>
                  {example.edited ? <span>· edited</span> : null}
                  {!example.enabled ? <Badge tone="warn">Off</Badge> : null}
                  {example.tags.map((tag) => (
                    <span key={tag} className="rounded bg-canvas px-1.5 py-0.5">#{tag}</span>
                  ))}
                </p>
                {example.note ? <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">{example.note}</p> : null}
              </div>
              {writable ? (
                <div className="flex flex-wrap gap-2">
                  <form action={toggleExample}>
                    <input type="hidden" name="exampleId" value={example.id} />
                    <input type="hidden" name="back" value={kind} />
                    <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas" aria-pressed={example.enabled}>
                      {example.enabled ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                  <Link href={`/promo-studio/training?edit=${example.id}${kind ? `&kind=${kind}` : ""}`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
                    Edit
                  </Link>
                  <form action={deleteExample}>
                    <input type="hidden" name="exampleId" value={example.id} />
                    <button type="submit" className="inline-flex min-h-11 items-center px-2 text-sm text-[#b42318] hover:underline">Delete</button>
                  </form>
                </div>
              ) : null}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted [overflow-wrap:anywhere]">{preview(example.content, 200)}</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 text-xs [overflow-wrap:anywhere]">{example.content}</pre>
            </details>
          </li>
        ))}
        {shown.length === 0 ? (
          <li className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
            No examples{kind ? " of this type" : ""} yet. Approve components in a package, update from best performers, or add one by hand.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
