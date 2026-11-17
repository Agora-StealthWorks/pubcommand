import { brandProfile, can } from "@pubcommand/core";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { addPromoFile, deletePromo, reanalyzePromo, removePromoFile, updatePromoDetails, updatePromoTraining } from "@/features/promos/actions";
import { ComplianceTab, CubTab, HeadlineTab, OfferTab, OutlineTab, OverviewTab, SixteenWordTab, TeaseTab } from "@/features/promos/analysis-view";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { loadPromo } from "@/features/promos/data";
import { listPackages } from "@/features/packager/data";
import { PackageTab } from "@/features/packager/views";
import { PromoDetailsFields } from "@/features/promos/details-fields";
import { bestPerformers, calibrationPoints, promoInsights, trainingPairs } from "@/features/promos/insights";
import { BestPerformers, CalibrationChart, TierBadge, fmtMoney, fmtNumber, fmtPercent } from "@/features/promos/insights-view";
import { TableScroll } from "@/components/table-scroll";
import { displayEntities } from "../../../../../../../../../modules/promo-studio/entities";
import { describeTier, enrich, percentileScore } from "../../../../../../../../../modules/promo-studio/performance";
import { BAND_LABELS, MIN_TRAINING_PAIRS, scoreVector, similarOutcomes } from "../../../../../../../../../modules/promo-studio/similar";
import { getOrgContext } from "@/lib/org";

const ANALYSIS_TABS = [
  ["overview", "Overview"],
  ["headline", "Headline"],
  ["outline", "Outline"],
  ["sixteen", "16-Word"],
  ["cub", "CUB"],
  ["offer", "Offer"],
  ["tease", "Tease"],
  ["compliance", "Compliance"],
] as const;
const OTHER_TABS = [
  ["package", "Package"],
  ["results", "Results"],
  ["copy", "Copy"],
  ["details", "Details"],
  ["files", "Files"],
  ["training", "Training"],
  ["history", "History"],
] as const;

function kb(size: number) {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export default async function PromoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; promoId: string }>;
  searchParams: Promise<{ tab?: string; error?: string; notice?: string }>;
}) {
  const { slug, promoId } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brand) notFound();
  const loaded = await loadPromo(ctx.resolved.id, ctx.brand.id, promoId);
  if (!loaded) notFound();
  const { promo, current, history, files } = loaded;
  const writable = can(ctx.subject, "promo.write", ctx.scope);
  const busy = promo.analysisStatus === "QUEUED" || promo.analysisStatus === "RUNNING";
  const tab = query.tab ?? (current ? "overview" : "copy");
  const result = current?.result ?? null;
  const tabs = [...(result ? ANALYSIS_TABS : []), ...OTHER_TABS];
  const [packages, insights] = await Promise.all([
    tab === "package" ? listPackages(ctx.resolved.id, promo.id) : Promise.resolve([]),
    promoInsights(ctx.resolved.id, ctx.brand.id, promo.id),
  ]);
  const shown = displayEntities(promo, insights.overrides);
  const perf = insights.performance.find((row) => row.tier) ?? insights.performance[0] ?? null;
  const similar = tab === "results" ? similarOutcomes({ id: promo.id, vector: scoreVector(result?.scores), promoType: promo.promoType }, await trainingPairs(ctx.resolved.id, ctx.brand.id)) : null;
  const [calibration, gallery] = tab === "training" ? await Promise.all([calibrationPoints(ctx.resolved.id, ctx.brand.id), bestPerformers(ctx.resolved.id, ctx.brand.id)]) : [[], []];
  const realScore = promo.performanceScore ?? (perf?.tier ? percentileScore(perf.percentile) : null);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="pc-break text-2xl font-semibold tracking-tight">
            {promo.isBestPerformer ? <span title="Best performer">★ </span> : null}
            {promo.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {shown.publisher ? <span title={shown.publisher.original !== shown.publisher.name ? `Detected as ${shown.publisher.original}` : undefined}>{shown.publisher.name}</span> : null}
            {shown.gurus.length ? (
              <span title={shown.gurus.some((g) => g.original !== g.name) ? `Detected as ${promo.gurus.join(", ")}` : undefined}>· {shown.gurus.map((g) => g.name).join(", ")}</span>
            ) : null}
            {perf?.tier ? <TierBadge tier={perf.tier} title={describeTier(perf)} /> : null}
            {promo.promoType ? <Badge>{promo.promoType}</Badge> : null}
            {promo.promoStatus ? <Badge>{promo.promoStatus}</Badge> : null}
            {promo.fkReadingEase != null ? (
              <span title="Flesch reading ease (higher is easier) and grade level">
                · Reading ease {promo.fkReadingEase} (grade {promo.fkGradeLevel})
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {promo.effectivenessScore != null ? (
            <div className="rounded-xl border border-line bg-white px-4 py-2 text-center">
              <p className="text-2xl font-semibold leading-none">{promo.effectivenessScore.toFixed(1)}</p>
              <p className="mt-1 text-[11px] text-muted">score /10</p>
            </div>
          ) : null}
          {current ? (
            <a href={`/promo-studio/${promo.id}/export`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
              Word export
            </a>
          ) : null}
          {writable && !busy ? (
            <form action={reanalyzePromo}>
              <input type="hidden" name="promoId" value={promo.id} />
              <Button type="submit" variant="secondary">
                {current ? "Re-analyze" : "Analyze"}
              </Button>
            </form>
          ) : null}
        </div>
      </header>

      <Flash error={query.error} notice={query.notice} />
      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          Analyzing… usually 30 to 90 seconds. This page updates by itself. <AutoRefresh />
        </div>
      ) : null}
      {promo.analysisStatus === "FAILED" && promo.analysisError ? (
        <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Analysis failed: {promo.analysisError}</p>
      ) : null}

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-line" aria-label="Promo sections">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/promo-studio/${promo.id}?tab=${key}`}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${tab === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
            {key === "cub" && result ? <span className="ml-1 text-xs text-muted">{result.cub.length}</span> : null}
            {key === "compliance" && result?.compliance.length ? <span className="ml-1 rounded-full bg-[#fee4e2] px-1.5 text-xs text-[#912018]">{result.compliance.length}</span> : null}
            {key === "files" ? <span className="ml-1 text-xs text-muted">{files.length}</span> : null}
          </Link>
        ))}
      </nav>

      {result && tab === "overview" ? <OverviewTab result={result} score={promo.effectivenessScore} /> : null}
      {result && tab === "headline" ? <HeadlineTab result={result} /> : null}
      {result && tab === "outline" ? <OutlineTab result={result} /> : null}
      {result && tab === "sixteen" ? <SixteenWordTab result={result} /> : null}
      {result && tab === "cub" ? <CubTab result={result} sourceText={promo.sourceText} /> : null}
      {result && tab === "offer" ? <OfferTab result={result} /> : null}
      {result && tab === "tease" ? <TeaseTab result={result} /> : null}
      {result && tab === "compliance" ? <ComplianceTab result={result} rules={brandProfile(ctx.brand).complianceRules} /> : null}

      {tab === "package" ? <PackageTab promoId={promo.id} packages={packages} writable={writable} analyzed={Boolean(current)} /> : null}

      {tab === "results" ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="font-semibold">Real-world results</h2>
            {insights.performance.length ? (
              <div className="mt-3 space-y-4">
                {insights.performance.map((row) => {
                  const e = enrich(row);
                  return (
                    <div key={row.id} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-xs">{row.promoCode}</span>
                        <TierBadge tier={row.tier} />
                        <span className="text-muted">{describeTier(row)}</span>
                      </div>
                      <TableScroll>
                        <table className="w-full min-w-[560px] text-sm">
                          <thead className="bg-canvas text-left text-xs text-muted">
                            <tr>{["Sent", "Clicks", "Orders", "Revenue", "Cost", "Click rate", "Conv.", "Rev / 1K sent", "ROI"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            <tr className="tabular-nums">
                              <td className="px-3 py-2">{fmtNumber(row.sent)}</td>
                              <td className="px-3 py-2">{fmtNumber(row.clicks)}</td>
                              <td className="px-3 py-2">{fmtNumber(row.orders)}</td>
                              <td className="px-3 py-2">{fmtMoney(row.revenue)}</td>
                              <td className="px-3 py-2">{fmtMoney(row.cost)}</td>
                              <td className="px-3 py-2">{fmtPercent(e.clickRate, 2)}</td>
                              <td className="px-3 py-2">{fmtPercent(e.conversion, 2)}</td>
                              <td className="px-3 py-2">{fmtMoney(e.revenuePerThousand)}</td>
                              <td className="px-3 py-2">{fmtPercent(e.roi, 0)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </TableScroll>
                      <p className="text-xs text-muted">
                        {row.startDate ? `${row.startDate.toISOString().slice(0, 10)}${row.endDate ? ` → ${row.endDate.toISOString().slice(0, 10)}` : ""} · ` : ""}
                        Percentile score {percentileScore(row.percentile) ?? "—"}/10 (1 + 9 × percentile). Tiers are statistics within this promo type, not grades.
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No results matched yet. {promo.promoCode ? `Import a sheet with code ${promo.promoCode}` : "Add this promo's code on the Details tab, then import results"} on the{" "}
                <Link href="/promo-studio/performance" className="text-accent hover:underline">Performance</Link> page.
              </p>
            )}
          </section>
          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="font-semibold">Similar-promo outcomes</h2>
            {similar?.shown ? (
              <div className="mt-2 space-y-3 text-sm">
                <p>
                  {similar.agreement.count} of the {similar.agreement.k} promos with the closest copy profile landed in the{" "}
                  <strong>{BAND_LABELS[similar.band]}</strong> real-world band.
                </p>
                <ul className="divide-y divide-line">
                  {similar.neighbours.map((n) => (
                    <li key={n.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <Link href={`/promo-studio/${n.id}?tab=results`} className="pc-break text-accent hover:underline">{n.title}</Link>
                      <span className="text-muted">real {n.outcome} · distance {n.distance}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  From {similar.pairs} promos with real results. On this data the method is right {Math.round(similar.accuracy * 100)}% of the time against{" "}
                  {Math.round(similar.baseRate * 100)}% for always guessing the commonest band. Copy is only part of results; list, offer, price and timing are not modeled.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">{similar?.reason ?? `Shown once ${MIN_TRAINING_PAIRS} promos have results.`}</p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "copy" ? (
        <section className="rounded-xl border border-line bg-white p-5">
          {promo.sourceText ? (
            <div className="max-h-[75vh] overflow-y-auto whitespace-pre-wrap text-sm leading-7">{promo.sourceText}</div>
          ) : (
            <p className="text-sm text-muted">Scanned PDF — the AI reads the file directly. Download it from Files.</p>
          )}
        </section>
      ) : null}

      {tab === "details" ? (
        writable ? (
          <form action={updatePromoDetails} className="max-w-3xl space-y-4 rounded-xl border border-line bg-white p-5">
            <input type="hidden" name="promoId" value={promo.id} />
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={promo.title} maxLength={200} />
            </div>
            <PromoDetailsFields values={promo} />
            <Button type="submit">Save details</Button>
          </form>
        ) : (
          <p className="text-sm text-muted">You can't edit details.</p>
        )
      ) : null}

      {tab === "files" ? (
        <section className="max-w-3xl space-y-4 rounded-xl border border-line bg-white p-5">
          <ul className="divide-y divide-line">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <a href={`/promo-studio/${promo.id}/files/${file.id}`} className="pc-break font-medium text-accent hover:underline">
                  {file.filename}
                </a>
                <span className="flex items-center gap-3 text-muted">
                  {file.kind === "source" ? <Badge tone="accent">Original</Badge> : file.category ? <Badge>{file.category}</Badge> : null}
                  {kb(file.size)}
                  {writable && file.kind !== "source" ? (
                    <form action={removePromoFile}>
                      <input type="hidden" name="promoId" value={promo.id} />
                      <input type="hidden" name="fileId" value={file.id} />
                      <button className="text-[#b42318] hover:underline">Remove</button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
            {files.length === 0 ? <li className="py-2 text-sm text-muted">No files. Pasted promos have no original.</li> : null}
          </ul>
          {writable ? (
            <form action={addPromoFile} className="space-y-3 border-t border-line pt-4">
              <input type="hidden" name="promoId" value={promo.id} />
              <p className="text-sm font-semibold">Add a supporting file</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <input name="file" type="file" className="text-sm" required />
                <select name="category" className="pc-control" defaultValue="Order form">
                  {["Order form", "Email", "Ad", "Landing page", "Research", "Results", "Other"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="secondary">Upload</Button>
            </form>
          ) : null}
        </section>
      ) : null}

      {tab === "training" ? (
        <div className="space-y-4">
        <div className="grid max-w-3xl grid-cols-3 gap-2 text-center">
          {[["AI score", promo.effectivenessScore], ["Your score", promo.myScore], ["Real world", realScore]].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-line bg-white px-2 py-3">
              <p className="text-xl font-semibold">{typeof value === "number" ? value.toFixed(1) : "—"}</p>
              <p className="text-[11px] text-muted">{label as string}</p>
            </div>
          ))}
        </div>
        {writable ? (
          <form action={updatePromoTraining} className="max-w-3xl space-y-4 rounded-xl border border-line bg-white p-5">
            <input type="hidden" name="promoId" value={promo.id} />
            <p className="text-sm text-muted">
              Your judgment and real results. Notes here are shown to the AI on future reviews for {ctx.brand.name}, so it
              calibrates to how this brand's promos actually perform.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="myScore">Your score (1–10)</Label>
                <Input id="myScore" name="myScore" inputMode="decimal" defaultValue={promo.myScore ?? ""} />
              </div>
              <div>
                <Label htmlFor="performanceScore">Real-world performance (1–10)</Label>
                <Input id="performanceScore" name="performanceScore" inputMode="decimal" defaultValue={promo.performanceScore ?? ""} />
                <p className="mt-1 text-xs text-muted">Leave blank to use the imported results percentile.</p>
              </div>
            </div>
            <div>
              <Label htmlFor="trainingNotes">Why — what the AI got right or wrong</Label>
              <Textarea id="trainingNotes" name="trainingNotes" rows={6} defaultValue={promo.trainingNotes ?? ""} maxLength={4000} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isBestPerformer" defaultChecked={promo.isBestPerformer} className="h-4 w-4" />
              Best performer (gold standard)
            </label>
            <Button type="submit">Save training</Button>
          </form>
        ) : (
          <p className="text-sm text-muted">You can't edit training.</p>
        )}
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="mb-3 font-semibold">Calibration for {ctx.brand.name}</h2>
          <CalibrationChart points={calibration} highlightId={promo.id} />
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">Best performers</h2>
          <BestPerformers items={gallery} />
        </section>
        </div>
      ) : null}

      {tab === "history" ? (
        <section className="max-w-3xl space-y-4 rounded-xl border border-line bg-white p-5">
          <ul className="divide-y divide-line text-sm">
            {history.map((run) => (
              <li key={run.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  Version {run.version} · {run.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
                <span className="text-muted">
                  {run.score != null ? `${run.score.toFixed(1)}/10 · ` : ""}
                  {run.model}
                </span>
              </li>
            ))}
            {history.length === 0 ? <li className="py-2 text-muted">Not analyzed yet.</li> : null}
          </ul>
          <p className="text-xs text-muted">
            Uploaded {promo.createdAt.toISOString().slice(0, 10)} · {promo.inputType}
            {promo.filename ? ` · ${promo.filename}` : ""}
          </p>
          {writable ? (
            <form action={deletePromo} className="border-t border-line pt-4">
              <input type="hidden" name="promoId" value={promo.id} />
              <Button type="submit" variant="danger">Delete promo</Button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
