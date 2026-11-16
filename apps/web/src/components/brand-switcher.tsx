"use client";

import { setBrand } from "@/server/org-actions";

/** Picks the publisher brand you are working in. Saves as soon as it changes. */
export function BrandSwitcher({ brands, current }: { brands: { id: string; name: string }[]; current: string | null }) {
  if (brands.length === 0) return null;
  if (brands.length === 1) {
    return <span className="block truncate px-1 text-sm font-semibold text-ink">{brands[0]!.name}</span>;
  }
  return (
    <form action={setBrand}>
      <label className="sr-only" htmlFor="pc-brand">
        Brand
      </label>
      <select
        id="pc-brand"
        name="brandId"
        defaultValue={current ?? ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="min-h-8 w-full rounded-md border-0 bg-transparent px-0.5 text-sm font-semibold text-ink"
      >
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
    </form>
  );
}
