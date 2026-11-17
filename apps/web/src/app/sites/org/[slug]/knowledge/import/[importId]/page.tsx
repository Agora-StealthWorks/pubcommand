import { Button } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { confirmVaultImport, discardVaultImport } from "@/features/brain/actions";
import { BrainAutoRefresh } from "@/features/brain/auto-refresh";
import { brainHref, loadBrain } from "@/features/brain/context";
import { isStaleRun, STALE_IMPORT_MS, type StoredReport } from "@/features/brain/vault-import";
import { SKIP_LABELS, type SkipReason } from "../../../../../../../../../../modules/knowledge/vault";

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export default async function ImportReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; importId: string }>;
  searchParams: Promise<{ scope?: string; error?: string }>;
}) {
  const { slug, importId } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug, query.scope);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  if (!ctx.canWrite) return <Denied title="Importing needs the knowledge.write permission" />;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) notFound();
  const job = await tenantDb(ctx.resolved.id).knowledgeImport.findFirst({
    where: { id: importId },
    select: { id: true, filename: true, size: true, brandId: true, status: true, report: true, error: true, updatedAt: true, createdAt: true },
  });
  if (!job) notFound();
  if (!ctx.mainAllowed && job.brandId !== ctx.scopeBrand?.id) notFound();
  const report = job.report as unknown as StoredReport | null;
  const target = job.brandId ? `${ctx.brandNames.get(job.brandId) ?? "Brand"} mini-brain` : "Main Brain";
  const stale = isStaleRun(job.status, job.updatedAt, STALE_IMPORT_MS);
  const working = (job.status === "QUEUED" || job.status === "RUNNING") && !stale;
  const skippedTotal = report ? Object.values(report.skipped).reduce((sum, n) => sum + (n ?? 0), 0) : 0;
  const scopeInput = ctx.brain.kind === "main" ? <input type="hidden" name="scope" value="main" /> : null;
  const willWrite = report ? report.create + report.update : 0;

  return (
    <div className="max-w-4xl">
      <Link href={brainHref("/knowledge/import", ctx.brain)} className="text-sm text-muted hover:text-ink">
        ← Import
      </Link>
      <h1 className="mt-2 break-all text-xl font-semibold tracking-tight">{job.filename}</h1>
      <p className="mt-1 text-sm text-muted">
        Into <strong className="text-ink">{target}</strong> · {(job.size / 1024 / 1024).toFixed(1)} MB · uploaded {job.createdAt.toISOString().slice(0, 10)}
        {report?.rootPrefix ? ` · top folder “${report.rootPrefix.replace(/\/$/, "")}” removed from paths` : ""}
      </p>
      <div className="mt-4">
        <Flash error={query.error ?? (job.status === "FAILED" ? job.error ?? "The import failed." : undefined)} />
      </div>

      {job.status === "DRY_RUN" ? (
        <div className="rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">Dry run: nothing has been imported yet. Check the numbers, then confirm.</div>
      ) : null}
      {working ? (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">
          Importing {willWrite.toLocaleString()} notes… <BrainAutoRefresh />
        </div>
      ) : null}
      {stale ? <Flash error="The import was interrupted (the server restarted). Upload the zip again." /> : null}
      {job.status === "DONE" && report?.result ? (
        <div className="rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm text-[#067647]">
          Imported: {report.result.created.toLocaleString()} new, {report.result.updated.toLocaleString()} updated, {report.result.unchanged.toLocaleString()} unchanged
          {report.result.failed ? `, ${report.result.failed} failed` : ""}.{" "}
          <Link href={brainHref("/knowledge", job.brandId ? { kind: "brand", brandId: job.brandId } : { kind: "main" })} className="font-semibold underline">
            Open the Brain
          </Link>
        </div>
      ) : null}

      {report ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Files in zip" value={report.files} />
            <Stat label="New notes" value={report.create} tone="text-[#067647]" />
            <Stat label="Updated" value={report.update} tone="text-accent" />
            <Stat label="Unchanged" value={report.unchanged} />
            <Stat label="Skipped files" value={skippedTotal} tone="text-[#b54708]" />
            <Stat label="In another Brain" value={report.conflict + report.deleted} />
          </div>

          {job.status === "DRY_RUN" || job.status === "FAILED" ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <form action={confirmVaultImport}>
                {scopeInput}
                <input type="hidden" name="importId" value={job.id} />
                <Button type="submit" className="w-full sm:w-auto" disabled={willWrite === 0}>
                  {willWrite === 0 ? "Nothing to import" : `Import ${willWrite.toLocaleString()} notes into ${target}`}
                </Button>
              </form>
              <form action={discardVaultImport}>
                {scopeInput}
                <input type="hidden" name="importId" value={job.id} />
                <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                  Discard
                </Button>
              </form>
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="min-w-0">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Notes by top folder</h2>
              <TableScroll>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {report.folders.map((row) => (
                      <tr key={row.folder}>
                        <td className="break-all px-3 py-2">{row.folder}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.notes.toLocaleString()}</td>
                      </tr>
                    ))}
                    {report.folders.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-muted">No Markdown notes found.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </TableScroll>
            </section>
            <section className="min-w-0">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Skipped, by reason</h2>
              <TableScroll>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {(Object.entries(report.skipped) as [SkipReason, number][]).map(([reason, count]) => (
                      <tr key={reason}>
                        <td className="px-3 py-2">{SKIP_LABELS[reason] ?? reason}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{count.toLocaleString()}</td>
                      </tr>
                    ))}
                    {report.conflict ? (
                      <tr>
                        <td className="px-3 py-2">Already imported into another Brain (left there)</td>
                        <td className="px-3 py-2 text-right tabular-nums">{report.conflict.toLocaleString()}</td>
                      </tr>
                    ) : null}
                    {report.deleted ? (
                      <tr>
                        <td className="px-3 py-2">Deleted in the Brain since the last import (left deleted)</td>
                        <td className="px-3 py-2 text-right tabular-nums">{report.deleted.toLocaleString()}</td>
                      </tr>
                    ) : null}
                    {skippedTotal + report.conflict + report.deleted === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-muted">Nothing skipped.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </TableScroll>
            </section>
          </div>

          {report.skippedFiles.length > 0 ? (
            <details className="mt-6 rounded-xl border border-line bg-white" open={report.skippedFiles.some((file) => file.reason === "secret")}>
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                Skipped files ({report.skippedFiles.length.toLocaleString()}
                {report.truncated ? "+" : ""}, hidden files not listed)
              </summary>
              <ul className="max-h-96 divide-y divide-line overflow-y-auto border-t border-line text-sm">
                {[...report.skippedFiles]
                  .sort((a, b) => (a.reason === "secret" ? -1 : 0) - (b.reason === "secret" ? -1 : 0))
                  .map((file) => (
                    <li key={file.path} className="px-4 py-2">
                      <span className="block break-all">{file.path}</span>
                      <span className={`text-xs ${file.reason === "secret" ? "font-semibold text-[#b42318]" : "text-muted"}`}>
                        {SKIP_LABELS[file.reason]}
                        {file.detail ? `: ${file.detail}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          {report.conflictFiles.length > 0 ? (
            <details className="mt-3 rounded-xl border border-line bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Already in another Brain ({report.conflictFiles.length.toLocaleString()})</summary>
              <ul className="max-h-72 divide-y divide-line overflow-y-auto border-t border-line text-sm">
                {report.conflictFiles.map((path) => (
                  <li key={path} className="break-all px-4 py-2">
                    {path}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
