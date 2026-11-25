import Link from "next/link";

/** Small server-rendered pieces for the Usage pages. */

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * One series of daily bars (no legend: the title names it). Each bar has a hover tooltip
 * and a hit area the full column height; the table under the chart is the accessible view.
 */
export function DailyBars({ title, points, format }: { title: string; points: { day: string; value: number }[]; format: (value: number) => string }) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const width = 600;
  const height = 120;
  const gap = 2;
  const barWidth = Math.max(1, width / Math.max(points.length, 1) - gap);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <figure className="rounded-lg border border-line bg-white p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted">Peak {format(max === 1 && total === 0 ? 0 : max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-3 h-28 w-full" role="img" aria-label={`${title}, daily`}>
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke="#e1e4ea" strokeWidth="1" />
        {points.map((point, index) => {
          const x = index * (barWidth + gap);
          const h = point.value > 0 ? Math.max(2, (point.value / max) * (height - 4)) : 0;
          return (
            <g key={point.day} className="group">
              <rect x={x} y={0} width={barWidth + gap} height={height} fill="transparent" />
              <rect x={x} y={height - h} width={barWidth} height={h} rx={Math.min(4, barWidth / 2)} fill="#1d4ed8" className="group-hover:fill-[#1e3a8a]" />
              <title>{`${label(point.day)}: ${format(point.value)}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{points[0] ? label(points[0].day) : ""}</span>
        <span>{points.length ? label(points[points.length - 1]!.day) : ""}</span>
      </div>
    </figure>
  );
}

export function RangePicker({ days, base, extra = {} }: { days: number; base: string; extra?: Record<string, string | undefined> }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Time range">
      {[1, 7, 30, 90].map((option) => {
        const params = new URLSearchParams(Object.entries({ ...extra, days: String(option) }).filter((entry): entry is [string, string] => Boolean(entry[1])));
        return (
          <Link
            key={option}
            href={`${base}?${params}`}
            aria-current={days === option ? "true" : undefined}
            className={`inline-flex min-h-9 items-center rounded-md border px-3 text-sm ${days === option ? "border-[#1e3a8a] bg-[#eef2ff] font-semibold text-[#1e3a8a]" : "border-line bg-white hover:bg-canvas"}`}
          >
            {option === 1 ? "Today" : `${option} days`}
          </Link>
        );
      })}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-8 flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

/** A proportion bar inside a table cell (share of the top row). */
export function ShareBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className="block h-1.5 w-24 rounded-full bg-canvas" aria-hidden>
      <span className="block h-1.5 rounded-full bg-[#1d4ed8]" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function when(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
