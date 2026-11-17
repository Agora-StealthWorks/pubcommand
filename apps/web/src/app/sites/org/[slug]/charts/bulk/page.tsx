import { Button, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { startBulkForm } from "@/features/charts/actions";
import { chartsAccess } from "@/features/charts/context";
import { listBatches } from "@/features/charts/data";
import { marketStatus } from "@/features/charts/market";
import { listTemplates } from "@/features/charts/server";
import { getOrgContext } from "@/lib/org";
import { BULK_MAX_ROWS } from "../../../../../../../../../modules/charts/bulk";
import { SIZE_PRESETS, type SizePreset } from "../../../../../../../../../modules/charts/spec";

export default async function ChartBulkPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  const [templates, batches] = await Promise.all([listTemplates(access.scope.organizationId), listBatches(access.scope.organizationId, access.scope.brandId)]);
  const status = marketStatus();
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0">
        <Flash error={query.error} notice={query.notice} />
        {!status.massive && !status.tiingo ? (
          <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            Market data is not connected (MASSIVE_API_KEY / TIINGO_API_KEY), so ticker rows will fail. FRED rows (FRED:DGS10) still work.
          </p>
        ) : null}
        <form action={startBulkForm} className="space-y-4 rounded-xl border border-line bg-white p-4">
          <div>
            <Label htmlFor="bulk-rows">Rows</Label>
            <Textarea
              id="bulk-rows"
              name="rows"
              rows={10}
              required
              className="font-mono text-xs"
              placeholder={"ticker,period,title,headline,timeframe\nAAPL,5Y,,UP {gainRounded},weekly\nMSFT,2020-01-01..2024-12-31\nFRED:DGS10,10Y,10-year yield"}
            />
            <p className="mt-1 text-xs text-muted">
              One chart per line, up to {BULK_MAX_ROWS}: ticker, period (1Y, 5Y, YTD… or 2020-01-01..2024-12-31), title, headline, timeframe (daily, weekly, monthly). Blank cells use the
              template. Charts are built 4 at a time.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bulk-template">Design</Label>
              <select id="bulk-template" name="templateId" className="pc-control w-full">
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="bulk-size">Size</Label>
              <select id="bulk-size" name="size" className="pc-control w-full">
                {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((preset) => (
                  <option key={preset} value={preset}>
                    {SIZE_PRESETS[preset].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit">Build charts</Button>
        </form>
      </section>
      <aside className="min-w-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent runs</h2>
        <ul className="rounded-xl border border-line bg-white">
          {batches.map((batch) => (
            <li key={batch.id} className="border-b border-line last:border-0">
              <Link href={`/charts/bulk/${batch.id}`} className="block px-4 py-2.5 text-sm hover:bg-canvas">
                <span className="font-semibold">{batch.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                <span className="block text-xs text-muted">
                  {batch.status} · {batch.done}/{batch.total} made{batch.failed ? ` · ${batch.failed} failed` : ""}
                </span>
              </Link>
            </li>
          ))}
          {batches.length === 0 ? <li className="px-4 py-4 text-sm text-muted">No runs yet.</li> : null}
        </ul>
      </aside>
    </div>
  );
}
