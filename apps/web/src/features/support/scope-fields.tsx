import { CATEGORIES, categoriesForNiche } from "../../../../../modules/support/taxonomy";

/** The scope pickers: categories (niche-filtered) × audiences. */
export function ScopeFields({ niche, categories, audiences }: { niche: string; categories: string[]; audiences: string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold">What it may read</legend>
        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
          {categoriesForNiche(niche).map((key) => (
            <label key={key} className="flex min-w-0 items-start gap-2 text-sm">
              <input type="checkbox" name="categories" value={key} defaultChecked={categories.includes(key)} className="mt-1" />
              <span className="min-w-0">
                <span className="font-medium">{CATEGORIES[key].label}</span>
                <span className="block text-xs text-muted">{CATEGORIES[key].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold">For whom</legend>
        <div className="mt-1 space-y-1.5 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="audiences" value="public" defaultChecked={audiences.includes("public")} className="mt-1" />
            <span>
              Public knowledge
              <span className="block text-xs text-muted">Safe for anyone, e.g. the website chat.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="audiences" value="member" defaultChecked={audiences.includes("member")} className="mt-1" />
            <span>
              Members-only knowledge
              <span className="block text-xs text-muted">Only for agents behind a member login.</span>
            </span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}
