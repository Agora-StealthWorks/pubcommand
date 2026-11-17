import { Denied, Flash } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { ImportForm } from "@/features/trackrecord/import-form";
import { listPortfolios } from "@/features/trackrecord/server";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const portfolios = await listPortfolios(access.scope);
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Import recommendations</h2>
        <p className="mt-1 text-sm text-muted">
          One row per recommendation. Columns are matched by name: <code>portfolio</code>, <code>symbol</code>, <code>name</code>, <code>asset type</code> (stock, ETF,
          option), <code>direction</code> (long/short), <code>entry date</code>, <code>entry price</code>, <code>stop</code>, <code>target</code>,{" "}
          <code>exit date</code>, <code>exit price</code>, <code>notes</code>, <code>weight</code>, <code>split</code>; options add <code>option type</code>,{" "}
          <code>strike</code> and <code>expiry</code>. A row matching a stored recommendation (portfolio, symbol, direction, entry date) is skipped, or closes it if
          the row has an exit.
        </p>
      </div>
      <Flash error={query.error} />
      <ImportForm portfolios={portfolios.map((p) => p.name)} />
    </div>
  );
}
