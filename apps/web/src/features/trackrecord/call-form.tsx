import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { CALL_TYPES, FILE_ROLES, FILE_ROLE_LABELS, GAIN_BASIS_LABELS } from "../../../../../modules/performance/archive";
import type { CallProposal, PriceField } from "../../../../../modules/performance/backup-read";
import { saveCall } from "./actions";
import type { CallRow } from "./server";

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : "");
const num = (value: number | null | undefined) => (value == null ? "" : String(value));

function splitText(call: CallRow | null): string {
  if (!call || call.splitSource !== "manual") return "";
  return call.splitFactor >= 1 ? `${Number(call.splitFactor.toFixed(4))}:1` : `1:${Number((1 / call.splitFactor).toFixed(4))}`;
}

/** Marks a value the AI proposed. Prices also say they were read from a document and must be checked. */
function AiHint({ on, price }: { on: boolean; price?: boolean }) {
  if (!on) return null;
  return (
    <span className="mt-1 block text-xs font-semibold text-[#b54708]">
      {price ? "Read from the document by AI: check it against the backup before saving" : "Proposed by AI from the backup"}
    </span>
  );
}

export function CallForm({
  call,
  experts,
  categories,
  defaultExpertId,
  proposal,
}: {
  call: CallRow | null;
  experts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string }[];
  defaultExpertId?: string;
  /** When set, the form opens with the AI's proposed values in place of the stored ones. Saving is the review. */
  proposal?: CallProposal | null;
}) {
  const c = call;
  const p = proposal ?? null;
  const has = (key: keyof CallProposal) => p != null && p[key] != null && p[key] !== "";
  const pick = <T,>(key: keyof CallProposal, stored: T): T | string | number => (p && has(key) ? (p[key] as string | number) : stored);
  const priceProposed = (field: PriceField) => Boolean(p?.priceFields.includes(field));
  return (
    <form action={saveCall} className="space-y-4 rounded-xl border border-line bg-white p-4">
      {c ? <input type="hidden" name="callId" value={c.id} /> : null}
      {p ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          The AI&apos;s proposal is filled in below. Compare each field with the backup, fix anything wrong, then save. Gains are still calculated from market data.
        </p>
      ) : null}
      {p ? <input type="hidden" name="fromProposal" value="1" /> : null}
      {p?.priceFields.map((field) => <input key={field} type="hidden" name="aiFields" value={field} />)}
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
          <select id="call-type" name="callType" className="pc-control w-full" defaultValue={String(pick("callType", c?.callType ?? "Recommendation"))}>
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
        <Input id="call-title" name="title" required maxLength={200} defaultValue={String(pick("title", c?.title ?? ""))} placeholder="What the call was" />
        <AiHint on={has("title")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="call-ticker">Ticker</Label>
          <Input id="call-ticker" name="ticker" maxLength={24} defaultValue={String(pick("ticker", c?.ticker ?? ""))} className="uppercase" />
          <AiHint on={has("ticker")} />
        </div>
        <div>
          <Label htmlFor="call-direction">Direction</Label>
          <select id="call-direction" name="direction" className="pc-control w-full" defaultValue={String(pick("direction", c?.direction ?? "LONG"))}>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
          <AiHint on={has("direction")} />
        </div>
        <div>
          <Label htmlFor="call-date">Call date</Label>
          <Input id="call-date" name="callDate" type="date" defaultValue={String(pick("callDate", iso(c?.callDate)))} />
          <AiHint on={has("callDate")} />
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
          <Input id="call-entry" name="entryPrice" inputMode="decimal" defaultValue={priceProposed("entryPrice") ? num(p?.entryPrice) : num(c?.entryPrice)} />
          <AiHint on={priceProposed("entryPrice")} price />
        </div>
        <div>
          <Label htmlFor="call-source">Where it was published</Label>
          <Input id="call-source" name="source" maxLength={300} defaultValue={String(pick("source", c?.source ?? ""))} />
          <AiHint on={has("source")} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="call-target">Target (from the backup)</Label>
          <Input id="call-target" name="targetPrice" inputMode="decimal" defaultValue={priceProposed("targetPrice") ? num(p?.targetPrice) : num(c?.targetPrice)} />
          <AiHint on={priceProposed("targetPrice")} price />
        </div>
      </div>
      <details className="rounded-lg border border-line p-3" open={Boolean(c?.exitPrice || c?.recordedPeak || c?.recordedPrice || priceProposed("exitPrice"))}>
        <summary className="cursor-pointer text-sm font-semibold text-accent">Exit, recorded peak and prices</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="call-exit">Exit price</Label>
            <Input id="call-exit" name="exitPrice" inputMode="decimal" defaultValue={priceProposed("exitPrice") ? num(p?.exitPrice) : num(c?.exitPrice)} />
            <AiHint on={priceProposed("exitPrice")} price />
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
        <Textarea id="call-quote" name="keyQuote" rows={3} maxLength={4000} defaultValue={String(pick("keyQuote", c?.keyQuote ?? ""))} />
        <AiHint on={has("keyQuote")} />
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
            accept="image/*,application/pdf,video/mp4,video/webm,.docx,.txt,.vtt,.srt"
            className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-4 text-sm"
          />
          <p className="mt-1 text-xs text-muted">Screenshots, PDFs, short videos or transcripts (.txt, .vtt, .srt, .docx), up to 25 MB each. Stored in the database with the call.</p>
          <label className="mt-2 flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="aiRead" defaultChecked className="h-4 w-4" />
            Read new files with AI and propose the fields (you review them before anything changes)
          </label>
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
