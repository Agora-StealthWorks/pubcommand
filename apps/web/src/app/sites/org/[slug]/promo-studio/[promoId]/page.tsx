import { brandProfile, can } from "@pubcommand/core";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { addPromoFile, deletePromo, reanalyzePromo, removePromoFile, updatePromoDetails, updatePromoTraining } from "@/features/promos/actions";
import { ComplianceTab, CubTab, HeadlineTab, OfferTab, OutlineTab, OverviewTab, SixteenWordTab, TeaseTab } from "@/features/promos/analysis-view";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { loadPromo } from "@/features/promos/data";
import { PromoDetailsFields } from "@/features/promos/details-fields";
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

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="pc-break text-2xl font-semibold tracking-tight">
            {promo.isBestPerformer ? <span title="Best performer">★ </span> : null}
            {promo.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {promo.publisher ? <span>{promo.publisher}</span> : null}
            {promo.gurus.length ? <span>· {promo.gurus.join(", ")}</span> : null}
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
        writable ? (
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
        )
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
