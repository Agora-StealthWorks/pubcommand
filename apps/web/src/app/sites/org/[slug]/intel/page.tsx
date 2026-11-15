import { can } from "@pubcommand/core";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { isCalendarDate, loadIntelScreen } from "../../../../../../../../modules/intel/index";

export default async function IntelRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!ctx.subject.entitledModuleIds.includes("intel")) {
    return (
      <div>
        <PageHeader title="Intel" description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it.
        </p>
      </div>
    );
  }
  if (!can(ctx.subject, "intel.read", ctx.scope)) return <Denied />;

  const screen = loadIntelScreen({
    organizationId: ctx.resolved.id,
    callDate: query.date,
  });
  const dateValue = isCalendarDate(screen.callDate) ? screen.callDate : "";

  return (
    <div>
      <PageHeader title={screen.title} description={screen.description} />
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Competitors</h2>
        {screen.competitors.length === 0 ? (
          <p className="rounded-lg border border-line bg-white px-4 py-4 text-sm text-muted">
            No competitors for this organization.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {screen.competitors.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 font-medium text-ink">{row.name}</span>
                <span className="pc-break min-w-0 text-muted">{row.domain}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Ingested email</h2>
        {screen.emails.length === 0 ? (
          <p className="rounded-lg border border-line bg-white px-4 py-4 text-sm text-muted">
            No ingested email for this organization.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {screen.emails.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{row.subject}</span>
                  <span className="text-xs text-muted">{row.receivedAt}</span>
                </div>
                <p className="pc-break mt-1 text-sm text-muted">{row.from}</p>
                <p className="mt-2 text-sm text-ink">{row.bodyExcerpt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Historical calls</h2>
        <form action="/intel" className="pc-form-row mb-4 max-w-md">
          <div className="min-w-0">
            <Label htmlFor="intel-call-date">Call date</Label>
            <Input id="intel-call-date" name="date" type="date" defaultValue={dateValue} className="mt-1" />
          </div>
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            Look up
          </Button>
        </form>
        <p className="mb-3 text-sm text-muted">{screen.callMessage}</p>
        {screen.calls.length === 0 ? (
          <p className="rounded-lg border border-line bg-white px-4 py-4 text-sm text-muted">No call rows for this date.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {screen.calls.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{row.title}</span>
                  <Badge tone="accent">EXAMPLE</Badge>
                  <span className="text-xs text-muted">{row.occurredOn}</span>
                </div>
                <p className="mt-2 text-sm text-muted">{row.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
