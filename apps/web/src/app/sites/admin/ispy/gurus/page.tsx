import { Flash } from "@/components/ui";
import { FEED_LABELS, FEEDS, isOneOf, type Feed } from "../../../../../../../../modules/ispy/index";
import { linkGuruList, linkGuruPublication, saveGuru, unlinkGuruList, unlinkGuruPublication } from "@/features/ispy/console-actions";
import { Back, btnPrimary, btnSm, card, input, label, Pill, SortTh, sortRows, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · Gurus" };

const ROLES = ["lead", "co-editor", "contributor", "analyst", "guest"];

export default async function GurusPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const feed: Feed = isOneOf(FEEDS, query.feed) ? query.feed : "FINPUB";
  const q = (query.q ?? "").trim();
  const data = await ispyDb(async (tx) => {
    const [gurus, publishers, publications, lists] = await Promise.all([
      tx.ispyGuru.findMany({
        where: { feed, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { aliases: { has: q } }] } : {}), ...(query.publication ? { publications: { some: { publicationId: query.publication } } } : {}) },
        orderBy: { name: "asc" },
        take: 500,
        include: { publications: { include: { publication: { select: { id: true, name: true } } } }, lists: { include: { list: { select: { id: true, name: true } } } } },
      }),
      tx.ispyPublisher.findMany({ where: { deletedAt: null, feed, type: { not: "AFFILIATE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.ispyPublication.findMany({ where: { deletedAt: null, publisher: { feed } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.ispyList.findMany({ where: { deletedAt: null, publisher: { feed, type: { not: "AFFILIATE" } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    const counts = gurus.length
      ? await tx.$queryRaw<{ name: string; n: bigint }[]>`SELECT g AS name, COUNT(*)::bigint AS n FROM ispy_emails, unnest(gurus) AS g WHERE feed = ${feed} AND received_at >= now() - interval '30 days' GROUP BY g`
      : [];
    return { gurus, publishers, publications, lists, counts: new Map(counts.map((c) => [c.name, Number(c.n)])) };
  });
  const back = `/ispy/gurus?feed=${feed}${q ? `&q=${encodeURIComponent(q)}` : ""}${query.publication ? `&publication=${query.publication}` : ""}`;
  const publisherName = new Map(data.publishers.map((p) => [p.id, p.name]));
  const mentions = (g: { name: string; aliases: string[] }) => [g.name, ...g.aliases].reduce((n, x) => n + (data.counts.get(x) ?? 0), 0);
  const rows = sortRows(data.gurus, query, { name: (g) => g.name, publisher: (g) => (g.publisherId ? publisherName.get(g.publisherId) ?? "" : ""), publications: (g) => g.publications.length, lists: (g) => g.lists.length, mentions: (g) => mentions(g) }, "name");
  const params = { ...query, feed };
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Gurus</h2>
          <p className="max-w-3xl text-sm text-muted">Editors and voices, the publications they write for (with their role) and the lists they appear on. A byline on an affiliate send never makes a guru a member of the affiliate&apos;s list.</p>
        </div>
        <nav aria-label="Feed" className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
          {FEEDS.map((f) => (
            <a key={f} href={`/ispy/gurus?feed=${f}`} aria-current={f === feed ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${f === feed ? "bg-accent text-white" : "hover:bg-canvas"}`}>
              {FEED_LABELS[f]}
            </a>
          ))}
        </nav>
      </div>
      <form className="pc-form-row" action="/ispy/gurus">
        <input type="hidden" name="feed" value={feed} />
        <label className="sr-only" htmlFor="guru-q">Search gurus</label>
        <input id="guru-q" name="q" defaultValue={q} placeholder="Guru name…" className="pc-control flex-1" />
        <select name="publication" defaultValue={query.publication ?? ""} aria-label="Publication" className="pc-control">
          <option value="">(any publication)</option>
          {data.publications.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className={btnSm} type="submit">Filter</button>
      </form>

      <details className={`${card} p-4`}>
        <summary className="cursor-pointer text-sm font-semibold">+ Add a guru</summary>
        <GuruForm feed={feed} publishers={data.publishers} back={back} />
      </details>

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/gurus" params={params} sortKey="name">Guru</SortTh>
                <SortTh base="/ispy/gurus" params={params} sortKey="publisher">Publisher</SortTh>
                <SortTh base="/ispy/gurus" params={params} sortKey="publications">Publications</SortTh>
                <SortTh base="/ispy/gurus" params={params} sortKey="lists">Lists</SortTh>
                <SortTh base="/ispy/gurus" params={params} sortKey="mentions" align="right">Emails · 30 days</SortTh>
                <th scope="col" className={th}>Manage</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">No gurus{q ? " match" : " yet"}.</td>
                </tr>
              ) : null}
              {rows.map((g) => (
                <tr key={g.id} className="border-t border-line align-top">
                  <td className={`${td} font-semibold`}>
                    {g.name}
                    {g.isSecondaryVoice ? <span className="ml-1"><Pill>secondary voice</Pill></span> : null}
                    {g.isIgnored ? <span className="ml-1"><Pill>ignored</Pill></span> : null}
                    {g.aliases.length ? <div className="text-xs font-normal text-muted">also: {g.aliases.join(", ")}</div> : null}
                  </td>
                  <td className={td}>{g.publisherId ? publisherName.get(g.publisherId) ?? "—" : "—"}</td>
                  <td className={td}>
                    {g.publications.map((p) => (
                      <form key={p.publicationId} action={unlinkGuruPublication} className="flex flex-wrap items-center gap-1">
                        <Back to={back} />
                        <input type="hidden" name="guruId" value={g.id} />
                        <input type="hidden" name="publicationId" value={p.publicationId} />
                        <span>{p.publication.name} <span className="text-muted">({p.role})</span></span>
                        <button type="submit" className="text-xs text-[#912018] underline" aria-label={`Unlink ${p.publication.name}`}>remove</button>
                      </form>
                    ))}
                  </td>
                  <td className={td}>
                    {g.lists.map((l) => (
                      <form key={l.listId} action={unlinkGuruList} className="flex flex-wrap items-center gap-1">
                        <Back to={back} />
                        <input type="hidden" name="guruId" value={g.id} />
                        <input type="hidden" name="listId" value={l.listId} />
                        <span className={l.isIgnored ? "line-through text-muted" : ""}>{l.list.name}{l.isPrimary ? " ★" : ""}</span>
                        <button type="submit" className="text-xs text-[#912018] underline" aria-label={`Remove from ${l.list.name}`}>remove</button>
                      </form>
                    ))}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{mentions(g)}</td>
                  <td className={td}>
                    <details>
                      <summary className="cursor-pointer text-sm underline">Edit &amp; link</summary>
                      <div className="mt-2 flex min-w-[420px] flex-col gap-3">
                        <GuruForm feed={feed} publishers={data.publishers} back={back} guru={g} />
                        <form action={linkGuruPublication} className="flex flex-wrap items-end gap-2">
                          <Back to={back} />
                          <input type="hidden" name="guruId" value={g.id} />
                          <select name="publicationId" aria-label="Publication" required defaultValue="" className="pc-control">
                            <option value="" disabled>Publication…</option>
                            {data.publications.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <select name="role" aria-label="Role" defaultValue="lead" className="pc-control">
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <button className={btnSm} type="submit">Link publication</button>
                        </form>
                        <form action={linkGuruList} className="flex flex-wrap items-end gap-2">
                          <Back to={back} />
                          <input type="hidden" name="guruId" value={g.id} />
                          <select name="listId" aria-label="List" required defaultValue="" className="pc-control">
                            <option value="" disabled>List…</option>
                            {data.lists.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                            <input type="checkbox" name="isPrimary" /> Primary
                          </label>
                          <button className={btnSm} type="submit">Add to list</button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function GuruForm({ feed, publishers, back, guru }: { feed: Feed; publishers: { id: string; name: string }[]; back: string; guru?: { id: string; name: string; aliases: string[]; publisherId: string | null; notes: string | null; isIgnored: boolean; isSecondaryVoice: boolean; feed: string } }) {
  return (
    <form action={saveGuru} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
      <Back to={back} />
      {guru ? <input type="hidden" name="id" value={guru.id} /> : null}
      <input type="hidden" name="feed" value={guru?.feed ?? feed} />
      <label className={label}>
        Name
        <input name="name" required defaultValue={guru?.name} className={input} />
      </label>
      <label className={label}>
        Aliases
        <input name="aliases" defaultValue={guru?.aliases.join(", ")} className={input} />
      </label>
      <label className={label}>
        Main publisher
        <select name="publisherId" defaultValue={guru?.publisherId ?? ""} className={input}>
          <option value="">(none)</option>
          {publishers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Notes
        <input name="notes" defaultValue={guru?.notes ?? ""} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-4 md:col-span-2">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="isSecondaryVoice" defaultChecked={guru?.isSecondaryVoice} /> Secondary voice
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="isIgnored" defaultChecked={guru?.isIgnored} /> Ignore
        </label>
        <button type="submit" className={guru ? btnSm : btnPrimary}>{guru ? "Save guru" : "Add guru"}</button>
        {guru ? null : <span className="text-xs text-muted">Link publications and lists after saving.</span>}
      </div>
    </form>
  );
}

