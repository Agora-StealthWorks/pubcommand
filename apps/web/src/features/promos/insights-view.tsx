import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { TIER_LABELS, TIER_TONE, type TierKey } from "../../../../../modules/promo-studio/performance";
import { calibrationStats, type CalibrationPoint } from "../../../../../modules/promo-studio/similar";

export const INSIGHT_VIEWS = [
  ["performance", "Performance"],
  ["lessons", "Lessons"],
  ["directory", "Directory"],
  ["bulk", "Bulk re-analyze"],
] as const;

export function InsightsNav({ active }: { active: string }) {
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Promo Analyzer views">
      {INSIGHT_VIEWS.map(([key, label]) => (
        <Link
          key={key}
          href={`/promo-studio/${key}`}
          className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function TierBadge({ tier, title }: { tier: string | null | undefined; title?: string }) {
  if (!tier) return null;
  const key = tier as TierKey;
  return (
    <Badge tone={TIER_TONE[key] ?? "neutral"} title={title ?? "Percentile band within this promo type, from real results"}>
      {TIER_LABELS[key] ?? tier}
    </Badge>
  );
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function fmtPercent(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}%`;
}

const YOU = "#2a78d6";
const REAL = "#eb6834";

/** AI score (x) against your score and the real-world score (y). On the diagonal = the AI agreed. */
export function CalibrationChart({ points, highlightId }: { points: CalibrationPoint[]; highlightId?: string }) {
  const stats = calibrationStats(points);
  const size = 260;
  const pad = 32;
  const scale = (v: number) => pad + ((v - 1) / 9) * (size - pad * 1.5);
  const y = (v: number) => size - scale(v) + pad / 2;
  const line = (s: NonNullable<typeof stats.mine>, label: string) =>
    `${label}: ${s.n} promo${s.n === 1 ? "" : "s"}, ${s.meanGap === 0 ? "AI matches on average" : `AI ${s.meanGap > 0 ? "higher" : "lower"} by ${Math.abs(s.meanGap)} on average`} (typical gap ${s.meanAbsGap})${s.correlation != null ? `, correlation ${s.correlation}` : ""}`;
  if (!points.length) {
    return <p className="text-sm text-muted">No calibration yet. Give analyzed promos your score or import real results to see how the AI lines up.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px]" role="img" aria-label="AI score against your score and the real-world score">
        {[1, 4, 7, 10].map((tick) => (
          <g key={tick}>
            <line x1={scale(1)} x2={scale(10)} y1={y(tick)} y2={y(tick)} stroke="#e7e5e4" strokeWidth={1} />
            <text x={pad - 6} y={y(tick) + 4} textAnchor="end" fontSize={10} fill="#52514e">{tick}</text>
            <text x={scale(tick)} y={size - 4} textAnchor="middle" fontSize={10} fill="#52514e">{tick}</text>
          </g>
        ))}
        <line x1={scale(1)} y1={y(1)} x2={scale(10)} y2={y(10)} stroke="#a8a29e" strokeDasharray="4 4" strokeWidth={1} />
        {points.map((p) => (
          <g key={p.id} opacity={highlightId && highlightId !== p.id ? 0.55 : 1}>
            {p.mine != null ? (
              <circle cx={scale(p.ai)} cy={y(p.mine)} r={highlightId === p.id ? 7 : 5} fill={YOU} stroke="#fff" strokeWidth={2}>
                <title>{`${p.title}: AI ${p.ai}, you ${p.mine}`}</title>
              </circle>
            ) : null}
            {p.real != null ? (
              <rect x={scale(p.ai) - 5} y={y(p.real) - 5} width={10} height={10} rx={2} fill={REAL} stroke="#fff" strokeWidth={2}>
                <title>{`${p.title}: AI ${p.ai}, real world ${p.real}`}</title>
              </rect>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="space-y-2 text-sm">
        <p className="flex flex-wrap gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: YOU }} aria-hidden />Your score</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: REAL }} aria-hidden />Real-world score</span>
          <span>Across: AI score · Dashed line: perfect agreement</span>
        </p>
        {stats.mine ? <p>{line(stats.mine, "You vs AI")}</p> : null}
        {stats.real ? <p>{line(stats.real, "Real world vs AI")}</p> : null}
        <p className="text-xs text-muted">Real-world score is the one you entered, or 1 + 9 × the promo&apos;s results percentile within its type.</p>
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-accent">Show as a table</summary>
          <div className="pc-scroll mt-2">
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr><th className="py-1 pr-2">Promo</th><th className="pr-2">AI</th><th className="pr-2">You</th><th>Real</th></tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-1 pr-2"><Link className="text-accent hover:underline" href={`/promo-studio/${p.id}?tab=training`}>{p.title}</Link></td>
                    <td className="pr-2">{p.ai}</td>
                    <td className="pr-2">{p.mine ?? "—"}</td>
                    <td>{p.real ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

export type GalleryItem = { id: string; title: string; score: number | null; headline: string; tier: string | null; starred: boolean; publisher: string | null };

export function BestPerformers({ items }: { items: GalleryItem[] }) {
  if (!items.length) return <p className="text-sm text-muted">Star a promo as a best performer, or import results, to build the gallery.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/promo-studio/${item.id}`} className="block h-full rounded-xl border border-line bg-white p-4 hover:border-accent">
            <div className="flex items-start justify-between gap-2">
              <p className="pc-break text-sm font-semibold">{item.starred ? "★ " : ""}{item.title}</p>
              {item.score != null ? <span className="shrink-0 rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">{item.score.toFixed(1)}</span> : null}
            </div>
            {item.headline ? <p className="pc-break mt-2 line-clamp-3 text-sm text-muted">&ldquo;{item.headline}&rdquo;</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <TierBadge tier={item.tier} />
              {item.publisher ? <span>{item.publisher}</span> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
