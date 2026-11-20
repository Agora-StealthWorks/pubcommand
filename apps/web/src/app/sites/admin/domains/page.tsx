import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { platformTx, rawPrisma } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { DomainRemoveForm } from "@/components/platform-admin";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";
import { overrideSlug, removeCustomDomain } from "@/server/platform-actions";

export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.viewOrgs)) return <Denied title="Platform staff only" />;
  const canRemove = platformCan(staff.role, PLATFORM_PERMISSIONS.deleteData);
  const [organizations, domains] = await Promise.all([
    rawPrisma().organization.findMany({
      where: { deletedAt: null },
      include: { slugHistory: { orderBy: { retiredAt: "desc" } } },
      orderBy: { name: "asc" },
    }),
    platformTx((tx) => tx.customDomain.findMany({ orderBy: { hostname: "asc" } })),
  ]);
  const orgNames = new Map(
    (await rawPrisma().organization.findMany({ select: { id: true, name: true, deletedAt: true } })).map((org) => [org.id, org]),
  );
  return (
    <div className="space-y-8">
      <PageHeader title="Domains" description="Custom domains connected by organizations, and each organization's subdomain." />
      <Flash error={query.error} notice={query.notice} />
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Custom domains</h2>
        {domains.length === 0 ? <p className="rounded-lg border border-line bg-white p-4 text-sm text-muted">No custom domains are connected.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {domains.map((domain) => {
                const org = orgNames.get(domain.organizationId);
                return (
                  <li key={domain.id} className="px-4 py-3">
                    <p className="pc-break font-semibold">{domain.hostname}</p>
                    <p className="pc-break text-xs text-muted">
                      <Link href={`/orgs/${domain.organizationId}`} className="font-semibold text-accent">{org?.name ?? "Unknown"}</Link>
                      {org?.deletedAt ? " (deleted, not served)" : ""} · {domain.status} ·{" "}
                      {domain.provider === "CLOUDFLARE_PURCHASED" ? "Bought in PubCommand" : "Registered elsewhere"} ·{" "}
                      {domain.redirectToHost ? `redirects to ${domain.redirectToHost}` : domain.targetPath}
                    </p>
                    {canRemove && !domain.redirectToHost ? (
                      <DomainRemoveForm
                        domain={{ id: domain.id, hostname: domain.hostname, status: domain.status, provider: domain.provider, targetPath: domain.targetPath, redirectToHost: domain.redirectToHost }}
                        action={removeCustomDomain}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Subdomains</h2>
        <ul className="space-y-4">
          {organizations.map((organization) => (
            <li key={organization.id} className="rounded-lg border border-line bg-white p-4">
              <p className="font-semibold">{organization.name}</p>
              <p className="pc-break text-sm text-muted">{organization.slug}.{process.env.ROOT_DOMAIN}</p>
              {organization.slugHistory.length > 0 ? (
                <p className="pc-break mt-1 text-xs text-muted">Redirects: {organization.slugHistory.map((row) => row.slug).join(", ")}</p>
              ) : null}
              <form action={overrideSlug} className="pc-form-row mt-3">
                <input type="hidden" name="organizationId" value={organization.id} />
                <Input name="slug" defaultValue={organization.slug} className="md:max-w-xs" />
                <Button type="submit" variant="secondary" className="w-full md:w-auto">Override slug</Button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
