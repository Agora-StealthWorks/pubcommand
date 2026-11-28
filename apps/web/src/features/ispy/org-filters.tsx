"use client";

import { useRef } from "react";

type Option = { id: string; name: string };

/**
 * The feed's linked dropdowns. The server renders each one with only the options linked
 * to the other choices (feedFacets); changing one submits the form so the others narrow.
 * Changing publisher/publication/list/guru clears the narrower choices that may no longer fit.
 */
export function LinkedFilters({
  action,
  hidden,
  publishers,
  publications,
  lists,
  gurus,
  values,
  types,
}: {
  action: string;
  hidden: Record<string, string | undefined>;
  publishers: Option[];
  publications: Option[];
  lists: Option[];
  gurus: Option[];
  values: { publisherId?: string; publicationId?: string; listId?: string; guruId?: string; type?: string; when?: string; q?: string; resent?: string };
  types: { value: string; label: string }[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const submit = () => form.current?.requestSubmit();
  const select = (id: string, name: string, label: string, options: Option[], value: string | undefined, all: string) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} onChange={submit} className="pc-control w-full min-w-0">
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {value && !options.some((o) => o.id === value) ? <option value={value}>(current choice)</option> : null}
      </select>
    </div>
  );
  return (
    <form ref={form} action={action} className="grid gap-3 border-b border-line bg-[#fafbfc] p-4 sm:grid-cols-2 lg:grid-cols-4">
      {Object.entries(hidden).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      {select("f-publisher", "publisher", "Publisher", publishers, values.publisherId, "All publishers")}
      {select("f-publication", "publication", "Publication", publications, values.publicationId, "All publications")}
      {select("f-list", "list", "List", lists, values.listId, "All lists")}
      {select("f-guru", "guru", "Guru", gurus, values.guruId, "All gurus")}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="f-type" className="text-xs font-semibold text-muted">
          Type
        </label>
        <select id="f-type" name="type" defaultValue={values.type ?? ""} onChange={submit} className="pc-control w-full">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="f-when" className="text-xs font-semibold text-muted">
          When
        </label>
        <select id="f-when" name="when" defaultValue={values.when ?? "30"} onChange={submit} className="pc-control w-full">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="f-q" className="text-xs font-semibold text-muted">
          Search
        </label>
        <input id="f-q" name="q" defaultValue={values.q ?? ""} placeholder="Subject, sender or text" className="pc-control w-full" />
      </div>
      <div className="flex items-end gap-3">
        <label className="inline-flex min-h-10 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="resent" value="1" defaultChecked={values.resent === "1"} onChange={submit} /> Re-sent copy only
        </label>
        <button type="submit" className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
          Apply
        </button>
      </div>
    </form>
  );
}
