import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { extractAllPending } from "@/features/intel/actions";
import { intelAccess } from "@/features/intel/context";
import { PAGE_SIZE, competitorOptions, inboxCounts, listInbox, readFilters } from "@/features/intel/data";
import { entityOptions } from "@/features/intel/registry";
import { AiMissingNotice, TypeBadge, formatDay } from "@/features/intel/ui";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { EMAIL_TYPES, EMAIL_TYPE_LABELS } from "../../../../../../../../modules/intel/index";

export default async function IntelInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const filters = readFilters(search);
  const [inbox, counts, competitors, experts, lists, topics] = await Promise.all([
    listInbox(scope.organizationId, scope.brand.id, filters),
    inboxCounts(scope.organizationId, scope.brand.id),
    competitorOptions(scope.organizationId, scope.brand.id),
    entityOptions(scope.organizationId, scope.brand.id, "expert"),
    entityOptions(scope.organizationId, scope.brand.id, "list"),
    entityOptions(scope.organizationId, scope.brand.id, "topic"),
  ]);
  const registryFilters = [
    { key: "list" as const, label: "List", options: lists, value: filters.list },
    { key: "expert" as const, label: "Expert", options: experts, value: filters.expert },
    { key: "topic" as const, label: "Topic", options: topics, value: filters.topic },
  ];
  const ai = aiConfigured();
  const pages = Math.max(1, Math.ceil(inbox.total / PAGE_SIZE));
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (key !== "page" && value) query.set(key, String(value));
    if (page > 1) query.set("page", String(page));
    const text = query.toString();
    return text ? `/intel?${text}` : "/intel";
  };
  const filtered = Boolean(filters.competitor || filters.type || filters.from || filters.to || filters.q || filters.expert || filters.list || filters.topic);
  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (key !== "page" && value) exportQuery.set(key, String(value));
  const exportHref = `/intel/export${exportQuery.toString() ? `?${exportQuery.toString()}` : ""}`;

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      {!ai && counts.emails > 0 ? <AiMissingNotice what="emails are stored and matched to competitors but not extracted" /> : null}
      {counts.queued + counts.running > 0 ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Extracting {counts.queued + counts.running} email{counts.queued + counts.running === 1 ? "" : "s"} · <AutoRefresh everyMs={6000} />
        </p>
      ) : null}

      <form action="/intel" className="mb-4 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]">
        <div className="min-w-0">
          <Label htmlFor="intel-q">Search</Label>
          <Input id="intel-q" name="q" defaultValue={filters.q} placeholder="Subject, sender or text" className="mt-1" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="intel-competitor">Competitor</Label>
          <select id="intel-competitor" name="competitor" defaultValue={filters.competitor} className="pc-control mt-1 w-full">
            <option value="">All</option>
            {competitors.map((competitor) => (
              <option key={competitor.id} value={competitor.id}>
                {competitor.name}
              </option>
            ))}
            <option value="none">Not matched</option>
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="intel-type">Type</Label>
          <select id="intel-type" name="type" defaultValue={filters.type} className="pc-control mt-1 w-full">
            <option value="">All</option>
            {EMAIL_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMAIL_TYPE_LABELS[type]}
              </option>
            ))}
            <option value="unclassified">Not extracted</option>
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="intel-from">From</Label>
          <Input id="intel-from" name="from" type="date" defaultValue={filters.from} className="mt-1" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="intel-to">To</Label>
          <Input id="intel-to" name="to" type="date" defaultValue={filters.to} className="mt-1" />
        </div>
        <details className="min-w-0 sm:col-span-2 lg:order-last lg:col-span-full" open={Boolean(filters.expert || filters.list || filters.topic)}>
          <summary className="cursor-pointer text-sm font-semibold text-accent">List, expert and topic</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {registryFilters.map((filter) => (
              <div key={filter.key} className="min-w-0">
                <Label htmlFor={`intel-${filter.key}`}>{filter.label}</Label>
                <select id={`intel-${filter.key}`} name={filter.key} defaultValue={filter.value} className="pc-control mt-1 w-full">
                  <option value="">All</option>
                  {filter.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </details>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            Filter
          </Button>
          {filtered ? (
            <Link href="/intel" className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {inbox.total} email{inbox.total === 1 ? "" : "s"}
          {filtered ? " match" : ""}
          {counts.unmatched ? (
            <>
              {" · "}
              <Link href="/intel?competitor=none" className="underline">
                {counts.unmatched} not matched to a competitor
              </Link>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a href={exportHref} className="text-sm text-accent underline">
            Export CSV
          </a>
          {scope.canWrite && ai ? (
            <form action={extractAllPending}>
              <Button type="submit" variant="secondary" size="sm">
                Extract all pending
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {inbox.rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6 text-sm text-muted">
          {filtered ? (
            "No emails match these filters."
          ) : (
            <>
              <p className="font-semibold text-ink">No competitor emails yet.</p>
              <p className="mt-1">
                Add competitors, then <Link href="/intel/add" className="text-accent underline">upload .eml or .mbox files</Link>, paste an email, or{" "}
                <Link href="/intel/gmail" className="text-accent underline">connect a Gmail inbox</Link> that is subscribed to their lists.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {inbox.rows.map((row) => (
            <li key={row.id}>
              <Link href={`/intel/emails/${row.id}`} className="block px-4 py-3 hover:bg-canvas">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 max-w-full truncate text-sm font-semibold text-ink">{row.competitor?.name ?? row.fromName ?? row.fromAddress}</span>
                  <TypeBadge type={row.emailType} />
                  {row.extractionStatus === "QUEUED" || row.extractionStatus === "RUNNING" ? <Badge tone="warn">extracting</Badge> : null}
                  {row.extractionStatus === "FAILED" ? <Badge tone="danger">failed</Badge> : null}
                  {!row.competitor ? <Badge>not matched</Badge> : null}
                  <span className="ml-auto shrink-0 text-xs text-muted">{formatDay(row.receivedAt)}</span>
                </div>
                <p className="pc-break mt-0.5 text-sm text-ink">{row.subject}</p>
                <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted">
                  <span className="pc-break">{row.fromAddress}</span>
                  {row.snippet ? ` · ${row.snippet}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          {filters.page > 1 ? <Link href={pageHref(filters.page - 1)} className="text-accent underline">← Newer</Link> : <span />}
          <span className="text-muted">
            Page {filters.page} of {pages}
          </span>
          {filters.page < pages ? <Link href={pageHref(filters.page + 1)} className="text-accent underline">Older →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
