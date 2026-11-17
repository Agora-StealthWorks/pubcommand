import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { CALL_TYPES, FILE_ROLES, FILE_ROLE_LABELS, GAIN_BASIS_LABELS } from "../../../../../modules/performance/archive";
import { saveCall } from "./actions";
import type { CallRow } from "./server";

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : "");
const num = (value: number | null | undefined) => (value == null ? "" : String(value));

function splitText(call: CallRow | null): string {
  if (!call || call.splitSource !== "manual") return "";
  return call.splitFactor >= 1 ? `${Number(call.splitFactor.toFixed(4))}:1` : `1:${Number((1 / call.splitFactor).toFixed(4))}`;
}

export function CallForm({
  call,
  experts,
  categories,
  defaultExpertId,
}: {
  call: CallRow | null;
  experts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string }[];
  defaultExpertId?: string;
}) {
  const c = call;
  return (
    <form action={saveCall} className="space-y-4 rounded-xl border border-line bg-white p-4">
      {c ? <input type="hidden" name="callId" value={c.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="call-expert">Expert</Label>
          <select id="call-expert" name="expertId" required className="pc-control w-full" defaultValue={c?.expertId ?? defaultExpertId ?? ""}>
            <option value="" disabled>
              Pick an expert
            </option>
            {experts.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="call-type">Type</Label>
          <select id="call-type" name="callType" className="pc-control w-full" defaultValue={c?.callType ?? "Recommendation"}>
            {CALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="call-title">Title</Label>
        <Input id="call-title" name="title" required maxLength={200} defaultValue={c?.title ?? ""} placeholder="What the call was" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="call-ticker">Ticker</Label>
          <Input id="call-ticker" name="ticker" maxLength={24} defaultValue={c?.ticker ?? ""} className="uppercase" />
        </div>
        <div>
          <Label htmlFor="call-direction">Direction</Label>
          <select id="call-direction" name="direction" className="pc-control w-full" defaultValue={c?.direction ?? "LONG"}>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
        </div>
        <div>
          <Label htmlFor="call-date">Call date</Label>
          <Input id="call-date" name="callDate" type="date" defaultValue={iso(c?.callDate)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="call-basis">Gain</Label>
          <select id="call-basis" name="gainBasis" className="pc-control w-full" defaultValue={c?.gainBasis ?? "TODAY"}>
            {Object.entries(GAIN_BASIS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="call-entry">Entry price (from the backup)</Label>
          <Input id="call-entry" name="entryPrice" inputMode="decimal" defaultValue={num(c?.entryPrice)} />
        </div>
        <div>
          <Label htmlFor="call-source">Where it was published</Label>
          <Input id="call-source" name="source" maxLength={300} defaultValue={c?.source ?? ""} />
        </div>
      </div>
      <details className="rounded-lg border border-line p-3" open={Boolean(c?.exitPrice || c?.recordedPeak || c?.recordedPrice)}>
        <summary className="cursor-pointer text-sm font-semibold text-accent">Exit, recorded peak and prices</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="call-exit">Exit price</Label>
            <Input id="call-exit" name="exitPrice" inputMode="decimal" defaultValue={num(c?.exitPrice)} />
          </div>
          <div>
            <Label htmlFor="call-exit-date">Exit date</Label>
            <Input id="call-exit-date" name="exitDate" type="date" defaultValue={iso(c?.exitDate)} />
          </div>
          <div>
            <Label htmlFor="call-peak">Recorded peak</Label>
            <Input id="call-peak" name="recordedPeak" inputMode="decimal" defaultValue={num(c?.recordedPeak)} />
          </div>
          <div>
            <Label htmlFor="call-peak-date">Peak date</Label>
            <Input id="call-peak-date" name="recordedPeakAt" type="date" defaultValue={iso(c?.recordedPeakAt)} />
          </div>
          <div>
            <Label htmlFor="call-recorded">Last recorded price</Label>
            <Input id="call-recorded" name="recordedPrice" inputMode="decimal" defaultValue={num(c?.recordedPrice)} />
            <p className="mt-1 text-xs text-muted">Used, and flagged, only when the market cannot price the symbol.</p>
          </div>
          <div>
            <Label htmlFor="call-recorded-at">Recorded on</Label>
            <Input id="call-recorded-at" name="recordedAt" type="date" defaultValue={iso(c?.recordedAt)} />
          </div>
          <div>
            <Label htmlFor="call-split">Splits since the call</Label>
            <Input id="call-split" name="splitFactor" defaultValue={splitText(c)} placeholder="Blank = detect" />
          </div>
          <div>
            <Label htmlFor="call-price-symbol">Price symbol</Label>
            <Input id="call-price-symbol" name="priceSymbol" maxLength={40} defaultValue={c && c.priceSymbol !== c.ticker ? (c.priceSymbol ?? "") : ""} placeholder="Defaults to the ticker" />
          </div>
        </div>
      </details>
      {categories.length ? (
        <fieldset>
          <legend className="text-sm font-medium">Categories</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((cat) => (
              <label key={cat.id} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-3 text-sm">
                <input type="checkbox" name="categoryIds" value={cat.id} defaultChecked={c?.categoryIds.includes(cat.id)} />
                <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} aria-hidden />
                {cat.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div>
        <Label htmlFor="call-quote">Key quote (verbatim from the backup)</Label>
        <Textarea id="call-quote" name="keyQuote" rows={3} maxLength={4000} defaultValue={c?.keyQuote ?? ""} />
      </div>
      <div>
        <Label htmlFor="call-notes">Notes</Label>
        <Textarea id="call-notes" name="notes" rows={3} maxLength={8000} defaultValue={c?.notes ?? ""} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="min-w-0">
          <Label htmlFor="call-files">Backup files</Label>
          <input
            id="call-files"
            name="files"
            type="file"
            multiple
            accept="image/*,application/pdf,video/mp4,video/webm,.docx,.txt"
            className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-4 text-sm"
          />
          <p className="mt-1 text-xs text-muted">Screenshots, PDFs or short videos, up to 25 MB each. Stored in the database with the call.</p>
        </div>
        <div>
          <Label htmlFor="call-file-role">Files are</Label>
          <select id="call-file-role" name="fileRole" className="pc-control w-full" defaultValue="BACKUP">
            {FILE_ROLES.map((role) => (
              <option key={role} value={role}>
                {FILE_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" className="w-full sm:w-auto">
        {c ? "Save call" : "Add call"}
      </Button>
    </form>
  );
}
