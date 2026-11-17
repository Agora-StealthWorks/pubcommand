import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { savePosition } from "./actions";
import type { PositionRow } from "./server";

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : "");
const num = (value: number | null | undefined) => (value == null ? "" : String(value));

function splitText(position: PositionRow | null): string {
  if (!position || position.splitSource !== "manual") return "";
  const factor = position.splitFactor;
  return factor >= 1 ? `${Number(factor.toFixed(4))}:1` : `1:${Number((1 / factor).toFixed(4))}`;
}

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Add or edit a recommendation. Validation is the same pure validatePosition() the CSV import uses. */
export function PositionForm({ portfolioId, position }: { portfolioId: string; position: PositionRow | null }) {
  const p = position;
  return (
    <form action={savePosition} className="space-y-4 rounded-xl border border-line bg-white p-4">
      <input type="hidden" name="portfolioId" value={portfolioId} />
      {p ? <input type="hidden" name="positionId" value={p.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="pos-symbol" label="Symbol">
          <Input id="pos-symbol" name="symbol" required maxLength={24} defaultValue={p?.symbol ?? ""} placeholder="Ticker" className="uppercase" />
        </Field>
        <Field id="pos-name" label="Name">
          <Input id="pos-name" name="name" maxLength={200} defaultValue={p?.name ?? ""} placeholder="Company or fund" />
        </Field>
        <Field id="pos-asset" label="Asset type">
          <select id="pos-asset" name="assetType" className="pc-control w-full" defaultValue={p?.assetType ?? "STOCK"}>
            <option value="STOCK">Stock</option>
            <option value="ETF">ETF</option>
            <option value="OPTION">Option</option>
            <option value="OTHER">Other (not priced automatically)</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="pos-direction" label="Direction">
          <select id="pos-direction" name="direction" className="pc-control w-full" defaultValue={p?.direction ?? "LONG"}>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
        </Field>
        <Field id="pos-entry-date" label="Entry date">
          <Input id="pos-entry-date" name="entryDate" type="date" required defaultValue={iso(p?.entryDate)} />
        </Field>
        <Field id="pos-entry-price" label="Entry price" hint="As published at the time.">
          <Input id="pos-entry-price" name="entryPrice" inputMode="decimal" required defaultValue={num(p?.entryPrice)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="pos-stop" label="Stop">
          <Input id="pos-stop" name="stopPrice" inputMode="decimal" defaultValue={num(p?.stopPrice)} />
        </Field>
        <Field id="pos-target" label="Target">
          <Input id="pos-target" name="targetPrice" inputMode="decimal" defaultValue={num(p?.targetPrice)} />
        </Field>
        <Field id="pos-weight" label="Weight" hint="For the weighted average. 1 = normal.">
          <Input id="pos-weight" name="weight" inputMode="decimal" defaultValue={num(p?.weight ?? 1)} />
        </Field>
      </div>
      <details className="rounded-lg border border-line p-3" open={p?.assetType === "OPTION"}>
        <summary className="cursor-pointer text-sm font-semibold text-accent">Option contract</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field id="pos-right" label="Call or put">
            <select id="pos-right" name="optionRight" className="pc-control w-full" defaultValue={p?.optionRight ?? ""}>
              <option value="">—</option>
              <option value="CALL">Call</option>
              <option value="PUT">Put</option>
            </select>
          </Field>
          <Field id="pos-strike" label="Strike">
            <Input id="pos-strike" name="strike" inputMode="decimal" defaultValue={num(p?.strike)} />
          </Field>
          <Field id="pos-expiry" label="Expiry">
            <Input id="pos-expiry" name="expiry" type="date" defaultValue={iso(p?.expiry)} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">Entry and exit are the option premium. The contract is priced by its OCC symbol.</p>
      </details>
      <details className="rounded-lg border border-line p-3" open={Boolean(p?.exitPrice)}>
        <summary className="cursor-pointer text-sm font-semibold text-accent">Exit (closes the position)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="pos-exit-date" label="Exit date">
            <Input id="pos-exit-date" name="exitDate" type="date" defaultValue={iso(p?.exitDate)} />
          </Field>
          <Field id="pos-exit-price" label="Exit price">
            <Input id="pos-exit-price" name="exitPrice" inputMode="decimal" defaultValue={num(p?.exitPrice)} />
          </Field>
        </div>
      </details>
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold text-accent">Pricing overrides</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="pos-split" label="Splits since entry" hint="Leave blank to detect from market data. 4:1 for a 4-for-1 split, 1:20 for a reverse split.">
            <Input id="pos-split" name="splitFactor" defaultValue={splitText(p)} placeholder="4:1" />
          </Field>
          <Field id="pos-price-symbol" label="Price symbol" hint="Only if market data uses a different symbol.">
            <Input id="pos-price-symbol" name="priceSymbol" maxLength={40} defaultValue={p && p.priceSymbol !== p.symbol && p.assetType !== "OPTION" ? (p.priceSymbol ?? "") : ""} />
          </Field>
          <Field id="pos-recorded" label="Last recorded price" hint="Used, and flagged, only when no market price is available.">
            <Input id="pos-recorded" name="recordedPrice" inputMode="decimal" defaultValue={num(p?.recordedPrice)} />
          </Field>
          <Field id="pos-recorded-at" label="Recorded on">
            <Input id="pos-recorded-at" name="recordedAt" type="date" defaultValue={iso(p?.recordedAt)} />
          </Field>
        </div>
      </details>
      <Field id="pos-notes" label="Position notes">
        <Textarea id="pos-notes" name="notes" rows={3} maxLength={4000} defaultValue={p?.notes ?? ""} />
      </Field>
      <Button type="submit" className="w-full sm:w-auto">
        {p ? "Save changes" : "Add recommendation"}
      </Button>
    </form>
  );
}
