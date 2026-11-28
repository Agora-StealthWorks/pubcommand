import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteCompetitor, updateCompetitor } from "@/features/intel/actions";
import { CompetitorFields } from "@/features/intel/competitor-fields";
import { intelAccess } from "@/features/intel/context";
import { loadCompetitor } from "@/features/intel/data";
import { TypeBadge, formatDay } from "@/features/intel/ui";
import { EMAIL_TYPE_LABELS, type EmailType } from "../../../../../../../../../../modules/intel/index";

export default async function IntelCompetitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; competitorId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, competitorId } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const competitor = await loadCompetitor(scope.organizationId, scope.brand.id, competitorId);
  if (!competitor) notFound();
  const db = tenantDb(scope.organizationId);
  const [recent, byType] = await Promise.all([
    db.intelEmail.findMany({
      where: { brandId: scope.brand.id, competitorId: competitor.id, deletedAt: null },
      orderBy: { receivedAt: "desc" },
      take: 15,
      select: { id: true, subject: true, receivedAt: true, emailType: true },
    }),
    db.intelEmail.findMany({ where: { brandId: scope.brand.id, competitorId: competitor.id, deletedAt: null }, select: { emailType: true }, take: 5000 }),
  ]);
  const typeCounts = new Map<string, number>();
  for (const row of byType) typeCounts.set(row.emailType ?? "unclassified", (typeCounts.get(row.emailType ?? "unclassified") ?? 0) + 1);

  return (
    <div className="min-w-0">
      <Link href="/intel/competitors" className="text-sm text-accent underline">
        ← Competitors
      </Link>
      <div className="mt-3">
        <Flash error={search.error} notice={search.notice} />
      </div>
      <h2 className="pc-break mb-1 text-xl font-semibold tracking-tight">{competitor.name}</h2>
      <p className="mb-4 text-sm text-muted">
        {byType.length} email{byType.length === 1 ? "" : "s"}
        {[...typeCounts.entries()].map(([type, count]) => ` · ${count} ${(EMAIL_TYPE_LABELS[type as EmailType] ?? "not extracted").toLowerCase()}`).join("")}
        {" · "}
        <Link href={`/intel/captures?competitor=${competitor.id}`} className="text-accent underline">
          See them in the inbox
        </Link>
        {" · "}
        <a href={`/intel/export?competitor=${competitor.id}`} className="text-accent underline">
          Export emails (CSV)
        </a>
        {" · "}
        <a href={`/intel/export?kind=videos&competitor=${competitor.id}`} className="text-accent underline">
          Export videos (CSV)
        </a>
      </p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="min-w-0">
          {scope.canWrite ? (
            <form action={updateCompetitor} className="space-y-4 rounded-xl border border-line bg-white p-4">
              <input type="hidden" name="competitorId" value={competitor.id} />
              <CompetitorFields values={competitor} idPrefix="edit-competitor" />
              <Button type="submit" className="w-full sm:w-auto">
                Save
              </Button>
            </form>
          ) : (
            <div className="rounded-xl border border-line bg-white p-4 text-sm">
              <p className="pc-break">Senders: {[...competitor.senderAddresses, ...competitor.senderDomains].join(", ") || "none"}</p>
              <p className="pc-break mt-1">Websites: {competitor.websites.join(", ") || "none"}</p>
              <p className="pc-break mt-1">Brands and products: {competitor.products.join(", ") || "none"}</p>
              {competitor.notes ? <p className="mt-2 whitespace-pre-wrap">{competitor.notes}</p> : null}
            </div>
          )}
          {scope.canWrite ? (
            <form action={deleteCompetitor} className="mt-4">
              <input type="hidden" name="competitorId" value={competitor.id} />
              <Button type="submit" variant="danger" size="sm">
                Remove competitor
              </Button>
            </form>
          ) : null}
        </section>
        <section className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Latest emails</h3>
          {recent.length === 0 ? (
            <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">No emails matched yet.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
              {recent.map((email) => (
                <li key={email.id}>
                  <Link href={`/intel/emails/${email.id}`} className="block px-4 py-2.5 hover:bg-canvas">
                    <div className="flex items-center gap-2">
                      <TypeBadge type={email.emailType} />
                      <span className="ml-auto text-xs text-muted">{formatDay(email.receivedAt)}</span>
                    </div>
                    <p className="pc-break mt-0.5 text-sm">{email.subject}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
