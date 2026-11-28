import Link from "next/link";
import { Denied } from "@/components/ui";
import { ispyOrgScope, publisherDirectory, qs } from "@/features/ispy/org-data";
import { FeedLocked, FeedSwitcher } from "@/features/ispy/org-ui";
import { FEED_LABELS, LIST_CATEGORY_LABELS, PUBLISHER_TYPE_LABELS, type ListCategory, type PublisherType } from "../../../../../../../../../modules/ispy/index";

export default async function IspyPublishersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, feed, locked, feeds, scope } = found.value;
  const feedParam = feeds.length > 1 || feed !== feeds[0] ? feed : undefined;
  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">Who ISpy follows in {FEED_LABELS[feed]}: publishers, their publications, lists and gurus. PubCommand staff keep this registry.</p>
      <FeedSwitcher base="/intel/publishers" feed={feed} />
    </div>
  );
  if (locked) {
    return (
      <div className="min-w-0">
        {header}
        <FeedLocked feed={feed} base="/intel/publishers" />
      </div>
    );
  }
  const publishers = await publisherDirectory(viewer, search.q);
  const feedHref = (params: Record<string, string>) => `/intel${qs({ feed: feedParam, ...params })}`;
  return (
    <div className="min-w-0">
      {header}
      <form action="/intel/publishers" className="mb-4 flex flex-wrap gap-2">
        {feedParam ? <input type="hidden" name="feed" value={feedParam} /> : null}
        <label htmlFor="pub-q" className="sr-only">
          Search publishers
        </label>
        <input id="pub-q" name="q" defaultValue={search.q ?? ""} placeholder="Search publishers" className="pc-control min-w-0 flex-1" />
        <button type="submit" className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
          Search
        </button>
      </form>
      {publishers.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-6 text-sm text-muted">No publishers yet.</p>
      ) : (
        <ul className="space-y-3">
          {publishers.map((p) => (
            <li key={p.id} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={feedHref({ publisher: p.id })} className="text-base font-semibold text-ink hover:underline">
                  {p.name}
                </Link>
                {p.parent ? <span className="text-xs text-muted">part of {p.parent.name}</span> : null}
                <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">{PUBLISHER_TYPE_LABELS[p.type as PublisherType] ?? p.type}</span>
                {p.linkedOrganizationId === scope.organizationId ? <span className="rounded-full bg-[#d3f0eb] px-2 py-0.5 text-xs font-semibold text-[#0b5248]">yours · teaches your Brain</span> : null}
              </div>
              {p.publications.length ? (
                <div className="mt-3 space-y-2">
                  {p.publications.map((pub) => {
                    const lists = p.lists.filter((l) => l.publicationId === pub.id);
                    return (
                      <div key={pub.id} className="rounded-lg border border-line p-3">
                        <Link href={feedHref({ publisher: p.id, publication: pub.id })} className="font-semibold text-ink hover:underline">
                          {pub.name}
                        </Link>
                        {lists.length ? (
                          <p className="mt-1 flex flex-wrap gap-1">
                            {lists.map((l) => (
                              <Link key={l.id} href={feedHref({ list: l.id })} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink hover:underline">
                                {l.name} · {LIST_CATEGORY_LABELS[l.category as ListCategory] ?? l.category}
                              </Link>
                            ))}
                          </p>
                        ) : null}
                        {pub.gurus.length ? (
                          <p className="mt-1 text-xs text-muted">
                            Gurus:{" "}
                            {pub.gurus.map((g, i) => (
                              <span key={g.guru.id}>
                                {i ? ", " : ""}
                                <Link href={feedHref({ guru: g.guru.id })} className="underline">
                                  {g.guru.name}
                                </Link>{" "}
                                ({g.role})
                              </span>
                            ))}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {p.lists.filter((l) => !l.publicationId).length ? (
                <p className="mt-2 flex flex-wrap gap-1">
                  {p.lists
                    .filter((l) => !l.publicationId)
                    .map((l) => (
                      <Link key={l.id} href={feedHref({ list: l.id, tab: p.type === "AFFILIATE" ? "aff" : "ext" })} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink hover:underline">
                        {l.name} · {LIST_CATEGORY_LABELS[l.category as ListCategory] ?? l.category}
                      </Link>
                    ))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
