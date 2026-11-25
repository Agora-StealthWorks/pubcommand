import { Button } from "@pubcommand/ui";

type FormAction = (formData: FormData) => void | Promise<void>;

/**
 * Admin → Plans: the apps a new organization starts with switched on. Apps left out start
 * switched off; the organization can turn them on in Settings → Apps if its plan includes them.
 * Existing organizations are not changed.
 */
export function DefaultAppsForm({
  modules,
  enabledIds,
  canEdit,
  action,
}: {
  modules: { id: string; name: string }[];
  /** Null when never saved: every app on the plan starts on. */
  enabledIds: string[] | null;
  canEdit: boolean;
  action?: FormAction;
}) {
  const on = new Set(enabledIds ?? modules.map((module) => module.id));
  return (
    <section className="mb-6 min-w-0 rounded-lg border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">Default apps for new organizations</h2>
      <p className="mt-1 text-sm text-muted">
        Checked apps start switched on when an organization is created. Unchecked apps start off, and the organization can turn them on in Settings → Apps if its plan includes them. Existing organizations are not changed.
        {enabledIds === null ? " Not set yet: every app on the plan starts on." : ""}
      </p>
      <form action={action} className="mt-3">
        <fieldset disabled={!canEdit} className="flex flex-wrap gap-2">
          <legend className="sr-only">Apps switched on by default</legend>
          {modules.map((module) => (
            <label key={module.id} htmlFor={`default-app-${module.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm">
              <input id={`default-app-${module.id}`} type="checkbox" name="moduleId" value={module.id} defaultChecked={on.has(module.id)} className="h-5 w-5" />
              {module.name}
            </label>
          ))}
        </fieldset>
        {canEdit ? <Button type="submit" className="mt-3 w-full sm:w-auto">Save default apps</Button> : null}
      </form>
    </section>
  );
}
