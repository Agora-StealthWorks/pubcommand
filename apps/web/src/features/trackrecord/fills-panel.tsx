import { Button, Input, Label } from "@pubcommand/ui";
import { TableScroll } from "@/components/table-scroll";
import { formatPrice } from "../../../../../modules/performance/gain";
import { fillLabel, type LegSide } from "../../../../../modules/performance/legs";
import { addFill, addLeg, deleteFill, startFills } from "./fill-actions";
import type { PositionView } from "./server";
import { iso } from "./ui";

const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: number) => Number(value.toFixed(4)).toLocaleString("en-US");
const tone = (value: number | null | undefined) => (value == null ? "" : value > 0 ? "text-[#067647]" : value < 0 ? "text-[#b42318]" : "");

function legName(leg: PositionView["legs"][number]): string {
  const side = leg.side === "SELL" ? "Short" : "Long";
  if (leg.kind === "OPTION") return `${side} ${leg.ratio > 1 ? `${leg.ratio}× ` : ""}${leg.symbol} ${formatPrice(leg.strike)} ${leg.optionRight === "PUT" ? "put" : "call"} ${iso(leg.expiry)}`;
  return `${side} ${leg.symbol}`;
}

/** Portfolio Manager: legs, fills, average cost, realized and unrealized P&L. */
export function FillsPanel({ view, portfolioId, today }: { view: PositionView; portfolioId: string; today: string }) {
  const hidden = (
    <>
      <input type="hidden" name="portfolioId" value={portfolioId} />
      <input type="hidden" name="positionId" value={view.id} />
    </>
  );
  if (!view.fills.length) {
    return (
      <section className="space-y-2 rounded-xl border border-line bg-white p-4">
        <h3 className="text-sm font-semibold">Buys and sells</h3>
        <p className="text-sm text-muted">
          Track this position by fills to scale in and out, see average cost and realized/unrealized P&amp;L, or build a spread from several legs. The current entry
          {view.status === "CLOSED" ? " and exit become" : " becomes"} the first fill{view.status === "CLOSED" ? "s" : ""}.
        </p>
        <form action={startFills} className="flex flex-wrap items-end gap-2">
          {hidden}
          <div>
            <Label htmlFor="start-qty">{view.assetType === "OPTION" ? "Contracts" : "Shares"} at entry</Label>
            <Input id="start-qty" name="quantity" inputMode="decimal" defaultValue={view.assetType === "OPTION" ? "1" : "100"} className="w-32" required />
          </div>
          <Button type="submit" variant="secondary">
            Track by fills
          </Button>
        </form>
      </section>
    );
  }
  const pnl = view.gain.pnl;
  const states = new Map((pnl?.legs ?? []).map((s) => [s.legId, s]));
  const legById = new Map(view.legs.map((leg) => [leg.id, leg]));
  const openLegs = view.legs.filter((leg) => (states.get(leg.id)?.openQty ?? 0) > 0);
  return (
    <section className="space-y-3 rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-semibold">Buys and sells</h3>
      {view.gain.legError ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{view.gain.legError}</p> : null}
      {pnl ? (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-xs text-muted">{view.legs.length > 1 ? "Net per unit" : "Average cost"}</dt>
            <dd className="tabular-nums">{formatPrice(pnl.entryPerUnit)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Realized</dt>
            <dd className={`tabular-nums ${tone(pnl.realized)}`}>{money(pnl.realized)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Unrealized</dt>
            <dd className={`tabular-nums ${tone(pnl.unrealized)}`}>
              {pnl.unpriced ? "Not priced" : money(pnl.unrealized)}
              {pnl.stale ? " *" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Capital at risk</dt>
            <dd className="tabular-nums">{money(pnl.basis)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Units opened</dt>
            <dd className="tabular-nums">{qty(pnl.units)}</dd>
          </div>
        </dl>
      ) : null}
      <TableScroll>
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Leg</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">Avg entry</th>
              <th className="px-3 py-2 text-right">Avg exit</th>
              <th className="px-3 py-2 text-right">Realized</th>
            </tr>
          </thead>
          <tbody>
            {view.legs.map((leg) => {
              const state = states.get(leg.id);
              return (
                <tr key={leg.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    {leg.legIndex + 1}. {legName(leg)}
                    {state?.isClosed ? <span className="block text-xs text-muted">Closed {iso(state.closedAt)}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{state ? qty(state.openQty) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPrice(state?.wavgEntry)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPrice(state?.wavgExit)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone(state?.realized)}`}>{money(state?.realized)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <TableScroll>
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Fill</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {view.fills.map((fill) => {
              const leg = legById.get(fill.legId);
              return (
                <tr key={fill.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{iso(fill.executedAt)}</td>
                  <td className="px-3 py-2">
                    {fillLabel((leg?.side ?? "BUY") as LegSide, fill.intent === "CLOSE" ? "CLOSE" : "OPEN")}
                    {view.legs.length > 1 && leg ? <span className="block text-xs text-muted">Leg {leg.legIndex + 1}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(fill.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPrice(fill.price)}</td>
                  <td className="max-w-[14rem] break-words px-3 py-2 text-xs text-muted">{fill.note}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={deleteFill}>
                      {hidden}
                      <input type="hidden" name="fillId" value={fill.id} />
                      <button type="submit" className="text-xs font-semibold text-[#b42318]">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <form action={addFill} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
        {hidden}
        <div>
          <Label htmlFor="fill-leg">Leg</Label>
          <select id="fill-leg" name="legId" className="pc-control w-full" defaultValue={(openLegs[0] ?? view.legs[0])?.id}>
            {view.legs.map((leg) => (
              <option key={leg.id} value={leg.id}>
                {leg.legIndex + 1}. {legName(leg)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="fill-intent">Fill</Label>
          <select id="fill-intent" name="intent" className="pc-control w-full" defaultValue="OPEN">
            <option value="OPEN">Scale in (open more)</option>
            <option value="CLOSE">Scale out (close some)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="fill-date">Date</Label>
          <Input id="fill-date" name="executedAt" type="date" defaultValue={today} max={today} required />
        </div>
        <div>
          <Label htmlFor="fill-qty">Quantity</Label>
          <Input id="fill-qty" name="quantity" inputMode="decimal" required />
        </div>
        <div>
          <Label htmlFor="fill-price">Price</Label>
          <Input id="fill-price" name="price" inputMode="decimal" required />
        </div>
        <div>
          <Label htmlFor="fill-note">Note</Label>
          <Input id="fill-note" name="note" maxLength={1000} />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit">Record fill</Button>
        </div>
      </form>
      <details className="border-t border-line pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-accent">Add a leg (spread, hedge)</summary>
        <form action={addLeg} className="mt-3 grid gap-3 sm:grid-cols-3">
          {hidden}
          <div>
            <Label htmlFor="leg-kind">Instrument</Label>
            <select id="leg-kind" name="kind" className="pc-control w-full" defaultValue="OPTION">
              <option value="OPTION">Option</option>
              <option value="STOCK">Stock</option>
            </select>
          </div>
          <div>
            <Label htmlFor="leg-side">Opening side</Label>
            <select id="leg-side" name="side" className="pc-control w-full" defaultValue="SELL">
              <option value="BUY">Buy to open (long)</option>
              <option value="SELL">Sell to open (short)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="leg-symbol">Underlying</Label>
            <Input id="leg-symbol" name="symbol" defaultValue={view.symbol} maxLength={24} className="uppercase" />
          </div>
          <div>
            <Label htmlFor="leg-right">Call / put</Label>
            <select id="leg-right" name="optionRight" className="pc-control w-full" defaultValue="CALL">
              <option value="CALL">Call</option>
              <option value="PUT">Put</option>
            </select>
          </div>
          <div>
            <Label htmlFor="leg-strike">Strike</Label>
            <Input id="leg-strike" name="strike" inputMode="decimal" />
          </div>
          <div>
            <Label htmlFor="leg-expiry">Expiry</Label>
            <Input id="leg-expiry" name="expiry" type="date" />
          </div>
          <div>
            <Label htmlFor="leg-ratio">Ratio</Label>
            <Input id="leg-ratio" name="ratio" inputMode="numeric" defaultValue="1" />
          </div>
          <div>
            <Label htmlFor="leg-qty">Quantity</Label>
            <Input id="leg-qty" name="quantity" inputMode="decimal" required />
          </div>
          <div>
            <Label htmlFor="leg-price">Price</Label>
            <Input id="leg-price" name="price" inputMode="decimal" required />
          </div>
          <div>
            <Label htmlFor="leg-date">Date</Label>
            <Input id="leg-date" name="executedAt" type="date" defaultValue={today} max={today} required />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="leg-note">Note</Label>
            <Input id="leg-note" name="note" maxLength={1000} />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary">
              Add leg
            </Button>
          </div>
        </form>
      </details>
      <p className="text-xs text-muted">
        Average cost: each sale books (exit − average cost) as realized P&amp;L. A leg closed out completely stays closed; buying it again is a new position. Return =
        (realized + unrealized) ÷ capital at risk (net debit or credit for a spread). Prices come from market data; * marks a stored price.
      </p>
    </section>
  );
}
