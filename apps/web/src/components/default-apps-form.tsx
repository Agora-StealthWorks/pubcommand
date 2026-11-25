import { NICHE_LABELS, NICHES, type Niche } from "@pubcommand/core";
import { Button } from "@pubcommand/ui";

type FormAction = (formData: FormData) => void | Promise<void>;

/**
 * Admin → Plans: per niche, the apps a new organization starts with switched on. Apps left
 * out start switched off; the organization can turn them on in Settings → Apps if its plan
 * includes them. Existing organizations are not changed.
 */
export function DefaultAppsForm({
  modules,
  byNiche,
  canEdit,
  action,
}: {
  modules: { id: string; name: string }[];
  /** Null for a niche never saved: every app on the plan starts on. */
  byNiche: Record<Niche, string[] | null>;
  canEdit: boolean;
  action?: FormAction;
}) {
  return (
    <section className="mb-6 min-w-0 rounded-lg border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">Default apps for new organizations</h2>
      <p className="mt-1 text-sm text-muted">
        Per niche (chosen when the organization is created). Checked apps start switched on. Unchecked apps start off, and the organization can turn them on in Settings → Apps if its plan includes them. Existing organizations are not changed.
      </p>
      <div className="mt-3 space-y-3">
        {NICHES.map((niche) => {
          const saved = byNiche[niche];
          const on = new Set(saved ?? modules.map((module) => module.id));
          return (
            <details key={niche} className="rounded-md border border-line">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 text-sm font-semibold">
                {NICHE_LABELS[niche]}
                <span className="font-normal text-muted">{saved ? `${saved.length} of ${modules.length} apps on` : "Not set: every plan app starts on"}</span>
              </summary>
              <form action={action} className="border-t border-line p-3">
                <input type="hidden" name="niche" value={niche} />
                <fieldset disabled={!canEdit} className="flex flex-wrap gap-2">
                  <legend className="sr-only">Apps switched on by default for {NICHE_LABELS[niche]}</legend>
                  {modules.map((module) => (
                    <label key={module.id} htmlFor={`default-app-${niche}-${module.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm">
                      <input id={`default-app-${niche}-${module.id}`} type="checkbox" name="moduleId" value={module.id} defaultChecked={on.has(module.id)} className="h-5 w-5" />
                      {module.name}
                    </label>
                  ))}
                </fieldset>
                {canEdit ? <Button type="submit" className="mt-3 w-full sm:w-auto">Save {NICHE_LABELS[niche]} defaults</Button> : null}
              </form>
            </details>
          );
        })}
      </div>
    </section>
  );
}
