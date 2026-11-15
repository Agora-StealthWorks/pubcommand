import { rawPrisma } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import { Flash, PageHeader } from "@/components/ui";
import { overrideSlug } from "@/server/platform-actions";

export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const organizations = await rawPrisma().organization.findMany({
    include: { slugHistory: { orderBy: { retiredAt: "desc" } } },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader
        title="Domains"
        description="Phase 1 serves every organization on {slug}.pubcommand.com. Custom domains such as hub.agora.com are Phase 6 and are not created here."
      />
      <Flash error={query.error} notice={query.notice} />
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
    </div>
  );
}
