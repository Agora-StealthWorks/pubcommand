/**
 * The one gain engine. Every Track Record surface (open positions, closed positions, stats, the public view,
 * the call archive, the Brain summary) calls computeGain(). Never compute a gain anywhere else.
 *
 * Bases:
 *   TODAY  entry → the latest quote. If no fresh quote, the last stored quote (flagged stale), then a price a
 *          person recorded (flagged stale). Nothing at all → "missing".
 *   PEAK   entry → the best price known since entry: a recorded peak, the market's best close, or the quote.
 *          "Best" means highest for a long and lowest for a short.
 *   EXIT   entry → exit price. Frozen; never touched by the market.
 *   NONE   no gain (a prediction or a quote, not a trade).
 *
 * Price bases. Market prices from @pubcommand/market are split-only adjusted to today's share count. Entry,
 * exit and recorded prices are what a person wrote down at the time ("as traded"). `splitFactor` is how many
 * shares one share at entry became (4-for-1 → 4, 1-for-20 reverse → 0.05). A market price × splitFactor is the
 * same price in the entry's basis, so every comparison and every displayed price is in the entry's basis.
 *
 * Shorts invert the move: (entry − current) / entry.
 *
 * Positions tracked by legs and fills (scale in/out, spreads) pass `legs`: the gain is then the return on capital
 * at risk from legs.ts positionPnl (realized + unrealized), still through this one function.
 *
 * The AI never feeds this function. Every number comes from stored data or a market provider.
 */
import { positionPnl, type FillRecord, type LegError, type LegMark, type LegSpec, type PositionPnl } from "./legs";

export type Direction = "LONG" | "SHORT";
export type GainBasis = "TODAY" | "PEAK" | "EXIT" | "NONE";
export type GainSource = "live" | "stale" | "recorded" | "peak" | "exit" | "none" | "missing";

export type PricePoint = { price: number; at: Date | null };

export interface GainInput {
  basis: GainBasis;
  direction: Direction;
  entryPrice: number | null;
  exitPrice?: number | null;
  exitDate?: Date | null;
  /** Shares per entry share since entry. 1 (or null) = no splits. */
  splitFactor?: number | null;
  /** Latest market quote, market basis. `stale` = the refresh failed and this is the last one we stored. */
  quote?: (PricePoint & { stale?: boolean }) | null;
  /** A price a person recorded (e.g. from the backup), entry basis. The last-resort fallback for TODAY. */
  recorded?: PricePoint | null;
  /** Best close the market returned since entry (highest for long, lowest for short), market basis. */
  marketPeak?: PricePoint | null;
  /** A peak a person recorded, entry basis. */
  recordedPeak?: PricePoint | null;
  /**
   * Legs and fills. When present (with at least one fill) the gain comes from them. `marks` are market quotes per
   * leg id, MARKET basis (splitFactor converts stock legs; option legs are never split-adjusted).
   */
  legs?: {
    specs: readonly (LegSpec & { kind: "STOCK" | "OPTION" })[];
    fills: readonly FillRecord[];
    marks: ReadonlyMap<string, (PricePoint & { stale?: boolean }) | null>;
  } | null;
}

export interface Gain {
  /** Percent, 25 = +25%. Null when it cannot be calculated. */
  pct: number | null;
  /** Price the gain is measured to, entry basis. */
  current: number | null;
  currentAt: Date | null;
  source: GainSource;
  /** True when the price is not a fresh market quote (a stored quote or a recorded price). */
  stale: boolean;
  /** Plain-language note when splits were accounted for. */
  splitNote: string | null;
  /** Best price known since entry, entry basis, and the gain to it. */
  peak: { price: number; at: Date | null; pct: number } | null;
  /** Set for positions tracked by legs and fills. */
  pnl?: PositionPnl | null;
  /** A leg's fill history is impossible (over-close, reopen after flat). */
  legError?: string | null;
}

function factorOf(value: number | null | undefined): number {
  return value && Number.isFinite(value) && value > 0 ? value : 1;
}

/** "4-for-1 split" / "1-for-20 reverse split" for a factor, or null when there was no split. */
export function describeSplit(splitFactor: number | null | undefined): string | null {
  const factor = factorOf(splitFactor);
  if (Math.abs(factor - 1) < 1e-9) return null;
  if (factor > 1) return `Adjusted for a ${trimNumber(factor)}-for-1 split since entry.`;
  return `Adjusted for a 1-for-${trimNumber(1 / factor)} reverse split since entry.`;
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(value >= 100 ? 0 : 2)));
}

export function gainPct(direction: Direction, entry: number, current: number): number {
  return direction === "SHORT" ? ((entry - current) / entry) * 100 : (current / entry - 1) * 100;
}

export function computeGain(input: GainInput): Gain {
  const splitNote = describeSplit(input.splitFactor);
  const blank: Gain = { pct: null, current: null, currentAt: null, source: "none", stale: false, splitNote, peak: null };
  if (input.basis === "NONE") return blank;
  if (input.legs && input.legs.fills.length) return legsGain(input, splitNote);
  const entry = input.entryPrice;
  if (entry == null || !Number.isFinite(entry) || entry <= 0) return { ...blank, source: "missing" };

  const factor = factorOf(input.splitFactor);
  const toEntry = (point: PricePoint | null | undefined): PricePoint | null =>
    point && Number.isFinite(point.price) && point.price > 0 ? { price: point.price * factor, at: point.at } : null;
  const recorded = (point: PricePoint | null | undefined): PricePoint | null =>
    point && Number.isFinite(point.price) && point.price > 0 ? point : null;
  const pctOf = (price: number) => gainPct(input.direction, entry, price);
  const better = (a: PricePoint | null, b: PricePoint | null) => (!a ? b : !b ? a : pctOf(b.price) > pctOf(a.price) ? b : a);

  const quote = toEntry(input.quote);
  const quoteStale = Boolean(input.quote?.stale);

  // The peak is always reported. The trade window ends at exit, so a closed position never takes a later quote.
  const closed = input.exitPrice != null && input.exitPrice > 0;
  let peak = better(recorded(input.recordedPeak), toEntry(input.marketPeak));
  if (!closed && quote) peak = better(peak, quote);
  if (closed) peak = better(peak, { price: input.exitPrice as number, at: input.exitDate ?? null });
  const peakOut = peak ? { price: peak.price, at: peak.at, pct: pctOf(peak.price) } : null;

  let current: PricePoint | null = null;
  let source: GainSource = "missing";
  let stale = false;

  if (input.basis === "EXIT") {
    if (closed) {
      current = { price: input.exitPrice as number, at: input.exitDate ?? null };
      source = "exit";
    }
  } else if (input.basis === "PEAK") {
    if (peak) {
      current = peak;
      source = "peak";
    }
  } else if (quote) {
    current = quote;
    source = quoteStale ? "stale" : "live";
    stale = quoteStale;
  } else if (recorded(input.recorded)) {
    current = recorded(input.recorded);
    source = "recorded";
    stale = true;
  }

  if (!current) return { ...blank, source: "missing", peak: peakOut };
  return { pct: pctOf(current.price), current: current.price, currentAt: current.at, source, stale, splitNote, peak: peakOut };
}

function legsGain(input: GainInput, splitNote: string | null): Gain {
  const legs = input.legs as NonNullable<GainInput["legs"]>;
  const factor = factorOf(input.splitFactor);
  const marks = new Map<string, LegMark | null>();
  let markAt: Date | null = null;
  for (const spec of legs.specs) {
    const quote = legs.marks.get(spec.id);
    if (!quote || !Number.isFinite(quote.price) || quote.price < 0) {
      marks.set(spec.id, null);
      continue;
    }
    marks.set(spec.id, { price: spec.kind === "STOCK" ? quote.price * factor : quote.price, stale: Boolean(quote.stale), at: quote.at });
    if (quote.at && (!markAt || quote.at > markAt)) markAt = quote.at;
  }
  let pnl: PositionPnl;
  try {
    pnl = positionPnl(legs.specs, legs.fills, marks);
  } catch (error) {
    return { pct: null, current: null, currentAt: null, source: "missing", stale: false, splitNote, peak: null, pnl: null, legError: (error as LegError).message };
  }
  const closed = pnl.status === "CLOSED";
  const single = pnl.legs.filter((leg) => leg.openedQty > 0).length === 1 ? pnl.legs.find((leg) => leg.openedQty > 0) ?? null : null;
  const singleMark = single ? (marks.get(single.legId) ?? null) : null;
  // Peak: only for a single leg, measured from its average cost.
  let peak: Gain["peak"] = null;
  if (single && single.wavgEntry && single.wavgEntry > 0) {
    const direction: Direction = single.direction === -1 ? "SHORT" : "LONG";
    const candidates: PricePoint[] = [];
    if (input.marketPeak && input.marketPeak.price > 0) candidates.push({ price: input.marketPeak.price * factor, at: input.marketPeak.at });
    if (!closed && singleMark) candidates.push({ price: singleMark.price, at: singleMark.at });
    if (closed && single.wavgExit) candidates.push({ price: single.wavgExit, at: single.closedAt });
    for (const point of candidates) {
      const pct = gainPct(direction, single.wavgEntry, point.price);
      if (!peak || pct > peak.pct) peak = { price: point.price, at: point.at, pct };
    }
  }
  if (pnl.pct == null) return { pct: null, current: null, currentAt: null, source: "missing", stale: false, splitNote, peak, pnl };
  return {
    pct: pnl.pct,
    current: closed ? pnl.exitPerUnit : (singleMark?.price ?? null),
    currentAt: closed ? pnl.lastAt : markAt,
    source: closed ? "exit" : pnl.stale ? "stale" : "live",
    stale: !closed && pnl.stale,
    splitNote,
    peak,
    pnl,
  };
}

/** The basis a position uses by default: frozen at exit once closed, live while open. */
export function positionBasis(status: "OPEN" | "CLOSED"): GainBasis {
  return status === "CLOSED" ? "EXIT" : "TODAY";
}

/**
 * Best close since entry from daily bars (market basis): highest for a long, lowest for a short.
 * Bars are `{ t, c }` with `t` in UTC ms.
 */
export function bestClose(direction: Direction, bars: readonly { t: number; c: number }[]): PricePoint | null {
  let best: { t: number; c: number } | null = null;
  for (const bar of bars) {
    if (!Number.isFinite(bar.c) || bar.c <= 0) continue;
    if (!best || (direction === "SHORT" ? bar.c < best.c : bar.c > best.c)) best = bar;
  }
  return best ? { price: best.c, at: new Date(best.t) } : null;
}

/**
 * Infer the split factor from the entry price and the market's (split-adjusted) close on the entry date.
 * Returns 1 when they agree (within 30%), a snapped factor when the ratio is a clean split ratio (within 5%),
 * and null when they disagree for some other reason (bad entry price, wrong date) so a person must decide.
 */
export function inferSplitFactor(entryPrice: number, adjustedCloseOnEntry: number): number | null {
  if (!(entryPrice > 0) || !(adjustedCloseOnEntry > 0)) return null;
  const ratio = entryPrice / adjustedCloseOnEntry;
  if (ratio > 1 / 1.3 && ratio < 1.3) return 1;
  const snap = (value: number) => {
    const step = value < 10 ? 0.5 : 1;
    const snapped = Math.round(value / step) * step;
    return snapped >= 1.5 && Math.abs(value / snapped - 1) <= 0.05 ? snapped : null;
  };
  if (ratio >= 1.3) return snap(ratio);
  const inverse = snap(1 / ratio);
  return inverse ? 1 / inverse : null;
}

/** "4:1", "4-for-1", "1:20", "2" → shares per entry share. Null when unreadable. */
export function parseSplitFactor(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const pair = text.match(/^(\d+(?:\.\d+)?)\s*(?::|-?for-?|\/)\s*(\d+(?:\.\d+)?)$/);
  if (pair) {
    const a = Number(pair[1]);
    const b = Number(pair[2]);
    return a > 0 && b > 0 ? a / b : null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Calendar days held, entry → exit (or today). */
export function holdDays(entryDate: Date, endDate: Date): number {
  const day = 86_400_000;
  const start = Date.UTC(entryDate.getUTCFullYear(), entryDate.getUTCMonth(), entryDate.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  return Math.max(0, Math.round((end - start) / day));
}

/** "+25.0%" / "-3.4%" / "—". */
export function formatPct(pct: number | null | undefined, digits = 1): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = Number(pct.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** "$1,234.50" / "$0.0450" for sub-dollar prices / "—". */
export function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  const digits = Math.abs(price) < 1 ? 4 : 2;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** OCC option symbol for Massive, e.g. O:AAPL250117C00150000. */
export function occSymbol(input: { underlying: string; expiry: Date; right: "CALL" | "PUT"; strike: number }): string {
  const root = input.underlying.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const yy = String(input.expiry.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(input.expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(input.expiry.getUTCDate()).padStart(2, "0");
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return `O:${root}${yy}${mm}${dd}${input.right === "CALL" ? "C" : "P"}${strike}`;
}
