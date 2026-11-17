import { tenantDb } from "@pubcommand/db";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { promoPage } from "@/features/promos/guard";
import { brandPromoData, loadOverrides } from "@/features/promos/insights";
import { mergeEntity, removeEntityOverride, toggleEntityHidden } from "@/features/promos/insights-actions";
import { InsightsNav } from "@/features/promos/insights-view";
import { ENTITY_KINDS, ENTITY_LABELS, buildDirectory, type EntityKind } from "../../../../../../../../../modules/promo-studio/entities";

export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; show?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await promoPage(slug);
  if ("denied" in access) return access.denied === "notfound" ? notFound() : <Denied title={access.denied} />;
  const { ctx, writable } = access;
  const kind: EntityKind = (ENTITY_KINDS as readonly string[]).includes(query.kind ?? "") ? (query.kind as EntityKind) : "publisher";
  const showHidden = query.show === "hidden";
  const [{ promos, real }, overrides, overrideRows] = await Promise.all([
    brandPromoData(ctx.resolved.id, ctx.brand.id),
    loadOverrides(ctx.resolved.id, ctx.brand.id),
    tenantDb(ctx.resolved.id).promoEntityOverride.findMany({ where: { brandId: ctx.brand.id, kind }, orderBy: { createdAt: "desc" } }),
  ]);
  const entries = buildDirectory(
    kind,
    promos.map((p) => ({ id: p.id, title: p.title, publisher: p.publisher, gurus: p.gurus, product: p.product, score: p.effectivenessScore, realScore: real.get(p.id)?.score ?? null })),
    overrides,
  );
  const visible = entries.filter((e) => e.hidden === showHidden);
  const hiddenCount = entries.filter((e) => e.hidden).length;
  const singular = { publisher: "publisher", guru: "expert", product: "product" }[kind];

  return (
    <div className="space-y-5">
      <InsightsNav active="directory" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Publishers, experts and products seen across {ctx.brand.name}&apos;s promos, from the details the AI detected and people edited.
          Rename or merge duplicates here: promos show the corrected name, and each promo keeps its original value.
        </p>
      </header>
      <Flash error={query.error} notice={query.notice} />
      <nav className="flex flex-wrap gap-2" aria-label="Directory lists">
        {ENTITY_KINDS.map((k) => (
          <Link
            key={k}
            href={`/promo-studio/directory?kind=${k}`}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${k === kind ? "border-accent bg-accent text-white" : "border-line bg-white hover:bg-canvas"}`}
          >
            {ENTITY_LABELS[k]}
          </Link>
        ))}
        <Link href={`/promo-studio/directory?kind=${kind}${showHidden ? "" : "&show=hidden"}`} className="inline-flex min-h-11 items-center px-2 text-sm text-accent hover:underline">
          {showHidden ? "Back to visible" : `Hidden (${hiddenCount})`}
        </Link>
      </nav>

      <ul className="space-y-3">
        {visible.map((entry) => (
          <li key={entry.key} className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="pc-break font-semibold">{entry.name}</h2>
                {entry.aliases.length ? <p className="pc-break text-xs text-muted">Also seen as: {entry.aliases.join(", ")}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 text-xs">
                <Badge>{entry.promoCount} promo{entry.promoCount === 1 ? "" : "s"}</Badge>
                <Badge tone="accent" title="Average AI copy score">AI {entry.averageScore ?? "—"}</Badge>
                {entry.averageReal != null ? <Badge tone="ok" title="Average real-world score">Real {entry.averageReal}</Badge> : null}
              </div>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Promos</summary>
              <ul className="mt-1 space-y-1 text-sm">
                {entry.promos.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <Link href={`/promo-studio/${p.id}`} className="pc-break text-accent hover:underline">{p.title}</Link>
                    <span className="shrink-0 text-muted">{p.score?.toFixed(1) ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </details>
            {writable ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold text-accent">Correct</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <form action={mergeEntity} className="space-y-1">
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="from" value={entry.name} />
                    <label className="block text-xs font-medium">Rename to
                      <input name="into" required maxLength={200} defaultValue={entry.name} className="pc-control mt-1 w-full text-sm" />
                    </label>
                    <Button type="submit" size="sm" variant="secondary">Rename</Button>
                  </form>
                  <form action={mergeEntity} className="space-y-1">
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="from" value={entry.name} />
                    <label className="block text-xs font-medium">Merge into
                      <select name="into" required className="pc-control mt-1 w-full text-sm" defaultValue="">
                        <option value="" disabled>Choose a {singular}</option>
                        {entries.filter((other) => other.key !== entry.key).map((other) => (
                          <option key={other.key} value={other.name}>{other.name}</option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" size="sm" variant="secondary">Merge</Button>
                  </form>
                  <form action={mergeEntity} className="space-y-1">
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="mode" value="alias" />
                    <input type="hidden" name="from" value={entry.name} />
                    <label className="block text-xs font-medium">Add another spelling
                      <input name="into" required maxLength={200} placeholder="Alternate name" className="pc-control mt-1 w-full text-sm" />
                    </label>
                    <Button type="submit" size="sm" variant="secondary">Add alias</Button>
                  </form>
                </div>
                <form action={toggleEntityHidden} className="mt-2">
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="name" value={entry.name} />
                  <button className="text-sm text-muted hover:underline">{entry.hidden ? "Show in the directory again" : "Hide from the directory"}</button>
                </form>
              </details>
            ) : null}
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
            {showHidden ? "Nothing hidden." : `No ${ENTITY_LABELS[kind].toLowerCase()} yet. They appear as promos are analyzed or their details are filled in.`}
          </li>
        ) : null}
      </ul>

      {overrideRows.length ? (
        <section className="rounded-xl border border-line bg-white p-4 text-sm">
          <h2 className="font-semibold">Corrections ({ENTITY_LABELS[kind].toLowerCase()})</h2>
          <ul className="mt-2 divide-y divide-line">
            {overrideRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="pc-break">
                  {row.toName ? <>&ldquo;{row.fromName}&rdquo; shows as &ldquo;{row.toName}&rdquo;</> : null}
                  {row.hidden ? <>{row.toName ? " · " : ""}&ldquo;{row.fromName}&rdquo; hidden</> : null}
                  {!row.toName && !row.hidden ? <>&ldquo;{row.fromName}&rdquo; (no effect)</> : null}
                </span>
                {writable ? (
                  <form action={removeEntityOverride}>
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="overrideId" value={row.id} />
                    <button className="text-accent hover:underline" aria-label={`Undo correction for ${row.fromName}`}>Undo</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Undo puts back the names the promos detected.</p>
        </section>
      ) : null}
    </div>
  );
}
