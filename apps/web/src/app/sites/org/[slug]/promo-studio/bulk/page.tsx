import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { listPromos } from "@/features/promos/data";
import { promoPage } from "@/features/promos/guard";
import { bulkQueueRows } from "@/features/promos/bulk-queue";
import { bulkReanalyze, cancelBulkQueue } from "@/features/promos/insights-actions";
import { InsightsNav } from "@/features/promos/insights-view";
import { SelectAll } from "@/features/promos/select-all";
import { BULK_CONCURRENCY, BULK_MAX, queueSummary } from "../../../../../../../../../modules/promo-studio/queue";

const FILTERS = [
  ["all", "All"],
  ["failed", "Failed"],
  ["none", "Not analyzed"],
  ["done", "Analyzed"],
] as const;

const STATUS_TONE: Record<string, "neutral" | "warn" | "danger" | "ok"> = { DONE: "ok", FAILED: "danger", QUEUED: "warn", RUNNING: "warn", NONE: "neutral" };

export default async function BulkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await promoPage(slug);
  if ("denied" in access) return access.denied === "notfound" ? notFound() : <Denied title={access.denied} />;
  const { ctx, writable } = access;
  const all = await listPromos(ctx.resolved.id, ctx.brand.id, "");
  const filter = FILTERS.some(([key]) => key === query.filter) ? query.filter! : "all";
  const promos = all.filter((p) => filter === "all" || (filter === "failed" && p.status === "FAILED") || (filter === "none" && p.status === "NONE") || (filter === "done" && p.status === "DONE"));
  const queue = await bulkQueueRows(ctx.resolved.id, ctx.brand.id);
  const counts = queueSummary(queue);
  const running = counts.RUNNING;
  const queued = counts.QUEUED;
  const lastJob = new Map(queue.map((row) => [row.promoId, row]));

  return (
    <div className="space-y-5">
      <InsightsNav active="bulk" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk re-analyze</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Pick promos to analyze again, for example after you add training notes. They queue up and {BULK_CONCURRENCY} run at a time; up to {BULK_MAX} per batch. The queue is
          saved, so a server restart picks up where it left off. Each re-analysis refreshes the promo&apos;s Brain note instead of adding another.
        </p>
      </header>
      <Flash error={query.error} notice={query.notice} />
      {!aiConfigured() ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          The AI key is not set, so queued promos will fail with that reason. Add <code>ANTHROPIC_API_KEY</code> first.
        </p>
      ) : null}
      {running + queued > 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          <span className="min-w-0 flex-1">
            {running} running · {queued} waiting{counts.DONE || counts.FAILED ? ` · ${counts.DONE} done, ${counts.FAILED} failed today` : ""}. <AutoRefresh everyMs={5000} />
          </span>
          {writable && queued ? (
            <form action={cancelBulkQueue}>
              <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-[#c7d7fe] bg-white px-3 text-sm font-semibold">Stop waiting ones</button>
            </form>
          ) : null}
        </div>
      ) : counts.DONE || counts.FAILED ? (
        <p className="text-sm text-muted">Last 24 hours: {counts.DONE} re-analyzed, {counts.FAILED} failed.</p>
      ) : null}
      <nav className="flex flex-wrap gap-2" aria-label="Filter promos">
        {FILTERS.map(([key, label]) => (
          <Link key={key} href={`/promo-studio/bulk?filter=${key}`} className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${filter === key ? "border-accent bg-accent text-white" : "border-line bg-white hover:bg-canvas"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <form action={bulkReanalyze} className="space-y-3">
        {writable ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SelectAll name="promoId" />
            <Button type="submit">Re-analyze selected</Button>
          </div>
        ) : null}
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {promos.map((promo) => {
            const busy = promo.status === "QUEUED" || promo.status === "RUNNING";
            return (
              <li key={promo.id} className="flex items-center gap-3 px-4 py-2.5">
                {writable ? (
                  <input type="checkbox" name="promoId" value={promo.id} disabled={busy} aria-label={`Select ${promo.title}`} className="h-5 w-5 shrink-0" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <Link href={`/promo-studio/${promo.id}`} className="block truncate text-sm font-medium text-accent hover:underline">{promo.title}</Link>
                  <span className="block truncate text-xs text-muted">{promo.createdAt.toISOString().slice(0, 10)}{promo.publisher ? ` · ${promo.publisher}` : ""}</span>
                  {lastJob.get(promo.id)?.status === "FAILED" && lastJob.get(promo.id)?.error ? (
                    <span className="block truncate text-xs text-[#b42318]" title={lastJob.get(promo.id)!.error!}>Queue: {lastJob.get(promo.id)!.error}</span>
                  ) : null}
                </span>
                <Badge tone={STATUS_TONE[promo.status] ?? "neutral"}>{promo.status === "NONE" ? "not analyzed" : promo.status.toLowerCase()}</Badge>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums">{promo.score?.toFixed(1) ?? "—"}</span>
              </li>
            );
          })}
          {promos.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No promos here.</li> : null}
        </ul>
      </form>
    </div>
  );
}
