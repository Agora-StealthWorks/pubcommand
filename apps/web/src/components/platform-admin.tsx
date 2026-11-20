import type { AppAccessChoice } from "@pubcommand/core";
import { Button, Input, Label } from "@pubcommand/ui";

type FormAction = (formData: FormData) => void | Promise<void>;

const section = "rounded-lg border border-line bg-white p-4";
const heading = "text-sm font-semibold uppercase tracking-wide text-muted";

export type OrgAppRow = {
  moduleId: string;
  name: string;
  description: string;
  alwaysOn: boolean;
  onPlan: boolean;
  choice: AppAccessChoice;
  allowed: boolean;
  /** The org admin switched it off in Settings → Apps. */
  orgSwitchedOff: boolean;
};

function stateLabel(app: OrgAppRow): { text: string; tone: string } {
  if (app.alwaysOn) return { text: "Always on", tone: "bg-canvas text-muted" };
  if (!app.allowed) return { text: app.choice === "BLOCKED" ? "Blocked" : "Not included", tone: "bg-[#fef3f2] text-[#b42318]" };
  if (app.orgSwitchedOff) return { text: "Allowed · off in the org", tone: "bg-canvas text-muted" };
  return { text: "Allowed", tone: "bg-[#ecfdf3] text-[#067647]" };
}

export function OrgAppsSection({ organizationId, apps, canEdit, action }: { organizationId: string; apps: OrgAppRow[]; canEdit: boolean; action: FormAction }) {
  return (
    <section id="apps" className={section}>
      <h2 className={heading}>Apps</h2>
      <p className="mt-2 text-sm text-muted">
        The plan decides which apps this organization gets. Allow or block an app here to change that for this organization only.
        Its admins then switch allowed apps on or off for their team in Settings → Apps. Blocking never deletes data; allowing it again brings everything back.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {apps.map((app) => {
          const state = stateLabel(app);
          return (
            <li key={app.moduleId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">
                  {app.name}{" "}
                  <span className={`ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${state.tone}`}>{state.text}</span>
                </p>
                <p className="pc-break text-xs text-muted">{app.description}</p>
              </div>
              {app.alwaysOn ? (
                <p className="text-xs text-muted">Every organization needs it.</p>
              ) : canEdit ? (
                <form action={action} className="pc-form-row sm:w-auto">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="moduleId" value={app.moduleId} />
                  <select name="access" aria-label={`Access to ${app.name}`} defaultValue={app.choice} className="pc-control w-full sm:w-56">
                    <option value="PLAN">Plan default ({app.onPlan ? "on" : "off"})</option>
                    <option value="ALLOWED">Allowed</option>
                    <option value="BLOCKED">Blocked</option>
                  </select>
                  <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                    Save
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted">{app.choice === "PLAN" ? `Plan default (${app.onPlan ? "on" : "off"})` : app.choice === "ALLOWED" ? "Allowed" : "Blocked"}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type OrgDomainRow = { id: string; hostname: string; status: string; provider: string; targetPath: string; redirectToHost: string | null };

export function DomainRemoveForm({ domain, action, next }: { domain: OrgDomainRow; action: FormAction; next?: "org" }) {
  const id = `confirm-${domain.id}`;
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#b42318]">Remove domain</summary>
      <form action={action} className="mt-2 space-y-2 rounded-md border border-[#fecdca] bg-[#fffbfa] p-3">
        <input type="hidden" name="domainId" value={domain.id} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <p className="pc-break text-sm">
          {domain.hostname} stops serving at once and is removed from PubCommand and from the Railway service
          {domain.redirectToHost ? "" : " (with its www redirect, if any)"}.
          {domain.provider === "CLOUDFLARE_PURCHASED"
            ? " This domain was bought through PubCommand: its registration is NOT cancelled. Cancel or transfer it at the registrar."
            : " The domain's registration is untouched."}
        </p>
        <Label htmlFor={id}>Type {domain.hostname} to confirm</Label>
        <Input id={id} name="confirm" required autoComplete="off" />
        <Button type="submit" variant="danger" className="w-full sm:w-auto">
          Remove {domain.hostname}
        </Button>
      </form>
    </details>
  );
}

export function OrgDomainsSection({ domains, canRemove, action }: { domains: OrgDomainRow[]; canRemove: boolean; action: FormAction }) {
  return (
    <section className={section}>
      <h2 className={heading}>Custom domains</h2>
      {domains.length === 0 ? <p className="mt-2 text-sm text-muted">No custom domains.</p> : null}
      <ul className="mt-2">
        {domains.map((domain) => (
          <li key={domain.id} className="border-t border-line py-3 first:border-t-0">
            <p className="pc-break font-semibold">{domain.hostname}</p>
            <p className="pc-break text-xs text-muted">
              {domain.status} · {domain.provider === "CLOUDFLARE_PURCHASED" ? "Bought in PubCommand" : "Registered elsewhere"} ·{" "}
              {domain.redirectToHost ? `redirects to ${domain.redirectToHost}` : domain.targetPath}
            </p>
            {canRemove && !domain.redirectToHost ? <DomainRemoveForm domain={domain} action={action} next="org" /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrgDangerZone({
  organization,
  deletedAt,
  purgeOn,
  canDelete,
  actions,
}: {
  organization: { id: string; name: string; slug: string };
  deletedAt: Date | null;
  purgeOn: Date | null;
  canDelete: boolean;
  actions: { remove: FormAction; restore: FormAction; purge: FormAction };
}) {
  if (!canDelete) return null;
  const fmt = (date: Date) => date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "America/New_York" });
  return (
    <section className="rounded-lg border border-[#fecdca] bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#b42318]">{deletedAt ? "Deleted organization" : "Delete organization"}</h2>
      {deletedAt ? (
        <>
          <p className="mt-2 text-sm">
            Deleted {fmt(deletedAt)}. Members cannot open it, its subdomain and custom domains return “not found”, and scheduled jobs skip it.
            Nothing has been erased yet.
          </p>
          <p className="mt-1 text-sm font-semibold">It will be permanently deleted on {purgeOn ? fmt(purgeOn) : "—"}.</p>
          <form action={actions.restore} className="mt-3">
            <input type="hidden" name="organizationId" value={organization.id} />
            <Button type="submit" className="w-full sm:w-auto">Restore organization</Button>
          </form>
          <details className="mt-4">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#b42318]">Delete permanently now…</summary>
            <form action={actions.purge} className="mt-2 space-y-2 rounded-md border border-[#fecdca] bg-[#fffbfa] p-3">
              <input type="hidden" name="organizationId" value={organization.id} />
              <p className="text-sm">
                This erases every brand, member, role, note, promo, form, response, funnel, site, file and setting of {organization.name}. It cannot be undone.
                Its custom domains are removed from the Railway service; domains bought through PubCommand stay registered.
                The platform audit log keeps a record that it existed.
              </p>
              <Label htmlFor="purge-confirm">Type {organization.slug} to confirm</Label>
              <Input id="purge-confirm" name="confirm" required autoComplete="off" />
              <Button type="submit" variant="danger" className="w-full sm:w-auto">Permanently delete {organization.slug}</Button>
            </form>
          </details>
        </>
      ) : (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#b42318]">Delete organization…</summary>
          <form action={actions.remove} className="mt-2 space-y-2 rounded-md border border-[#fecdca] bg-[#fffbfa] p-3">
            <input type="hidden" name="organizationId" value={organization.id} />
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Members lose access at once and its subdomain and custom domains stop serving (public funnels, sites and forms return “not found”).</li>
              <li>Scheduled jobs skip it. No data is erased.</li>
              <li>You can restore it for 30 days. After that it is permanently deleted.</li>
            </ul>
            <Label htmlFor="delete-confirm">Type {organization.slug} to confirm</Label>
            <Input id="delete-confirm" name="confirm" required autoComplete="off" />
            <Button type="submit" variant="danger" className="w-full sm:w-auto">Delete {organization.name}</Button>
          </form>
        </details>
      )}
    </section>
  );
}

export function UserDeleteSection({
  user,
  blockedReason,
  action,
}: {
  user: { id: string; email: string; deleted: boolean };
  blockedReason: string | null;
  action: FormAction;
}) {
  return (
    <section className="rounded-lg border border-[#fecdca] bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#b42318]">{user.deleted ? "Deleted account" : "Delete account"}</h2>
      {user.deleted ? (
        <p className="mt-2 text-sm text-muted">This account was deleted. Its email and name were scrubbed and it cannot sign in. Content it created still works.</p>
      ) : blockedReason ? (
        <p className="mt-2 text-sm">{blockedReason}</p>
      ) : (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#b42318]">Delete user…</summary>
          <form action={action} className="mt-2 space-y-2 rounded-md border border-[#fecdca] bg-[#fffbfa] p-3">
            <input type="hidden" name="userId" value={user.id} />
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Signs them out everywhere and removes them from every organization and from staff.</li>
              <li>Scrubs their email and name and turns off sign-in. The email can be invited again as a new account.</li>
              <li>Content they created (notes, promos, projects, forms…) stays and keeps working; it shows as by a deleted user.</li>
              <li>This cannot be undone.</li>
            </ul>
            <Label htmlFor="user-delete-confirm">Type {user.email} to confirm</Label>
            <Input id="user-delete-confirm" name="confirm" required autoComplete="off" />
            <Button type="submit" variant="danger" className="w-full sm:w-auto">Delete {user.email}</Button>
          </form>
        </details>
      )}
    </section>
  );
}
