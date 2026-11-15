import { buildSiteUrl } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { readSession, readStaff, rootDomain } from "@/lib/auth";
import { currentRequest } from "@/lib/request";

export default async function OrgPickerPage() {
  const auth = await readSession();
  const request = await currentRequest();
  if (!auth.user) {
    redirect(buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "marketing" }, pathname: "/login" }));
  }
  const staff = await readStaff(auth.user.id);
  const memberships = await rawPrisma().membership.findMany({
    where: { userId: auth.user.id, status: "ACTIVE" },
    include: { organization: true, role: true },
    orderBy: { organization: { name: "asc" } },
  });
  const adminHref = buildSiteUrl({
    rootDomain: rootDomain(),
    requestHost: request.host,
    site: { kind: "admin" },
    pathname: staff?.totpConfirmedAt && auth.session?.mfaVerified ? "/" : "/2fa",
  });

  return (
    <main data-surface="app" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">PubCommand</p>
      <h1 className="mt-2 break-words text-3xl font-semibold">Choose an organization</h1>
      <p className="pc-break mt-2 text-sm text-muted">{auth.user.email}</p>
      {staff ? (
        <a href={adminHref} className="mt-6 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
          {staff.totpConfirmedAt && auth.session?.mfaVerified ? "Open platform console" : "Finish staff two-factor setup"}
        </a>
      ) : null}
      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
        {memberships.map((membership) => {
          const href = buildSiteUrl({
            rootDomain: rootDomain(),
            requestHost: request.host,
            site: { kind: "org", slug: membership.organization.slug },
            pathname: "/",
          });
          return (
            <li key={membership.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <p className="break-words font-semibold">{membership.organization.name}</p>
                <p className="text-sm text-muted">{membership.role.name}</p>
              </div>
              <a href={href} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">Open</a>
            </li>
          );
        })}
        {memberships.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No organization memberships yet.</li> : null}
      </ul>
    </main>
  );
}
