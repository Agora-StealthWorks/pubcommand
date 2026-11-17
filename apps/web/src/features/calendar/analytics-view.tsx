"use client";

import { useMemo, useState } from "react";
import { bucketLabel, bucketOf, formatStat, GRAINS, lastPeriods, niceTicks, rollup, STATS, totals, type Grain, type Rollup, type SendRow, type StatKey } from "../../../../../modules/editorial/analytics";

const PALETTE = ["#2563eb", "#c11574", "#0e9384", "#f79009", "#7f56d9", "#475467", "#d92d20", "#12b76a", "#0086c9", "#b54708"];
const PERIODS = [6, 12, 24, 0] as const;
const MAX_COMPARE = 10;

function MultiSelect({ label, options, selected, onChange, allLabel }: { label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void; allLabel: string }) {
  const summary = selected.length === 0 ? allLabel : selected.length <= 2 ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(", ") : `${selected.length} selected`;
  return (
    <details className="relative min-w-0">
      <summary className="pc-control flex min-w-44 cursor-pointer list-none items-center justify-between gap-2" aria-label={label}>
        <span className="truncate">{summary}</span>
        <span aria-hidden>▾</span>
      </summary>
      <div className="absolute z-20 mt-1 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-white p-2 shadow-lg">
        <button type="button" className="mb-1 w-full rounded px-2 py-1.5 text-left text-sm font-semibold text-accent hover:bg-canvas" onClick={() => onChange([])}>
          {allLabel}
        </button>
        {options.map((o) => (
          <label key={o.value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-canvas">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))} />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  );
}

type Series = { name: string; color: string; points: Rollup[] };

function Chart({ stat, series, buckets, grain, fromZero }: { stat: (typeof STATS)[number]; series: Series[]; buckets: string[]; grain: Grain; fromZero: boolean }) {
  const W = 640;
  const H = 220;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const value = (r: Rollup | undefined) => (r ? (r[stat.key as StatKey] as number | null) : null);
  const all = series.flatMap((s) => s.points.map(value)).filter((v): v is number => v != null);
  const ticks = niceTicks(all, fromZero);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x = (i: number) => pad.l + (buckets.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (buckets.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const latest = series.length === 1 ? value(series[0]!.points.find((p) => p.bucket === buckets[buckets.length - 1])) : null;
  return (
    <figure className="min-w-0 rounded-xl border border-line bg-white p-3">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{stat.label}</span>
        {latest != null ? <span className="text-sm tabular-nums text-muted">Latest {formatStat(latest, stat.unit)}</span> : null}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${stat.label} by ${grain}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eaecf0" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#667085">
              {formatStat(t, stat.unit)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) =>
          i % every === 0 || i === buckets.length - 1 ? (
            <text key={b} x={x(i)} y={H - 8} textAnchor={buckets.length > 1 && i === 0 ? "start" : buckets.length > 1 && i === buckets.length - 1 ? "end" : "middle"} fontSize="11" fill="#667085">
              {bucketLabel(b, grain)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = buckets.map((b, i) => [i, value(s.points.find((p) => p.bucket === b))] as const).filter(([, v]) => v != null) as [number, number][];
          const path = pts.map(([i, v], n) => `${n ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
          return (
            <g key={s.name}>
              <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              {pts.map(([i, v]) => (
                <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={s.color}>
                  <title>{`${s.name} · ${bucketLabel(buckets[i]!, grain)}: ${formatStat(v, stat.unit)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function AnalyticsView({ rows, publications }: { rows: SendRow[]; publications: { code: string; name: string; color: string }[] }) {
  const [grain, setGrain] = useState<Grain>("month");
  const [periods, setPeriods] = useState<number>(12);
  const [pubs, setPubs] = useState<string[]>([]);
  const [stats, setStats] = useState<string[]>(["openRate", "clickRate", "revenuePerThousand"]);
  const [compare, setCompare] = useState(false);
  const [fromZero, setFromZero] = useState(true);

  const { buckets, series, table } = useMemo(() => {
    const combined = lastPeriods(rollup(rows, grain, pubs), periods);
    const buckets = combined.map((r) => r.bucket);
    const chosen = pubs.length ? pubs : [...new Set(rows.map((r) => r.pub))].sort();
    const series: Series[] = compare
      ? chosen.slice(0, MAX_COMPARE).map((code, i) => ({
          name: code,
          color: publications.find((p) => p.code === code)?.color ?? PALETTE[i % PALETTE.length]!,
          points: rollup(rows, grain, [code]).filter((r) => buckets.includes(r.bucket)),
        }))
      : [{ name: pubs.length ? pubs.join(" + ") : "All publications", color: "#2563eb", points: combined }];
    return { buckets, series, table: combined };
  }, [rows, grain, periods, pubs, compare, publications]);

  const shownStats = STATS.filter((s) => (stats.length ? stats.includes(s.key) : true));
  const inRange = new Set(buckets);
  const sum = totals(rows.filter((r) => inRange.has(bucketOf(r.day, grain))), pubs);

  if (!rows.length) {
    return <p className="rounded-xl border border-line bg-white p-6 text-sm text-muted">No send stats yet. Import an ESP export under Send stats and the charts fill in.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3">
        <select className="pc-control" value={grain} onChange={(e) => setGrain(e.target.value as Grain)} aria-label="Group by">
          {GRAINS.map((g) => (
            <option key={g} value={g}>
              By {g}
            </option>
          ))}
        </select>
        <select className="pc-control" value={periods} onChange={(e) => setPeriods(Number(e.target.value))} aria-label="Periods">
          {PERIODS.map((n) => (
            <option key={n} value={n}>
              {n ? `Last ${n} ${grain}s` : "All time"}
            </option>
          ))}
        </select>
        <MultiSelect label="Publications" allLabel="All publications" selected={pubs} onChange={setPubs} options={publications.map((p) => ({ value: p.code, label: `${p.code} · ${p.name}` }))} />
        <MultiSelect label="Stats" allLabel="All stats" selected={stats} onChange={setStats} options={STATS.map((s) => ({ value: s.key, label: s.label }))} />
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare publications
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={fromZero} onChange={(e) => setFromZero(e.target.checked)} /> Y-axis from zero
        </label>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["Sends", formatStat(sum.sends, "count")],
            ["Mailed", formatStat(sum.mailed, "count")],
            ["Open rate", formatStat(sum.openRate, "pct")],
            ["Click rate", formatStat(sum.clickRate, "pct")],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-lg border border-line bg-white px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">Rates are weighted: total opens ÷ total mailed for the period, so a big send counts more than a small one.</p>

      {compare ? (
        <div className="flex flex-wrap gap-3 text-xs">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {shownStats.map((stat) => (
          <Chart key={stat.key} stat={stat} series={series} buckets={buckets} grain={grain} fromZero={fromZero} />
        ))}
      </div>

      <div className="pc-scroll">
        <table className="w-full min-w-[640px] rounded-xl border border-line bg-white text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2 text-right">Sends</th>
              <th className="px-3 py-2 text-right">Mailed</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">Click</th>
              <th className="px-3 py-2 text-right">CTOR</th>
              <th className="px-3 py-2 text-right">Rev / 1,000</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...table].reverse().map((r) => (
              <tr key={r.bucket}>
                <td className="px-3 py-2">{bucketLabel(r.bucket, grain)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatStat(r.sends, "count")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatStat(r.mailed, "count")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatStat(r.openRate, "pct")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatStat(r.clickRate, "pct")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatStat(r.clickToOpen, "pct")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatStat(r.revenuePerThousand, "usd")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
