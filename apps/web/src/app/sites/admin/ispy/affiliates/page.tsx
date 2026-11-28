import { Flash } from "@/components/ui";
import { FEED_LABELS, FEEDS, isOneOf, type Feed } from "../../../../../../../../modules/ispy/index";
import { setInboxAffiliate } from "@/features/ispy/console-actions";
import { loadOrgOptions } from "@/features/ispy/console-data";
import { CreateInboxButton, ListForm, PublisherForm } from "@/features/ispy/console-forms";
import { ago, Back, btnSm, card, Pill, SortTh, sortRows, statusTone, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · Affiliate Lists" };

/** Marketing files paid to mail other publishers' offers (MarketBeat and the others). */
export default async function AffiliatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const feed: Feed = isOneOf(FEEDS, query.feed) ? query.feed : "FINPUB";
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [data, orgs] = await Promise.all([
    ispyDb(async (tx) => {
      const affiliates = await tx.ispyPublisher.findMany({ where: { deletedAt: null, type: "AFFILIATE", feed }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, feed: true, parentId: true, domains: true, fromAddresses: true, website: true, notes: true, excludeBrands: true, linkedOrganizationId: true, linkedBrandId: true, hideFromOtherOrgs: true } });
      const ids = affiliates.map((a) => a.id);
      const [lists, inboxes, weekly, legacy, top] = await Promise.all([
        tx.ispyList.findMany({ where: { publisherId: { in: ids }, deletedAt: null }, select: { id: true, name: true, publisherId: true, category: true, synonyms: true, isIgnored: true, editorialPubCode: true, dedicatedPubCode: true, publicationId: true } }),
        tx.ispyInbox.findMany({ where: { OR: [{ publisherId: { in: ids } }, { list: { publisherId: { in: ids } } }] }, select: { id: true, address: true, provider: true, status: true, affiliateSeed: true, publisherId: true, listId: true, lastMessageAt: true } }),
        tx.ispyEmail.groupBy({ by: ["publisherId"], where: { publisherId: { in: ids }, receivedAt: { gte: since } }, _count: { _all: true } }),
        tx.ispyInbox.findMany({ where: { provider: "GMAIL_LEGACY", affiliateSeed: false, status: { not: "RETIRED" } }, select: { id: true, address: true } }),
        tx.ispyPromoSighting.findMany({ where: { sendKind: "AFFILIATE", day: { gte: since }, publisherId: { in: ids } }, select: { publisherId: true, promo: { select: { advertiserLabel: true, advertiser: { select: { label: true } } } } }, take: 5000 }),
      ]);
      return { affiliates, lists, inboxes, weekly, legacy, top };
    }),
    loadOrgOptions(),
  ]);
  const back = `/ispy/affiliates?feed=${feed}`;
  const weekly = new Map(data.weekly.map((w) => [w.publisherId!, w._count._all]));
  const topBy = (id: string) => {
    const counts = new Map<string, number>();
    for (const s of data.top.filter((x) => x.publisherId === id)) {
      const name = s.promo.advertiserLabel ?? s.promo.advertiser.label;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n} ${c}`).join(" · ");
  };
  const rows = sortRows(data.affiliates, query, { name: (a) => a.name, sends: (a) => weekly.get(a.id) ?? 0 }, "sends");
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Affiliate Lists</h2>
          <p className="max-w-3xl text-sm text-muted">Marketing files paid to mail other publishers&apos; offers. Not publications: every email is credited to the advertiser on the landing page.</p>
        </div>
        <nav aria-label="Feed" className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
          {FEEDS.map((f) => (
            <a key={f} href={`/ispy/affiliates?feed=${f}`} aria-current={f === feed ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${f === feed ? "bg-accent text-white" : "hover:bg-canvas"}`}>
              {FEED_LABELS[f]}
            </a>
          ))}
        </nav>
      </div>

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/affiliates" params={{ ...query, feed }} sortKey="name">Affiliate</SortTh>
                <th scope="col" className={th}>Marketing file</th>
                <th scope="col" className={th}>Seed inboxes</th>
                <SortTh base="/ispy/affiliates" params={{ ...query, feed }} sortKey="sends" align="right">Sends / 7 days</SortTh>
                <th scope="col" className={th}>Top advertisers this week</th>
                <th scope="col" className={th}>Ignored house ads</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">No affiliates in {FEED_LABELS[feed]} yet. Add MarketBeat and the others below.</td>
                </tr>
              ) : null}
              {rows.map((a) => {
                const lists = data.lists.filter((l) => l.publisherId === a.id);
                const seeds = data.inboxes.filter((i) => i.publisherId === a.id || lists.some((l) => l.id === i.listId));
                const file = lists.find((l) => l.category === "MARKETING_FILE") ?? lists[0];
                return (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className={`${td} font-bold`}>
                      {a.name}
                      <details className="mt-1 font-normal">
                        <summary className="cursor-pointer text-sm underline">Edit</summary>
                        <div className="mt-2 min-w-[560px]">
                          <PublisherForm publisher={a} groups={[]} orgs={orgs} back={back} defaultFeed={feed} defaultType="AFFILIATE" />
                        </div>
                      </details>
                    </td>
                    <td className={td}>
                      {lists.length ? lists.map((l) => <div key={l.id}>{l.name}</div>) : <span className="text-muted">none</span>}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm underline">+ Add list</summary>
                        <div className="mt-2 min-w-[520px]">
                          <ListForm publisherId={a.id} publicationId={null} back={back} defaultCategory="MARKETING_FILE" />
                        </div>
                      </details>
                    </td>
                    <td className={td}>
                      {seeds.map((i) => (
                        <div key={i.id} className="flex flex-wrap items-center gap-1">
                          <code className="pc-break text-xs">{i.address}</code>
                          <Pill tone={i.provider === "GMAIL_LEGACY" ? "muted" : "ok"}>{i.provider === "GMAIL_LEGACY" ? "legacy Gmail" : "MachineMail"}</Pill>
                          <Pill tone={statusTone(i.status)}>{i.status.toLowerCase()}</Pill>
                          <span className="text-xs text-muted">{ago(i.lastMessageAt)}</span>
                        </div>
                      ))}
                      {file ? <CreateInboxButton level="LIST" publisherId={a.id} listId={file.id} name={a.name} back={back} labelText="+ Create seed inbox" affiliateSeed /> : null}
                      {file && data.legacy.length ? (
                        <form action={setInboxAffiliate} className="mt-2 flex flex-wrap items-center gap-2">
                          <Back to={back} />
                          <input type="hidden" name="publisherId" value={a.id} />
                          <input type="hidden" name="listId" value={file.id} />
                          <input type="hidden" name="affiliateSeed" value="on" />
                          <select name="id" aria-label="Legacy inbox" className="pc-control" required defaultValue="">
                            <option value="" disabled>Use a legacy Gmail inbox…</option>
                            {data.legacy.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.address}
                              </option>
                            ))}
                          </select>
                          <button className={btnSm} type="submit">Make seed</button>
                        </form>
                      ) : null}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{weekly.get(a.id) ?? 0}</td>
                    <td className={td}>{topBy(a.id) || <span className="text-muted">—</span>}</td>
                    <td className={td}>{a.excludeBrands.length ? a.excludeBrands.map((b) => <code key={b} className="mr-1 text-xs">{b}</code>) : <span className="text-muted">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details className={`${card} p-4`}>
        <summary className="cursor-pointer text-sm font-semibold">+ Add an affiliate</summary>
        <div className="mt-3">
          <PublisherForm groups={[]} orgs={orgs} back={back} defaultFeed={feed} defaultType="AFFILIATE" />
          <p className="mt-2 text-xs text-muted">Then add its marketing-file list and a seed inbox above.</p>
        </div>
      </details>

      <section className={`${card} p-4 text-sm`}>
        <h3 className="mb-2 font-semibold">Rules every affiliate follows</h3>
        <ul className="list-disc pl-5">
          <li>Every email to a seed inbox is credited to the affiliate and its marketing-file list.</li>
          <li>A guru in the byline is recorded as who the promo is for, never as a member of the affiliate&apos;s list.</li>
          <li>The advertiser comes from the landing page, so a MarketBeat send of a Paradigm promo counts toward Paradigm&apos;s promo.</li>
          <li>The affiliate&apos;s own house ads are never treated as the promo.</li>
          <li>Copy first sent on a publisher&apos;s own list that shows up here raises an internal → affiliate reuse alert.</li>
        </ul>
      </section>
    </div>
  );
}
