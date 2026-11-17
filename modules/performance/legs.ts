/**
 * Legs and fills (Portfolio Manager). Pure: fills in, position state and P&L out.
 *
 * A position holds one or more legs (a stock, or each option of a spread). Each leg has fills: OPEN fills scale
 * in, CLOSE fills scale out. A leg's opening side (BUY = long, SELL = short) fixes its direction.
 *
 * Rules:
 *   - Average cost: every OPEN fill adds price × qty × multiplier to the leg's basis. A CLOSE fill takes the
 *     average cost off the basis and books (exit − average cost) × qty × multiplier × direction as realized P&L.
 *   - A leg that reaches zero is closed for good. Re-entering the same contract is a new position. That keeps the
 *     weighted-average entry over all opening fills equal to the average cost of what is still open.
 *   - You cannot close more than is open, and nothing can be closed before it was opened.
 *   - Unrealized P&L marks the open quantity to a market price (entry basis). A leg with no price leaves the
 *     position unpriced rather than valued at zero.
 *   - Return % = (realized + unrealized) / capital at risk. Capital at risk is every dollar opened for a single
 *     leg, and the net debit or credit of the opening fills for a multi-leg position (falling back to the gross
 *     opening amount when the legs net to zero).
 *
 * Every number comes from fills a person entered and from market data. Nothing here is ever fed by the AI.
 */

export type FillIntent = "OPEN" | "CLOSE";
export type LegSide = "BUY" | "SELL";

export type LegSpec = {
  id: string;
  legIndex: number;
  side: LegSide;
  /** Contracts per one unit of the position. */
  ratio: number;
  /** 1 for stock, 100 for options. */
  multiplier: number;
};

export type FillRecord = {
  id: string;
  legId: string;
  intent: FillIntent;
  quantity: number;
  price: number;
  /** Copied from the leg when the fill was written. */
  multiplier: number;
  executedAt: Date;
  createdAt?: Date;
};

export type LegState = {
  legId: string;
  legIndex: number;
  /** +1 long, −1 short. */
  direction: 1 | -1;
  ratio: number;
  multiplier: number;
  openQty: number;
  closedQty: number;
  openedQty: number;
  /** Weighted average over every opening fill, per share or contract. */
  wavgEntry: number | null;
  /** Weighted average over every closing fill. */
  wavgExit: number | null;
  /** Dollars of basis still attached to the open quantity (unsigned). */
  openBasis: number;
  /** Dollars opened in total (unsigned). */
  openedNotional: number;
  realized: number;
  firstAt: Date | null;
  lastAt: Date | null;
  closedAt: Date | null;
  isClosed: boolean;
};

export class LegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegError";
  }
}

const EPS = 1e-9;

export function legDirection(side: LegSide): 1 | -1 {
  return side === "SELL" ? -1 : 1;
}

/** "Buy to open", "Sell to close", … for a leg's opening side and a fill's intent. */
export function fillLabel(side: LegSide, intent: FillIntent): string {
  const buys = (side === "BUY") === (intent === "OPEN");
  return `${buys ? "Buy" : "Sell"} to ${intent === "OPEN" ? "open" : "close"}`;
}

function ordered(fills: readonly FillRecord[]): FillRecord[] {
  return [...fills].sort(
    (a, b) =>
      a.executedAt.getTime() - b.executedAt.getTime() ||
      // On the same day an opening fill comes first, so a same-day round trip reduces cleanly.
      (a.intent === b.intent ? 0 : a.intent === "OPEN" ? -1 : 1) ||
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Reduce one leg's fills to its state. Throws LegError on an impossible history rather than a wrong number. */
export function reduceLeg(leg: LegSpec, fills: readonly FillRecord[]): LegState {
  const direction = legDirection(leg.side);
  let openQty = 0;
  let openedQty = 0;
  let closedQty = 0;
  let openBasis = 0;
  let openedNotional = 0;
  let exitNotional = 0;
  let realized = 0;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  let closedAt: Date | null = null;
  for (const fill of ordered(fills.filter((f) => f.legId === leg.id))) {
    if (!(fill.quantity > 0) || !Number.isFinite(fill.quantity)) throw new LegError("A fill needs a quantity above zero.");
    if (!(fill.price >= 0) || !Number.isFinite(fill.price)) throw new LegError("A fill needs a price of zero or more.");
    const multiplier = fill.multiplier > 0 ? fill.multiplier : leg.multiplier;
    const notional = fill.price * fill.quantity * multiplier;
    firstAt ??= fill.executedAt;
    lastAt = fill.executedAt;
    if (fill.intent === "OPEN") {
      if (closedAt) throw new LegError("This leg was closed out completely. Enter a new position to buy it again.");
      openQty += fill.quantity;
      openedQty += fill.quantity;
      openBasis += notional;
      openedNotional += notional;
      continue;
    }
    if (openQty <= EPS) throw new LegError("There is nothing open on this leg to close.");
    if (fill.quantity > openQty + EPS) throw new LegError(`Cannot close ${trim(fill.quantity)}: only ${trim(openQty)} open.`);
    const quantity = Math.min(fill.quantity, openQty);
    const costPerUnit = openBasis / openQty;
    const cost = costPerUnit * quantity;
    realized += direction * (notional * (quantity / fill.quantity) - cost);
    openBasis -= cost;
    openQty -= quantity;
    closedQty += quantity;
    exitNotional += fill.price * quantity * multiplier;
    if (openQty <= EPS) {
      openQty = 0;
      openBasis = 0;
      closedAt = fill.executedAt;
    }
  }
  const per = (dollars: number, qty: number) => (qty > EPS ? dollars / (qty * leg.multiplier) : null);
  return {
    legId: leg.id,
    legIndex: leg.legIndex,
    direction,
    ratio: leg.ratio > 0 ? leg.ratio : 1,
    multiplier: leg.multiplier,
    openQty,
    closedQty,
    openedQty,
    wavgEntry: per(openedNotional, openedQty),
    wavgExit: per(exitNotional, closedQty),
    openBasis,
    openedNotional,
    realized,
    firstAt,
    lastAt,
    closedAt,
    isClosed: openedQty > EPS && openQty <= EPS,
  };
}

function trim(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** A leg's market price, entry basis. `stale` = not a fresh quote. */
export type LegMark = { price: number; stale: boolean; at: Date | null };

export type PositionPnl = {
  legs: LegState[];
  status: "OPEN" | "CLOSED" | "EMPTY";
  realized: number;
  /** Null when an open leg has no price. */
  unrealized: number | null;
  /** Capital at risk (see the header). */
  basis: number;
  /** Return on capital at risk, percent. Null when it cannot be calculated. */
  pct: number | null;
  /** Some open leg has no price at all. */
  unpriced: boolean;
  /** Some open leg uses a stored price rather than a fresh quote. */
  stale: boolean;
  /** Per position unit: net opening amount and net closing amount (single leg: average cost and average exit). */
  entryPerUnit: number | null;
  exitPerUnit: number | null;
  /** Units of the whole position opened (leg 0 quantity ÷ its ratio). */
  units: number;
  firstAt: Date | null;
  lastAt: Date | null;
};

/** Reduce every leg and value the position. Throws LegError when a leg's history is impossible. */
export function positionPnl(legs: readonly LegSpec[], fills: readonly FillRecord[], marks: ReadonlyMap<string, LegMark | null> = new Map()): PositionPnl {
  const states = [...legs].sort((a, b) => a.legIndex - b.legIndex).map((leg) => reduceLeg(leg, fills));
  const active = states.filter((s) => s.openedQty > EPS);
  const realized = active.reduce((sum, s) => sum + s.realized, 0);
  let unrealized: number | null = 0;
  let unpriced = false;
  let stale = false;
  for (const state of active) {
    if (state.openQty <= EPS) continue;
    const mark = marks.get(state.legId);
    if (!mark || !Number.isFinite(mark.price) || mark.price < 0) {
      unpriced = true;
      unrealized = null;
      continue;
    }
    if (mark.stale) stale = true;
    if (unrealized != null) unrealized += state.direction * (mark.price * state.openQty * state.multiplier - state.openBasis);
  }
  const status: PositionPnl["status"] = !active.length ? "EMPTY" : active.every((s) => s.isClosed) ? "CLOSED" : "OPEN";
  // Net opening cash: a buy pays (−), a sell receives (+).
  const netOpen = active.reduce((sum, s) => sum - s.direction * s.openedNotional, 0);
  const netClose = active.reduce((sum, s) => {
    const exitDollars = (s.wavgExit ?? 0) * s.closedQty * s.multiplier;
    return sum + s.direction * exitDollars;
  }, 0);
  const gross = active.reduce((sum, s) => sum + s.openedNotional, 0);
  const basis = active.length === 1 ? (active[0] as LegState).openedNotional : Math.abs(netOpen) > EPS ? Math.abs(netOpen) : gross;
  const lead = active[0];
  const units = lead ? lead.openedQty / lead.ratio : 0;
  const single = active.length === 1 ? (active[0] as LegState) : null;
  const perUnit = (dollars: number) => (lead && units > EPS ? Math.abs(dollars) / (units * lead.multiplier) : null);
  const entryPerUnit = single ? single.wavgEntry : perUnit(netOpen);
  const exitPerUnit = single ? single.wavgExit : status === "CLOSED" ? perUnit(netClose) : null;
  const total = unrealized == null ? null : realized + unrealized;
  const pct = total != null && basis > EPS ? (total / basis) * 100 : null;
  const dates = active.flatMap((s) => [s.firstAt, s.lastAt]).filter((d): d is Date => d instanceof Date);
  return {
    legs: states,
    status,
    realized,
    unrealized: status === "CLOSED" ? 0 : unrealized,
    basis,
    pct: status === "CLOSED" ? (basis > EPS ? (realized / basis) * 100 : null) : pct,
    unpriced: status === "CLOSED" ? false : unpriced,
    stale: status === "CLOSED" ? false : stale,
    entryPerUnit,
    exitPerUnit,
    units,
    firstAt: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
    lastAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
  };
}

// ----------------------------------------------------------------------------- form input

export type FillDraft = { intent: FillIntent; quantity: number; price: number; executedAt: Date; note: string };

/** Validate a fill typed into the form. Dates are YYYY-MM-DD; a fill cannot be in the future. */
export function validateFill(raw: { intent?: string; quantity?: string; price?: string; executedAt?: string; note?: string }, today: Date): { ok: true; draft: FillDraft } | { ok: false; error: string } {
  const intent = raw.intent === "CLOSE" ? "CLOSE" : raw.intent === "OPEN" ? "OPEN" : null;
  if (!intent) return { ok: false, error: "Pick whether this fill opens or closes." };
  const quantity = Number(String(raw.quantity ?? "").replace(/[,\s]/g, ""));
  if (!(quantity > 0) || !Number.isFinite(quantity)) return { ok: false, error: "Quantity must be a number above zero." };
  const price = Number(String(raw.price ?? "").replace(/[$,\s]/g, ""));
  if (!(price >= 0) || !Number.isFinite(price) || String(raw.price ?? "").trim() === "") return { ok: false, error: "Price must be a number of zero or more." };
  const match = String(raw.executedAt ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const executedAt = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!executedAt || Number.isNaN(executedAt.getTime())) return { ok: false, error: "Enter the fill date." };
  if (executedAt.getTime() > today.getTime()) return { ok: false, error: "The fill date is in the future." };
  return { ok: true, draft: { intent, quantity, price, executedAt, note: String(raw.note ?? "").trim().slice(0, 1000) } };
}
