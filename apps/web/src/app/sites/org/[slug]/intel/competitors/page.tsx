import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { addCompetitorFromDomain, createCompetitor } from "@/features/intel/actions";
import { CompetitorFields } from "@/features/intel/competitor-fields";
import { intelAccess } from "@/features/intel/context";
import { listCompetitors, unmatchedSenders } from "@/features/intel/data";
import { formatDay } from "@/features/intel/ui";

export default async function IntelCompetitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const [competitors, unmatched] = await Promise.all([listCompetitors(scope.organizationId, scope.brand.id), unmatchedSenders(scope.organizationId, scope.brand.id)]);

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Competitors · {competitors.length}</h2>
          {competitors.length === 0 ? (
            <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
              No competitors yet. Add the publishers you watch with their sender addresses or domains, and their emails are matched automatically.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
              {competitors.map((competitor) => (
                <li key={competitor.id}>
                  <Link href={`/intel/competitors/${competitor.id}`} className="block px-4 py-3 hover:bg-canvas">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 font-semibold text-ink">{competitor.name}</span>
                      {competitor.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                      <span className="ml-auto text-xs text-muted">
                        {competitor.emailCount} email{competitor.emailCount === 1 ? "" : "s"}
                        {competitor.lastEmailAt ? ` · last ${formatDay(competitor.lastEmailAt)}` : ""}
                      </span>
                    </div>
                    <p className="pc-break mt-0.5 text-xs text-muted">
                      {[...competitor.senderAddresses, ...competitor.senderDomains].join(", ") || "No senders yet"}
                    </p>
                    {competitor.products.length ? <p className="pc-break mt-0.5 text-xs text-ink">{competitor.products.join(" · ")}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {unmatched.length ? (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Senders not matched yet</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                {unmatched.map((sender) => (
                  <li key={sender.domain} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="pc-break text-sm font-medium">{sender.domain}</p>
                      <p className="pc-break text-xs text-muted">
                        {sender.count} email{sender.count === 1 ? "" : "s"}
                        {sender.names.length ? ` · ${sender.names.join(", ")}` : ""}
                      </p>
                    </div>
                    {scope.canWrite ? (
                      <form action={addCompetitorFromDomain}>
                        <input type="hidden" name="domain" value={sender.domain} />
                        <input type="hidden" name="name" value={sender.names[0] ?? ""} />
                        <Button type="submit" variant="secondary" size="sm">
                          Add as competitor
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {scope.canWrite ? (
          <section className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Add a competitor</h2>
            <form action={createCompetitor} className="space-y-4 rounded-xl border border-line bg-white p-4">
              <CompetitorFields idPrefix="new-competitor" />
              <Button type="submit" className="w-full sm:w-auto">
                Add competitor
              </Button>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
