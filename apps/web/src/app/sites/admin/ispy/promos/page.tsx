import type { Prisma } from "@pubcommand/db";
import { Flash } from "@/components/ui";
import { FEED_LABELS, FEEDS, isOneOf, PROMO_KIND_LABELS, type Feed, type IspyPromoKind } from "../../../../../../../../modules/ispy/index";
import { blockPromoAction, mergePromoAction } from "@/features/ispy/console-actions";
import { Back, btnDanger, btnSm, card, day, Pager, Pill, queryString, SortTh, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · Promos" };

const SORTS: Record<string, (dir: "asc" | "desc") => Prisma.IspyPromoOrderByWithRelationInput> = {
  first: (dir) => ({ firstSeenOn: dir }),
  last: (dir) => ({ lastSeenOn: dir }),
  headline: (dir) => ({ headline: dir }),
  advertiser: (dir) => ({ advertiser: { label: dir } }),
  kind: (dir) => ({ kind: dir }),
  days: (dir) => ({ daysDetected: dir }),
  sends: (dir) => ({ sendCount: dir }),
  affiliates: (dir) => ({ affiliateCount: dir }),
};

/** Every promo (one per landing page), with staff's merge and not-a-promo tools. */
export default async function PromosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const feed: Feed = isOneOf(FEEDS, query.feed) ? query.feed : "FINPUB";
  const q = (query.q ?? "").trim();
  const sort = query.sort && SORTS[query.sort] ? query.sort : "last";
  const dir = query.sort ? (query.dir === "asc" ? "asc" : "desc") : "desc";
  const page = Math.max(1, Number(query.page) || 1);
  const where: Prisma.IspyPromoWhereInput = {
    feed,
    mergedIntoId: null,
    ...(q ? { OR: [{ headline: { contains: q, mode: "insensitive" } }, { landingUrl: { contains: q, mode: "insensitive" } }, { advertiser: { label: { contains: q, mode: "insensitive" } } }, ...(/^[0-9a-f-]{36}$/i.test(q) ? [{ id: q }] : [])] } : {}),
  };
  const [total, promos] = await ispyDb((tx) =>
    Promise.all([
      tx.ispyPromo.count({ where }),
      tx.ispyPromo.findMany({
        where,
        orderBy: [SORTS[sort]!(dir), { id: "asc" }],
        skip: (page - 1) * 50,
        take: 50,
        select: { id: true, headline: true, landingUrl: true, kind: true, firstSeenOn: true, lastSeenOn: true, daysDetected: true, sendCount: true, affiliateCount: true, isInternal: true, advertiserLabel: true, advertiser: { select: { label: true } }, _count: { select: { aliases: true } } },
      }),
    ]),
  );
  const params: Record<string, string | undefined> = { ...query, feed };
  const back = `/ispy/promos?${queryString(params)}`;
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Promos</h2>
          <p className="max-w-3xl text-sm text-muted">One row per promo, matched by landing page (URL, declared canonical, headline, video and page text). Merge two that are the same; remove pages that aren&apos;t promos. Both stick for future mail.</p>
        </div>
        <nav aria-label="Feed" className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
          {FEEDS.map((f) => (
            <a key={f} href={`/ispy/promos?feed=${f}`} aria-current={f === feed ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${f === feed ? "bg-accent text-white" : "hover:bg-canvas"}`}>
              {FEED_LABELS[f]}
            </a>
          ))}
        </nav>
      </div>
      <form className="pc-form-row" action="/ispy/promos">
        <input type="hidden" name="feed" value={feed} />
        <label className="sr-only" htmlFor="promo-q">Search promos</label>
        <input id="promo-q" name="q" defaultValue={q} placeholder="Headline, URL, advertiser or promo id…" className="pc-control flex-1" />
        <button className={btnSm} type="submit">Search</button>
      </form>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/promos" params={params} sortKey="headline">Promo</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="advertiser">Advertiser</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="kind">Kind</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="first">First seen</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="last">Last seen</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="days" align="right">Days</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="sends" align="right">Sends</SortTh>
                <SortTh base="/ispy/promos" params={params} sortKey="affiliates" align="right">Affiliates</SortTh>
                <th scope="col" className={th}>Staff tools</th>
              </tr>
            </thead>
            <tbody>
              {promos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted">No promos{q ? " match" : " yet"}.</td>
                </tr>
              ) : null}
              {promos.map((p) => (
                <tr key={p.id} className="border-t border-line align-top">
                  <td className={`${td} min-w-[260px]`}>
                    <div className="font-semibold">{p.headline ?? "(no headline)"}</div>
                    <a href={p.landingUrl} target="_blank" rel="noopener noreferrer nofollow" className="pc-break text-xs text-muted underline">{p.landingUrl}</a>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
                      <code>{p.id}</code>
                      {p._count.aliases ? <span>· {p._count.aliases} URL/key aliases</span> : null}
                      {p.isInternal ? <Pill tone="teal">internal advertiser</Pill> : null}
                    </div>
                  </td>
                  <td className={td}>{p.advertiserLabel ?? p.advertiser.label}</td>
                  <td className={td}><Pill tone="blue">{PROMO_KIND_LABELS[p.kind as IspyPromoKind] ?? p.kind}</Pill></td>
                  <td className={`${td} whitespace-nowrap`}>{day(p.firstSeenOn)}</td>
                  <td className={`${td} whitespace-nowrap`}>{day(p.lastSeenOn)}</td>
                  <td className={`${td} text-right tabular-nums`}>{p.daysDetected}</td>
                  <td className={`${td} text-right tabular-nums`}>{p.sendCount}</td>
                  <td className={`${td} text-right tabular-nums`}>{p.affiliateCount}</td>
                  <td className={td}>
                    <div className="flex flex-col gap-2">
                      <form action={mergePromoAction} className="flex flex-wrap gap-1">
                        <Back to={back} />
                        <input type="hidden" name="id" value={p.id} />
                        <label className="sr-only" htmlFor={`into-${p.id}`}>Merge into promo id</label>
                        <input id={`into-${p.id}`} name="intoId" placeholder="Merge into promo id…" className="pc-control w-44" />
                        <button className={btnSm} type="submit">Merge</button>
                      </form>
                      <form action={blockPromoAction}>
                        <Back to={back} />
                        <input type="hidden" name="id" value={p.id} />
                        <button className={btnDanger} type="submit">Not a promo</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager total={total} page={page} params={params} base="/ispy/promos" noun="promo(s)" />
      </section>
    </div>
  );
}

