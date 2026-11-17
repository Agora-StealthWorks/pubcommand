import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { GATE_RULES } from "../../../../../modules/support/gate";
import { CATEGORIES, RECORD_CATEGORIES } from "../../../../../modules/support/taxonomy";
import { saveRecordAction } from "./actions";

export type RecordFormValues = {
  id?: string;
  category: string;
  audience: string;
  status: string;
  title: string;
  body: string;
  summary: string;
  url: string | null;
  tags: string[];
  publicationCodes: string[];
  gateOverrides: string[];
  priceConfirmed: boolean;
};

export function RecordForm({ values, canPublish, gapId, publicationCodes }: { values: RecordFormValues; canPublish: boolean; gapId?: string; publicationCodes: { code: string; name: string }[] }) {
  return (
    <form action={saveRecordAction} className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      {values.id ? <input type="hidden" name="recordId" value={values.id} /> : null}
      {gapId ? <input type="hidden" name="gapId" value={gapId} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <Label htmlFor="r-category">Category</Label>
          <select id="r-category" name="category" defaultValue={values.category} className="pc-control w-full" required>
            {RECORD_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {CATEGORIES[key].label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="r-audience">Who may hear it</Label>
          <select id="r-audience" name="audience" defaultValue={values.audience} className="pc-control w-full">
            <option value="public">Public (anyone)</option>
            <option value="member">Members only</option>
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="r-status">Status</Label>
          <select id="r-status" name="status" defaultValue={values.status} className="pc-control w-full">
            <option value="draft">Draft (agents never see it)</option>
            <option value="published" disabled={!canPublish}>
              Published{canPublish ? "" : " (publishers only)"}
            </option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="r-title">Title</Label>
        <Input id="r-title" name="title" defaultValue={values.title} maxLength={300} required placeholder="How do I reset my password?" />
      </div>
      <div>
        <Label htmlFor="r-body">Answer the agent may give</Label>
        <Textarea id="r-body" name="body" defaultValue={values.body} rows={10} required />
        <p className="mt-1 text-xs text-muted">Write it as you would say it to a customer. Markdown is fine. Never paste internal notes, marketing results or discount codes.</p>
      </div>
      <div>
        <Label htmlFor="r-summary">Short summary (optional)</Label>
        <Textarea id="r-summary" name="summary" defaultValue={values.summary} rows={2} maxLength={2000} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="r-url">Link (optional)</Label>
          <Input id="r-url" name="url" defaultValue={values.url ?? ""} inputMode="url" placeholder="https://" maxLength={1000} />
        </div>
        <div className="min-w-0">
          <Label htmlFor="r-pubs">Publication codes (optional)</Label>
          <Input id="r-pubs" name="publicationCodes" defaultValue={values.publicationCodes.join(", ")} list="r-pub-list" placeholder={publicationCodes[0]?.code ?? "CODE"} />
          <datalist id="r-pub-list">
            {publicationCodes.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </datalist>
        </div>
      </div>
      <div>
        <Label htmlFor="r-tags">Tags (comma separated)</Label>
        <Input id="r-tags" name="tags" defaultValue={values.tags.join(", ")} />
      </div>
      {canPublish ? (
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Publisher checks</legend>
          <div className="space-y-2 text-sm">
            {GATE_RULES.filter((rule) => rule.overridable).map((rule) => (
              <label key={rule.id} className="flex items-start gap-2">
                <input type="checkbox" name="gateOverrides" value={rule.id} defaultChecked={values.gateOverrides.includes(rule.id)} className="mt-1" />
                <span>
                  Allow “{rule.label}”: {rule.id === "discount" ? "this offer is on the public website for anyone." : "naming another company here is public information, not our intelligence."}
                </span>
              </label>
            ))}
            {values.category === "pricing" || !values.id ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" name="confirmPrice" defaultChecked={values.priceConfirmed} className="mt-1" />
                <span>Pricing: I confirm this is the current retail list price (a pricing record cannot be published without it).</span>
              </label>
            ) : null}
          </div>
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
