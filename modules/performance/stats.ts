/**
 * Track-record statistics and the public-safe view. Pure: every input is a position whose gain was already
 * computed by computeGain(). Numbers come from stored trades and market data only.
 *
 * Definitions:
 *   - Closed stats count CLOSED positions with an exit gain. Winner = gain > 0. Win rate = winners / closed.
 *   - Average gain = plain mean. Weighted average = Σ(gain × weight) / Σ(weight).
 *   - Holding period = calendar days entry → exit.
 *   - Open stats use the live (TODAY) gain; a position that cannot be priced at all is left out of the average.
 */

export type StatPosition = {
  id: string;
  symbol: string;
  name: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  entryDate: Date;
  exitDate: Date | null;
  entryPrice: number;
  exitPrice: number | null;
  gainPct: number | null;
  holdDays: number | null;
  weight: number;
  /** The gain uses a stored or recorded price, not a fresh quote. */
  stale?: boolean;
};

export type TradeRef = { id: string; symbol: string; name: string; gainPct: number; holdDays: number | null };

export type PortfolioStats = {
  open: number;
  closed: number;
  winners: number;
  losers: number;
  winRate: number | null;
  avgGain: number | null;
  weightedAvgGain: number | null;
  medianGain: number | null;
  avgHoldDays: number | null;
  best: TradeRef | null;
  worst: TradeRef | null;
  avgOpenGain: number | null;
  openPriced: number;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function ref(position: StatPosition): TradeRef {
  return { id: position.id, symbol: position.symbol, name: position.name, gainPct: position.gainPct as number, holdDays: position.holdDays };
}

/** Internal stats: everything, including losers and the worst trade. */
export function computeStats(positions: readonly StatPosition[]): PortfolioStats {
  const closed = positions.filter((p) => p.status === "CLOSED" && p.gainPct != null && Number.isFinite(p.gainPct));
  const open = positions.filter((p) => p.status === "OPEN");
  const gains = closed.map((p) => p.gainPct as number);
  const winners = gains.filter((g) => g > 0).length;
  const weightSum = closed.reduce((sum, p) => sum + (p.weight > 0 ? p.weight : 0), 0);
  const holds = closed.map((p) => p.holdDays).filter((h): h is number => h != null);
  let best: StatPosition | null = null;
  let worst: StatPosition | null = null;
  for (const p of closed) {
    if (!best || (p.gainPct as number) > (best.gainPct as number)) best = p;
    if (!worst || (p.gainPct as number) < (worst.gainPct as number)) worst = p;
  }
  const openGains = open.map((p) => p.gainPct).filter((g): g is number => g != null && Number.isFinite(g));
  return {
    open: open.length,
    closed: closed.length,
    winners,
    losers: closed.length - winners,
    winRate: closed.length ? winners / closed.length : null,
    avgGain: mean(gains),
    weightedAvgGain: weightSum > 0 ? closed.reduce((sum, p) => sum + (p.gainPct as number) * (p.weight > 0 ? p.weight : 0), 0) / weightSum : null,
    medianGain: median(gains),
    avgHoldDays: mean(holds),
    best: best ? ref(best) : null,
    worst: worst ? ref(worst) : null,
    avgOpenGain: mean(openGains),
    openPriced: openGains.length,
  };
}

// ----------------------------------------------------------------------------- public-safe

export type PublicSettings = { includeOpen: boolean };

export type PublicTrade = {
  symbol: string;
  name: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  gainPct: number | null;
  holdDays: number | null;
};

/**
 * What a public track record may show. Deliberately has no loser count, no worst trade and no losers list: the
 * type itself cannot carry them. The stats still count every closed trade, losers included, so the win rate and
 * average are honest. The trade list is every closed trade in date order (never sorted by gain), so no
 * cherry-picked subset is presented as typical.
 */
export type PublicTrackRecord = {
  stats: {
    closed: number;
    winRate: number | null;
    avgGain: number | null;
    avgHoldDays: number | null;
    best: { symbol: string; name: string; gainPct: number; holdDays: number | null } | null;
  };
  trades: PublicTrade[];
  includesOpen: boolean;
};

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

export function publicTrackRecord(positions: readonly StatPosition[], settings: PublicSettings = { includeOpen: false }): PublicTrackRecord {
  const stats = computeStats(positions);
  const allowed = positions.filter((p) => p.status === "CLOSED" || (settings.includeOpen && p.status === "OPEN"));
  const trades = allowed
    .filter((p) => p.status === "OPEN" || (p.gainPct != null && Number.isFinite(p.gainPct)))
    .sort((a, b) => {
      const ad = (a.exitDate ?? a.entryDate).getTime();
      const bd = (b.exitDate ?? b.entryDate).getTime();
      return bd - ad || a.symbol.localeCompare(b.symbol);
    })
    .map((p) => ({
      symbol: p.symbol,
      name: p.name,
      direction: p.direction,
      status: p.status,
      entryDate: iso(p.entryDate) as string,
      exitDate: iso(p.exitDate),
      entryPrice: p.entryPrice,
      exitPrice: p.exitPrice,
      gainPct: p.gainPct,
      holdDays: p.holdDays,
    }));
  return {
    stats: {
      closed: stats.closed,
      winRate: stats.winRate,
      avgGain: stats.avgGain,
      avgHoldDays: stats.avgHoldDays,
      best: stats.best ? { symbol: stats.best.symbol, name: stats.best.name, gainPct: stats.best.gainPct, holdDays: stats.best.holdDays } : null,
    },
    trades,
    includesOpen: settings.includeOpen,
  };
}

// ----------------------------------------------------------------------------- weeks and the Brain note

/** ISO week key, e.g. "2026-W47" (weeks start Monday). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday..Sunday (UTC dates) of the ISO week holding `date`. */
export function weekBounds(date: Date): { start: Date; end: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const start = new Date(d.getTime() - (day - 1) * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start, end };
}

const pct = (value: number | null) => (value == null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`);
const rate = (value: number | null) => (value == null ? "n/a" : `${Math.round(value * 100)}%`);

/**
 * The weekly Brain note for one portfolio: aggregates only (counts, rates, averages). No symbols, no
 * per-trade lines, no loser lists, so the note is safe to reuse in copy research.
 */
export function weeklySummary(input: {
  portfolioName: string;
  publication: string;
  positions: readonly StatPosition[];
  today: Date;
  /** Positions credited to each editor (see attribution.ts). Aggregates only, like the rest of the note. */
  editors?: readonly { name: string; positions: readonly StatPosition[] }[];
}): {
  week: string;
  title: string;
  body: string;
} {
  const week = isoWeek(input.today);
  const { start, end } = weekBounds(input.today);
  const inWeek = (date: Date | null) => !!date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime() + 86_399_999;
  const all = computeStats(input.positions);
  const thisWeek = computeStats(input.positions.filter((p) => p.status === "CLOSED" && inWeek(p.exitDate)));
  const opened = input.positions.filter((p) => inWeek(p.entryDate)).length;
  const label = input.publication ? `${input.portfolioName} (${input.publication})` : input.portfolioName;
  const body = [
    `Weekly track record summary for ${label}, week ${week} (${iso(start)} to ${iso(end)}).`,
    "",
    "This week:",
    `- Recommendations opened: ${opened}`,
    `- Recommendations closed: ${thisWeek.closed}`,
    `- Win rate on this week's closes: ${rate(thisWeek.winRate)}`,
    `- Average gain on this week's closes: ${pct(thisWeek.avgGain)}`,
    "",
    "Since inception:",
    `- Closed recommendations: ${all.closed}`,
    `- Win rate: ${rate(all.winRate)}`,
    `- Average gain: ${pct(all.avgGain)}`,
    `- Median gain: ${pct(all.medianGain)}`,
    `- Average holding period: ${all.avgHoldDays == null ? "n/a" : `${Math.round(all.avgHoldDays)} days`}`,
    `- Open positions: ${all.open}, average open gain ${pct(all.avgOpenGain)} across ${all.openPriced} priced`,
    ...(input.editors?.length
      ? [
          "",
          "By editor (since inception):",
          ...input.editors.map((e) => {
            const s = computeStats(e.positions);
            return `- ${e.name}: ${s.closed} closed, win rate ${rate(s.winRate)}, average gain ${pct(s.avgGain)}; ${s.open} open`;
          }),
        ]
      : []),
    "",
    "All figures are computed from stored entries, exits and market prices. Past results do not promise future results.",
  ].join("\n");
  return { week, title: `Track record: ${input.portfolioName}, ${week}`, body };
}
