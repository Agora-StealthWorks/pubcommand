import { Button, Input, Textarea } from "@pubcommand/ui";
import { PROMO_FORMATS, PROMO_TYPES } from "../../../../../modules/editorial/promos";
import { optionsWith } from "../../../../../modules/editorial/options";
import type { LoadedPromo } from "./promos";
import { Field } from "./ui";

type Props = {
  action: (formData: FormData) => Promise<void>;
  promo?: LoadedPromo;
  stages: string[];
  publications: { code: string; name: string }[];
  editors: string[];
};

/** Create / edit a calendar promo. Publication and editors come from Publication Setup. */
export function PromoForm({ action, promo, stages, publications, editors }: Props) {
  const p = promo;
  const pubs = p?.product && !publications.some((x) => x.code === p.product) ? [...publications, { code: p.product, name: "(not in Publication Setup)" }] : publications;
  const editorNames = [...new Set([...editors, ...(p?.gurus ?? [])])];
  return (
    <form action={action} className="space-y-5">
      {p ? <input type="hidden" name="promoId" value={p.id} /> : null}
      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <Field label="Name">
          <Input name="name" required maxLength={200} defaultValue={p?.name ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Stage">
            <select name="stage" className="pc-control w-full" defaultValue={p?.stage ?? stages[0]}>
              {optionsWith(stages, p?.stage).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <Input name="promoType" list="cal-promo-types" defaultValue={p?.promoType ?? ""} maxLength={60} />
          </Field>
          <Field label="Format">
            <Input name="format" list="cal-promo-formats" defaultValue={p?.format ?? ""} maxLength={80} />
          </Field>
        </div>
        <datalist id="cal-promo-types">
          {PROMO_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <datalist id="cal-promo-formats">
          {PROMO_FORMATS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Publication" hint={publications.length ? undefined : "Add publications in Publication Setup."}>
            <select name="product" className="pc-control w-full" defaultValue={p?.product ?? ""}>
              <option value="">None</option>
              {pubs.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} · {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Copywriters" hint="Separate names with commas.">
            <Input name="writers" maxLength={600} defaultValue={p?.writers.join(", ") ?? ""} />
          </Field>
        </div>
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium text-ink">Editors</legend>
          {editorNames.length ? (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {editorNames.map((name) => (
                <label key={name} className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="gurus" value={name} defaultChecked={p?.gurus.includes(name)} /> {name}
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted">No editors yet. Add them in Publication Setup.</p>
          )}
        </fieldset>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Dates</h2>
        <p className="text-sm text-muted">Once the promo is past Idea and has a date, its launch event is added to the calendar (once; deleting it never brings it back).</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Targeted date">
            <input type="date" name="targetedDate" className="pc-control w-full" defaultValue={p?.targetedDate ?? ""} />
          </Field>
          <Field label="Launch date">
            <input type="date" name="launchDate" className="pc-control w-full" defaultValue={p?.launchDate ?? ""} />
          </Field>
          <label className="flex min-h-11 items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="launchEstimated" value="1" defaultChecked={p?.launchEstimated} /> Launch date is an estimate
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Links</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Copy platform">
            <Input name="copyPlatformUrl" type="url" inputMode="url" maxLength={1000} defaultValue={p?.copyPlatformUrl ?? ""} />
          </Field>
          <Field label="Hotlist page">
            <Input name="hotlistPageUrl" type="url" inputMode="url" maxLength={1000} defaultValue={p?.hotlistPageUrl ?? ""} />
          </Field>
          <Field label="Promo file">
            <Input name="promoFileUrl" type="url" inputMode="url" maxLength={1000} defaultValue={p?.promoFileUrl ?? ""} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea name="notes" rows={4} defaultValue={p?.notes ?? ""} />
        </Field>
      </section>
      <Button type="submit">{p ? "Save" : "Add promo"}</Button>
    </form>
  );
}
