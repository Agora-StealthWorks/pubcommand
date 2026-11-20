import { buildSiteUrl } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { readSession, readStaff, rootDomain, staffReady } from "@/lib/auth";
import { currentRequest } from "@/lib/request";

export default async function OrgPickerPage() {
  const auth = await readSession();
  const request = await currentRequest();
  if (!auth.user) {
    redirect(buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "marketing" }, pathname: "/login" }));
  }
  const staff = await readStaff(auth.user.id);
  const memberships = await rawPrisma().membership.findMany({
    where: { userId: auth.user.id, status: "ACTIVE", organization: { deletedAt: null } },
    include: { organization: true, role: true },
    orderBy: { organization: { name: "asc" } },
  });
  const adminHref = buildSiteUrl({
    rootDomain: rootDomain(),
    requestHost: request.host,
    site: { kind: "admin" },
    pathname: staffReady(staff, auth.session) ? "/" : "/2fa",
  });

  // One workspace: go straight to its dashboard, like signing in to OxfordHub.
  if (memberships.length === 1) {
    redirect(
      buildSiteUrl({
        rootDomain: rootDomain(),
        requestHost: request.host,
        site: { kind: "org", slug: memberships[0]!.organization.slug },
        pathname: "/",
      }),
    );
  }

  return (
    <main data-surface="app" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">PubCommand</p>
      <h1 className="mt-2 break-words text-3xl font-semibold">Choose a workspace</h1>
      <p className="pc-break mt-2 text-sm text-muted">{auth.user.email}</p>
      {staff ? (
        <a href={adminHref} className="mt-6 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
          {staffReady(staff, auth.session) ? "Open platform console" : "Finish staff two-factor setup"}
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
        {memberships.length === 0 ? <li className="px-4 py-6 text-sm text-muted">You do not have access to any organization. Ask your admin for an invite.</li> : null}
      </ul>
    </main>
  );
}
