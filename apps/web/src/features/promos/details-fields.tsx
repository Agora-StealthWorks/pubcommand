import { Input, Label } from "@pubcommand/ui";
import { PROMO_STATUSES, PROMO_TYPES } from "../../../../../modules/promo-studio/analysis";
import { NamePicker } from "../pubsetup/pickers";

/** Picks from Publication Setup (features/pubsetup/read.ts getPickerOptions). Free text still works. */
export type DetailsOptions = { publishers: string[]; publications: { code: string; name: string }[]; editors: string[] };

type Values = {
  publisher?: string | null;
  gurus?: string[];
  product?: string | null;
  promoType?: string | null;
  promoStatus?: string | null;
  promoCode?: string | null;
  runStartDate?: Date | null;
  pricePoint?: number | null;
};

/** Shared by the upload form and the Details tab. */
export function PromoDetailsFields({ values = {}, options }: { values?: Values; options?: DetailsOptions }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options ? (
        <>
          <datalist id="pubsetup-publishers">
            {options.publishers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id="pubsetup-products">
            {options.publications.map((pub) => (
              <option key={pub.code} value={pub.name} label={pub.code} />
            ))}
          </datalist>
        </>
      ) : null}
      <div>
        <Label htmlFor="publisher">Publisher</Label>
        <Input id="publisher" name="publisher" defaultValue={values.publisher ?? ""} maxLength={200} list={options ? "pubsetup-publishers" : undefined} />
      </div>
      <div>
        <Label htmlFor="gurus">Guru(s)</Label>
        <Input id="gurus" name="gurus" defaultValue={values.gurus?.join(", ") ?? ""} placeholder="Comma separated" />
        {options ? <NamePicker inputId="gurus" names={options.editors} label="Pick editors" /> : null}
      </div>
      <div>
        <Label htmlFor="product">Product</Label>
        <Input id="product" name="product" defaultValue={values.product ?? ""} maxLength={200} list={options ? "pubsetup-products" : undefined} />
      </div>
      <div>
        <Label htmlFor="pricePoint">Price</Label>
        <Input id="pricePoint" name="pricePoint" defaultValue={values.pricePoint ?? ""} inputMode="decimal" placeholder="49" />
      </div>
      <div>
        <Label htmlFor="promoType">Promo type</Label>
        <select id="promoType" name="promoType" defaultValue={values.promoType ?? ""} className="pc-control mt-1 w-full">
          <option value="">Detect automatically</option>
          {PROMO_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="promoStatus">Status</Label>
        <select id="promoStatus" name="promoStatus" defaultValue={values.promoStatus ?? ""} className="pc-control mt-1 w-full">
          <option value="">Not set</option>
          {PROMO_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="promoCode">Promo / creative code</Label>
        <Input id="promoCode" name="promoCode" defaultValue={values.promoCode ?? ""} maxLength={80} />
      </div>
      <div>
        <Label htmlFor="runStartDate">Started running</Label>
        <Input id="runStartDate" name="runStartDate" type="date" defaultValue={values.runStartDate ? values.runStartDate.toISOString().slice(0, 10) : ""} />
      </div>
    </div>
  );
}
