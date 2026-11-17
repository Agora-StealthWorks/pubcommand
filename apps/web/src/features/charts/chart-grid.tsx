import Link from "next/link";
import { deleteChartForm } from "./actions";

export type GridChart = { id: string; name: string; symbol: string; headline: string; headlineOverridden: boolean; tokens: unknown; updatedAt: Date };

export function ChartGrid({ charts, back }: { charts: GridChart[]; back: string }) {
  if (!charts.length) return <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">No charts yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {charts.map((chart) => {
        const tokens = (chart.tokens ?? {}) as Record<string, string>;
        return (
          <li key={chart.id} className="min-w-0 overflow-hidden rounded-xl border border-line bg-white">
            <Link href={`/charts?chart=${chart.id}`} className="block bg-canvas">
              <img src={`/charts/c/${chart.id}/export?format=thumb`} alt={chart.name} loading="lazy" className="block aspect-[2/1] w-full object-contain" />
            </Link>
            <div className="p-3">
              <Link href={`/charts?chart=${chart.id}`} className="block truncate text-sm font-semibold hover:text-accent">
                {chart.name || chart.symbol}
              </Link>
              <p className="truncate text-xs text-muted">
                {chart.symbol} · data says {tokens.gain ?? "n/a"} · {chart.updatedAt.toISOString().slice(0, 10)}
              </p>
              {chart.headlineOverridden ? <p className="mt-1 text-xs font-semibold text-[#93370d]">Headline overridden: “{chart.headline}”</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {(["png", "jpg", "svg", "pdf"] as const).map((format) => (
                  <a key={format} href={`/charts/c/${chart.id}/export?format=${format}`} className="inline-flex min-h-8 items-center rounded border border-line px-2 font-semibold">
                    {format.toUpperCase()}
                  </a>
                ))}
                <form action={deleteChartForm} className="ml-auto">
                  <input type="hidden" name="chartId" value={chart.id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="min-h-8 px-2 font-semibold text-[#b42318]">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
