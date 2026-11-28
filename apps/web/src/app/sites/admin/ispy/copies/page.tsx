import type { Prisma } from "@pubcommand/db";
import { Flash } from "@/components/ui";
import { EMAIL_TYPE_LABELS, EMAIL_TYPES, FEED_LABELS, FEEDS, isOneOf, type Feed, type IspyEmailType } from "../../../../../../../../modules/ispy/index";
import { mergeCopyAction, setCopyType } from "@/features/ispy/console-actions";
import { Back, btnSm, card, day, Pager, Pill, queryString, SortTh, td, th, typeTone } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · Copies" };

const SORTS: Record<string, (dir: "asc" | "desc") => Prisma.IspyCopyOrderByWithRelationInput> = {
  last: (dir) => ({ lastSeenAt: dir }),
  first: (dir) => ({ firstSeenAt: dir }),
  title: (dir) => ({ title: dir }),
  type: (dir) => ({ emailType: dir }),
  seen: (dir) => ({ sendCount: dir }),
  subjects: (dir) => ({ subjectCount: dir }),
  lists: (dir) => ({ listCount: dir }),
  affiliates: (dir) => ({ affiliateCount: dir }),
};

/** Copies (one email body, however many sends): fix a type for every send, or merge two that are the same. */
export default async function CopiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const feed: Feed = isOneOf(FEEDS, query.feed) ? query.feed : "FINPUB";
  const q = (query.q ?? "").trim();
  const sort = query.sort && SORTS[query.sort] ? query.sort : "last";
  const dir = query.sort ? (query.dir === "asc" ? "asc" : "desc") : "desc";
  const page = Math.max(1, Number(query.page) || 1);
  const type = isOneOf(EMAIL_TYPES, query.type) ? query.type : null;
  const where: Prisma.IspyCopyWhereInput = {
    feed,
    mergedIntoId: null,
    ...(type ? { emailType: type } : {}),
    ...(query.resent ? { sendCount: { gt: 1 } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, ...(/^[0-9a-f-]{36}$/i.test(q) ? [{ id: q }] : [])] } : {}),
  };
  const [total, copies] = await ispyDb((tx) =>
    Promise.all([
      tx.ispyCopy.count({ where }),
      tx.ispyCopy.findMany({ where, orderBy: [SORTS[sort]!(dir), { id: "asc" }], skip: (page - 1) * 50, take: 50, select: { id: true, title: true, emailType: true, typeOverridden: true, firstSeenAt: true, lastSeenAt: true, firstSeenKind: true, sendCount: true, subjectCount: true, listCount: true, affiliateCount: true, extractionStatus: true } }),
    ]),
  );
  const params: Record<string, string | undefined> = { ...query, feed };
  const back = `/ispy/copies?${queryString(params)}`;
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Copies</h2>
          <p className="max-w-3xl text-sm text-muted">One row per email body, matched across subjects, greetings and tracking links. A type you set here sticks for every send, now and later.</p>
        </div>
        <nav aria-label="Feed" className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
          {FEEDS.map((f) => (
            <a key={f} href={`/ispy/copies?feed=${f}`} aria-current={f === feed ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${f === feed ? "bg-accent text-white" : "hover:bg-canvas"}`}>
              {FEED_LABELS[f]}
            </a>
          ))}
        </nav>
      </div>
      <form className="pc-form-row" action="/ispy/copies">
        <input type="hidden" name="feed" value={feed} />
        <label className="sr-only" htmlFor="copy-q">Search copies</label>
        <input id="copy-q" name="q" defaultValue={q} placeholder="Title or copy id…" className="pc-control flex-1" />
        <select name="type" defaultValue={type ?? ""} aria-label="Type" className="pc-control">
          <option value="">All types</option>
          {EMAIL_TYPES.map((t) => (
            <option key={t} value={t}>
              {EMAIL_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="resent" value="1" defaultChecked={!!query.resent} /> Re-sent only
        </label>
        <button className={btnSm} type="submit">Filter</button>
      </form>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/copies" params={params} sortKey="title">Copy</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="type">Type</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="first">First sent</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="last">Last sent</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="seen" align="right">Seen</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="subjects" align="right">Subjects</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="lists" align="right">Lists</SortTh>
                <SortTh base="/ispy/copies" params={params} sortKey="affiliates" align="right">Affiliates</SortTh>
                <th scope="col" className={th}>Staff tools</th>
              </tr>
            </thead>
            <tbody>
              {copies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted">No copies{q || type ? " match" : " yet"}.</td>
                </tr>
              ) : null}
              {copies.map((c) => (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className={`${td} min-w-[240px]`}>
                    <div className="font-semibold">{c.title}</div>
                    <div className="text-xs text-muted">
                      <code>{c.id}</code> · first {c.firstSeenKind.toLowerCase()} · extraction {c.extractionStatus.toLowerCase()}
                    </div>
                  </td>
                  <td className={td}>
                    <Pill tone={typeTone(c.emailType)}>{EMAIL_TYPE_LABELS[c.emailType as IspyEmailType] ?? c.emailType}</Pill>
                    {c.typeOverridden ? <div className="text-xs text-muted">set by staff</div> : null}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{day(c.firstSeenAt)}</td>
                  <td className={`${td} whitespace-nowrap`}>{day(c.lastSeenAt)}</td>
                  <td className={`${td} text-right font-bold tabular-nums`}>{c.sendCount}×</td>
                  <td className={`${td} text-right tabular-nums`}>{c.subjectCount}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.listCount}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.affiliateCount}</td>
                  <td className={td}>
                    <div className="flex flex-col gap-2">
                      <form action={setCopyType} className="flex flex-wrap gap-1">
                        <Back to={back} />
                        <input type="hidden" name="id" value={c.id} />
                        <select name="emailType" aria-label="Type" defaultValue={c.typeOverridden ? c.emailType : "AUTO"} className="pc-control">
                          <option value="AUTO">Automatic</option>
                          {EMAIL_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {EMAIL_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        <button className={btnSm} type="submit">Set type</button>
                      </form>
                      <form action={mergeCopyAction} className="flex flex-wrap gap-1">
                        <Back to={back} />
                        <input type="hidden" name="id" value={c.id} />
                        <label className="sr-only" htmlFor={`cinto-${c.id}`}>Merge into copy id</label>
                        <input id={`cinto-${c.id}`} name="intoId" placeholder="Merge into copy id…" className="pc-control w-44" />
                        <button className={btnSm} type="submit">Merge</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager total={total} page={page} params={params} base="/ispy/copies" noun="copies" />
      </section>
    </div>
  );
}
