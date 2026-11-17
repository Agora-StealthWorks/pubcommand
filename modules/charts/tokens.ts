/**
 * Chart math and headline tokens. Every figure on a chart is computed here from the bars that are drawn.
 * Pure: no I/O, no clock. The AI never supplies these numbers.
 */

/** One bar. `t` is UTC ms. Structurally the same as @pubcommand/market's Bar. */
export type ChartBar = { t: number; o: number; h: number; l: number; c: number };

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

export type SeriesStats = {
  first: number;
  last: number;
  firstDate: string;
  lastDate: string;
  high: number;
  low: number;
  /** Total change in percent, from the first close to the last close. */
  gainPct: number;
  /** Compound annual growth in percent. null under ~1 year, where annualizing misleads. */
  cagrPct: number | null;
  years: number;
};

export function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function computeStats(bars: readonly ChartBar[]): SeriesStats | null {
  if (bars.length < 2) return null;
  const firstBar = bars[0] as ChartBar;
  const lastBar = bars[bars.length - 1] as ChartBar;
  let high = -Infinity;
  let low = Infinity;
  for (const bar of bars) {
    high = Math.max(high, bar.h, bar.c);
    low = Math.min(low, bar.l, bar.c);
  }
  const first = firstBar.c;
  const last = lastBar.c;
  const years = (lastBar.t - firstBar.t) / YEAR;
  const gainPct = first > 0 ? (last / first - 1) * 100 : 0;
  const cagrPct = years >= 0.95 && first > 0 && last > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : null;
  return { first, last, firstDate: isoDate(firstBar.t), lastDate: isoDate(lastBar.t), high, low, gainPct, cagrPct, years };
}

/**
 * Round toward zero to `sig` significant figures, so a rounded figure never overstates the move:
 * 347.9 → 340, 24,812 → 24,000, 9.87 → 9.8, -12.6 → -12.
 */
export function roundDownSig(n: number, sig = 2): number {
  if (!Number.isFinite(n) || n === 0) return 0;
  const a = Math.abs(n);
  const step = Math.pow(10, Math.floor(Math.log10(a)) - sig + 1);
  // Nudge by a tiny epsilon so 0.29 / 0.01 floating error does not drop a digit.
  const rounded = Math.floor(a / step + 1e-9) * step;
  const clean = Number(rounded.toPrecision(12));
  return n < 0 ? -clean : clean;
}

/** Percent with standard rounding and thousands separators. Never prints "-0%". */
export function fmtPct(n: number, decimals = 0): string {
  const f = Math.pow(10, decimals);
  const v = Math.round(n * f) / f;
  const safe = Object.is(v, -0) || v === 0 ? 0 : v;
  return `${safe.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

/** A rounded-down percent, without decimals beyond what the 2 significant figures need. */
export function fmtPctRoundedDown(n: number): string {
  const v = roundDownSig(n);
  const decimals = Math.abs(v) >= 10 || v === 0 ? 0 : Math.abs(v) >= 1 ? 1 : 2;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals })}%`;
}

export function fmtPrice(n: number, prefix = "$"): string {
  const a = Math.abs(n);
  if (a >= 1000) return `${prefix}${Math.round(n).toLocaleString("en-US")}`;
  if (a >= 100) return `${prefix}${n.toFixed(0)}`;
  if (a >= 0.01) return `${prefix}${n.toFixed(2)}`;
  return `${prefix}${n.toFixed(4)}`;
}

export function fmtDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** "3 months", "1 year", "5 years": the chart's length in words. */
export function spanText(years: number): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (years < 0.1) return plural(Math.max(1, Math.round(years * 365.25)), "day");
  if (years < 1.5) {
    const months = Math.round(years * 12);
    return months >= 12 ? "1 year" : plural(Math.max(1, months), "month");
  }
  return plural(Math.round(years), "year");
}

export type TokenContext = {
  ticker: string;
  name: string;
  source: string;
  /** "$" for prices, "" for ratios and macro series. */
  unit: string;
  pctDecimals?: number;
};

export const TOKEN_HELP: Record<string, string> = {
  gain: "Total change, first to last close",
  gainRounded: "Total change rounded DOWN to 2 significant figures",
  start: "First close",
  end: "Last close",
  cagr: "Compound annual growth (a year or more of data)",
  years: "Length of the chart in whole years",
  span: "Length of the chart in words: 8 months, 1 year, 5 years",
  ticker: "Symbol",
  name: "Company or series name",
};

export function tokenValues(stats: SeriesStats | null, ctx: TokenContext): Record<string, string> {
  const base = { ticker: ctx.ticker, name: ctx.name || ctx.ticker, source: ctx.source };
  if (!stats) return base;
  const decimals = ctx.pctDecimals ?? 0;
  return {
    ...base,
    gain: fmtPct(stats.gainPct, decimals),
    gainAbs: fmtPct(Math.abs(stats.gainPct), decimals),
    gainRounded: fmtPctRoundedDown(stats.gainPct),
    gainRoundedAbs: fmtPctRoundedDown(Math.abs(stats.gainPct)),
    start: fmtPrice(stats.first, ctx.unit),
    end: fmtPrice(stats.last, ctx.unit),
    cagr: stats.cagrPct == null ? "" : fmtPct(stats.cagrPct, decimals),
    years: String(Math.max(1, Math.round(stats.years))),
    span: spanText(stats.years),
    from: fmtDateLong(stats.firstDate),
    to: fmtDateLong(stats.lastDate),
  };
}

const matchCase = (word: string, replacement: string) =>
  word === word.toUpperCase()
    ? replacement.toUpperCase()
    : word[0] === word[0]?.toUpperCase()
      ? `${replacement[0]?.toUpperCase()}${replacement.slice(1)}`
      : replacement;

/** On a loss, "{gain} gain" becomes "{gainAbs} loss" (case kept) so a chart never reads "-12% gain". */
export function lossify(text: string, gainPct: number | null | undefined): string {
  if (gainPct == null || !(gainPct < 0)) return text;
  return text.replace(/\{(gain|gainRounded)\}(\s+)(gains?)\b/gi, (_m, token: string, space: string, word: string) =>
    `{${token}Abs}${space}${matchCase(word, word.toLowerCase() === "gains" ? "losses" : "loss")}`,
  );
}

export function resolveTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? (values[key] as string) : match));
}

/** Text exactly as the chart shows it. */
export function displayText(text: string, values: Record<string, string>, gainPct: number | null | undefined, lossWord = true): string {
  return resolveTokens(lossWord ? lossify(text, gainPct) : text, values);
}

/**
 * Typed figures in a headline: percentages and money written by a person rather than produced by a token.
 * A headline with any of these is "overridden": the chart shows a number the data did not produce.
 */
export function literalFigures(text: string): string[] {
  const withoutTokens = text.replace(/\{\w+\}/g, " ");
  return withoutTokens.match(/[-+]?\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[kKmMbB]\b|million|billion)?|[-+]?\d[\d,]*(?:\.\d+)?\s?%/g)?.map((m) => m.trim()) ?? [];
}

export function isOverridden(text: string): boolean {
  return literalFigures(text).length > 0;
}

/** The claim shape for the Brain: "{gain}" → "N% gain", typed figures → "typed figure". */
export function claimPattern(text: string): string {
  const pattern = text
    .replace(/\{(gain|gainAbs)\}/g, "N%")
    .replace(/\{(gainRounded|gainRoundedAbs)\}/g, "N%+")
    .replace(/\{cagr\}/g, "N% a year")
    .replace(/\{(start|end)\}/g, "$N")
    .replace(/\{(ticker|name)\}/g, "TICKER")
    .replace(/\{\w+\}/g, "…");
  return pattern.replace(/\s+/g, " ").trim().slice(0, 140);
}
