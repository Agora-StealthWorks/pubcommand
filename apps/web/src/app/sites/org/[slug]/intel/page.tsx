import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { qs, ispyOrgScope } from "@/features/ispy/org-data";
import { LinkedFilters } from "@/features/ispy/org-filters";
import { FeedLocked, FeedSwitcher, IspyTypeBadge, KindBadge, SortLink, Stat, shortDay } from "@/features/ispy/org-ui";
import { FEED_SORTS, alerts, feedCounts, feedFacets, listFeed, weekNumbers, type FeedKind, type FeedQuery, type FeedSort } from "@/features/ispy/read";
import { EMAIL_TYPES, EMAIL_TYPE_LABELS, FEED_LABELS } from "../../../../../../../../modules/ispy/index";

const TABS: { key: string; kind: FeedKind; label: string }[] = [
  { key: "int", kind: "INTERNAL", label: "Internal" },
  { key: "ext", kind: "EXTERNAL", label: "External" },
  { key: "aff", kind: "AFFILIATE", label: "Affiliate Lists" },
];

const UUID = /^[0-9a-f-]{36}$/i;
const uuid = (value: string | undefined) => (value && UUID.test(value) ? value : undefined);

export default async function IspyFeedPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, feed, locked, feeds } = found.value;
  const feedParam = feeds.length > 1 || feed !== feeds[0] ? feed : undefined;

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        The {FEED_LABELS[feed]} feed: every email publishers sent to ISpy&apos;s inboxes, grouped by who sent it.
      </p>
      <FeedSwitcher base="/intel" feed={feed} />
    </div>
  );
  if (locked) {
    return (
      <div className="min-w-0">
        {header}
        <FeedLocked feed={feed} base="/intel" />
      </div>
    );
  }

  const tab = TABS.find((t) => t.key === search.tab) ?? TABS[1]!;
  const sort = (FEED_SORTS as readonly string[]).includes(search.sort ?? "") ? (search.sort as FeedSort) : "date";
  const dir = search.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(search.page) || 1);
  const when = search.when ?? "30";
  const from = when === "all" ? null : new Date(Date.now() - Number(when === "7" || when === "90" ? when : 30) * 86_400_000);
  const sel = { publisherId: uuid(search.publisher), publicationId: uuid(search.publication), listId: uuid(search.list), guruId: uuid(search.guru) };
  const query: FeedQuery = {
    ...sel,
    kind: tab.kind,
    type: search.type || null,
    q: search.q || null,
    from,
    resentOnly: search.resent === "1",
    sort,
    dir,
    page,
    pageSize: 50,
  };
  const [result, counts, facets, numbers, alertList] = await Promise.all([
    listFeed(viewer, query),
    feedCounts(viewer, { ...query, kind: null }),
    feedFacets(viewer, sel),
    weekNumbers(viewer, feed),
    alerts(viewer, feed),
  ]);

  const base = {
    feed: feedParam,
    tab: tab.key === "ext" ? undefined : tab.key,
    publisher: sel.publisherId,
    publication: sel.publicationId,
    list: sel.listId,
    guru: sel.guruId,
    type: search.type,
    when: when === "30" ? undefined : when,
    q: search.q,
    resent: search.resent,
  };
  const sortHref = (column: string, nextDir: "asc" | "desc") => `/intel${qs({ ...base, sort: column === "date" ? undefined : column, dir: nextDir === "desc" ? undefined : nextDir })}`;
  const pageHref = (n: number) => `/intel${qs({ ...base, sort: sort === "date" ? undefined : sort, dir: dir === "desc" ? undefined : dir, page: n > 1 ? n : undefined })}`;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const rowHref = (row: (typeof result.rows)[number]) => `/intel/mail/${row.id}${qs({ feed: feedParam })}`;

  return (
    <div className="min-w-0">
      {header}
      <Flash error={search.error} notice={search.notice} />
      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-xl border border-line bg-white">
          <div role="tablist" aria-label="Who sent it" className="flex flex-wrap gap-1 border-b border-line px-2">
            {TABS.map((t) => (
              <Link
                key={t.key}
                role="tab"
                aria-selected={t.key === tab.key}
                href={`/intel${qs({ ...base, tab: t.key === "ext" ? undefined : t.key, page: undefined })}`}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-[3px] px-3 text-sm font-bold ${t.key === tab.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {t.label} <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">{counts[t.kind].toLocaleString("en-US")}</span>
              </Link>
            ))}
          </div>

          <LinkedFilters
            action="/intel"
            hidden={{ feed: feedParam, tab: base.tab, sort: sort === "date" ? undefined : sort, dir: dir === "desc" ? undefined : dir }}
            publishers={facets.publishers}
            publications={facets.publications}
            lists={facets.lists}
            gurus={facets.gurus}
            values={{ ...sel, type: search.type, when, q: search.q, resent: search.resent }}
            types={EMAIL_TYPES.map((t) => ({ value: t, label: EMAIL_TYPE_LABELS[t] }))}
          />

          {tab.kind === "INTERNAL" ? (
            <p className="border-b border-line bg-[#f2fbf9] px-4 py-3 text-sm text-ink">
              <span className="mr-2 rounded-full bg-[#d3f0eb] px-2 py-0.5 text-xs font-semibold text-[#0b5248]">Teaching your Brain</span>
              Mail from your own publications. Every new copy is saved to your Brain with its key takeaways, offer and topics.
            </p>
          ) : null}
          {tab.kind === "AFFILIATE" ? (
            <p className="border-b border-line bg-[#f7f4ff] px-4 py-3 text-sm text-ink">
              Affiliate files (MarketBeat and others) mail other publishers&apos; offers. Each send is credited to the advertiser on its landing page.
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[76px]" />
                <col className="w-[120px]" />
                <col className="w-[210px]" />
                <col />
                <col className="w-[72px]" />
              </colgroup>
              <thead className="border-b border-line bg-[#fafbfc] text-left">
                <tr>
                  <th scope="col" className="px-3">
                    <SortLink label="Date" column="date" sort={sort} dir={dir} href={sortHref} />
                  </th>
                  <th scope="col" className="px-3">
                    <SortLink label="Type" column="type" sort={sort} dir={dir} href={sortHref} />
                  </th>
                  <th scope="col" className="px-3">
                    <SortLink label="Sender" column="sender" sort={sort} dir={dir} href={sortHref} />
                  </th>
                  <th scope="col" className="px-3">
                    <SortLink label="Subject" column="subject" sort={sort} dir={dir} href={sortHref} />
                  </th>
                  <th scope="col" className="px-3 text-right">
                    <SortLink label="Seen" column="seen" sort={sort} dir={dir} href={sortHref} align="right" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted">
                      No emails match. Try another tab, a wider date range or fewer filters.
                    </td>
                  </tr>
                ) : (
                  result.rows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-[#f8f9fb]">
                      <td className="px-3 py-3 text-xs text-muted">
                        <Link href={rowHref(row)} className="block">
                          {shortDay(row.receivedAt)}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <IspyTypeBadge type={row.emailType} />
                          {tab.kind !== row.kind ? <KindBadge kind={row.kind} /> : null}
                        </div>
                      </td>
                      <td className="min-w-0 px-3 py-3">
                        <span className="pc-break block font-semibold text-ink">{row.publisher ?? row.fromName ?? row.fromAddress}</span>
                        <span className="pc-break block text-xs text-muted">
                          {row.list ?? (row.routeStatus === "CANDIDATE" ? "new list, awaiting approval" : "unsorted")}
                          {row.advertiser && row.advertiser !== row.publisher ? ` → ${row.advertiser}` : ""}
                        </span>
                      </td>
                      <td className="min-w-0 px-3 py-3">
                        <Link href={rowHref(row)} className="pc-break block font-semibold text-ink hover:underline">
                          “{row.subject}”
                        </Link>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {row.isNewPromo && row.promoId ? (
                            <Link href={`/intel/promos/${row.promoId}${qs({ feed: feedParam })}`} className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
                              New promo
                            </Link>
                          ) : row.promoId ? (
                            <Link href={`/intel/promos/${row.promoId}${qs({ feed: feedParam })}`} className="rounded-full bg-[#dbe7ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">
                              Promo ↗
                            </Link>
                          ) : null}
                          {row.reuse && row.copyId ? (
                            <Link href={`/intel/copies/${row.copyId}${qs({ feed: feedParam })}`} className="rounded-full bg-[#fff1c2] px-2 py-0.5 text-xs font-semibold text-[#6b4700]">
                              ↻ {row.reuse}
                            </Link>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-extrabold tabular-nums text-ink" title="Times this copy has been detected">
                        {row.copyId ? <Link href={`/intel/copies/${row.copyId}${qs({ feed: feedParam })}`}>{row.seen}×</Link> : `${row.seen}×`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">
              {result.total.toLocaleString("en-US")} email{result.total === 1 ? "" : "s"} · page {page} of {pages}
            </span>
            <span className="flex gap-3">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="text-accent underline">
                  ← Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={pageHref(page + 1)} className="text-accent underline">
                  Next →
                </Link>
              ) : null}
            </span>
          </div>
        </section>

        <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          {numbers ? (
            <div className="rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink">Last 7 days · {FEED_LABELS[feed]}</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat value={numbers.newPromos} label="new promos" />
                <Stat value={numbers.emails.toLocaleString("en-US")} label="emails" />
                <Stat value={numbers.resent.toLocaleString("en-US")} label="re-sent copies" />
                <Stat value={numbers.affiliateReuse} label="affiliate reuses" />
              </div>
              <Link href={`/intel/trends${qs({ feed: feedParam })}`} className="mt-3 inline-block text-sm text-accent underline">
                See trends →
              </Link>
            </div>
          ) : null}
          <div className="rounded-xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold text-ink">Alerts</h2>
            <ul className="mt-2 space-y-3 text-sm">
              {alertList.reusedToAffiliate.map((c) => (
                <li key={`a-${c.id}`}>
                  <span className="rounded-full bg-[#fff1c2] px-2 py-0.5 text-xs font-semibold text-[#6b4700]">{c.firstSeenKind.toLowerCase()} → affiliate</span>
                  <Link href={`/intel/copies/${c.id}${qs({ feed: feedParam })}`} className="pc-break mt-1 block text-ink hover:underline">
                    “{c.title}” first sent {c.firstSeenAt.toISOString().slice(0, 10)}, now on an affiliate file
                  </Link>
                </li>
              ))}
              {alertList.newSubjects.slice(0, 5).map((c) => (
                <li key={`s-${c.id}`}>
                  <span className="rounded-full bg-[#fff1c2] px-2 py-0.5 text-xs font-semibold text-[#6b4700]">same copy, new subject</span>
                  <Link href={`/intel/copies/${c.id}${qs({ feed: feedParam })}`} className="pc-break mt-1 block text-ink hover:underline">
                    “{c.title}”: {c.sendCount} sends, {c.subjectCount} subjects
                  </Link>
                </li>
              ))}
              {alertList.spikes.map((p) => (
                <li key={`p-${p.id}`}>
                  <span className="rounded-full bg-[#dbe7ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">frequency spike</span>
                  <Link href={`/intel/promos/${p.id}${qs({ feed: feedParam })}`} className="pc-break mt-1 block text-ink hover:underline">
                    {p.headline ?? "Promo"}: {p.sends} sends in 2 days
                  </Link>
                </li>
              ))}
              {alertList.silent.map((i) => (
                <li key={`i-${i.id}`}>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">went silent</span>
                  <span className="pc-break mt-1 block text-ink">
                    {i.list?.name ?? i.publication?.name ?? i.address}
                    {i.lastMessageAt ? ` · last mail ${i.lastMessageAt.toISOString().slice(0, 10)}` : ""}
                  </span>
                </li>
              ))}
              {!alertList.reusedToAffiliate.length && !alertList.newSubjects.length && !alertList.spikes.length && !alertList.silent.length ? <li className="text-muted">Nothing unusual this week.</li> : null}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
