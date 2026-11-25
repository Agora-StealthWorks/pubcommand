import { platformCan, PLATFORM_PERMISSIONS } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import { Denied, PageHeader } from "@/components/ui";
import { RangePicker, when } from "@/features/usage/parts";
import { clampDays, recentActivities } from "@/features/usage/stats";
import { readSession, readStaff } from "@/lib/auth";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";

const KIND_LABEL: Record<string, string> = { member: "", agent: "AI agent", staff: "Staff", system: "Automatic" };

export default async function UsageActivityPage({ searchParams }: { searchParams: Promise<{ days?: string; org?: string; app?: string; q?: string; person?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.viewAudit)) return <Denied />;
  const days = clampDays(query.days, 7);
  const orgs = await rawPrisma().organization.findMany({ where: { deletedAt: null, NOT: { slug: CONSOLE_ORG_SLUG } }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
  const org = query.org ? orgs.find((item) => item.slug === query.org || item.id === query.org) : null;
  const person = query.person?.trim()
    ? await rawPrisma().user.findFirst({ where: { email: { equals: query.person.trim(), mode: "insensitive" } }, select: { id: true } })
    : null;
  const items =
    query.person?.trim() && !person
      ? []
      : await recentActivities({ days, orgId: org?.id ?? null, app: query.app?.trim() || null, actorId: person?.id ?? null, query: query.q?.trim() || null, take: 300 });
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Activity"
          description="What people did and made in every organization, with a snapshot of the copy (titles, fields, headlines, body text). Secrets and contact details are never copied. Updated every 10 minutes."
        />
        <RangePicker days={days} base="/usage/activity" extra={{ org: query.org, app: query.app, q: query.q, person: query.person }} />
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input type="hidden" name="days" value={days} />
        <select name="org" defaultValue={org?.slug ?? ""} className="min-h-11 rounded-md border border-line bg-white px-3 text-sm" aria-label="Organization">
          <option value="">All organizations</option>
          {orgs.map((item) => (
            <option key={item.id} value={item.slug}>{item.name}</option>
          ))}
        </select>
        <Input name="app" defaultValue={query.app ?? ""} placeholder="App (forms, funnels…)" aria-label="App" />
        <Input name="person" defaultValue={query.person ?? ""} placeholder="Person's email" aria-label="Person" />
        <Input name="q" defaultValue={query.q ?? ""} placeholder="Words in the copy" aria-label="Search the copy" />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3 text-sm">
            <p>
              <span className="text-muted">{when(item.at)} · {item.organization} · {item.app} · </span>
              <span className="font-medium">{item.who}</span>
              {KIND_LABEL[item.actorKind] ? <span className="ml-1 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">{KIND_LABEL[item.actorKind]}</span> : null} {item.summary}
            </p>
            {item.content ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-accent">What they wrote</summary>
                <pre className="pc-break mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 font-sans text-xs text-ink">{item.content}</pre>
              </details>
            ) : null}
          </li>
        ))}
        {items.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No activity matches.</li> : null}
      </ul>
    </div>
  );
}
