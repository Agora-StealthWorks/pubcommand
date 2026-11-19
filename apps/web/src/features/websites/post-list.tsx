import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { contentTypeLabel, CONTENT_TYPES, ACCESS_LEVELS } from "../../../../../modules/websites/content";
import { TableScroll } from "@/components/table-scroll";
import { trashPost } from "./actions";
import { AccessBadge, PostStatusBadge, PubChip, formatDate } from "./admin-ui";
import { orgTimezone, postWhere, sitePublications, siteTerms, statusCounts, type SiteRow } from "./data";

export type ListQuery = { status?: string; pub?: string; access?: string; type?: string; term?: string; q?: string; page?: string };

const PAGE_SIZE = 25;

/** WordPress-style list of posts or pages with status tabs and filters. */
export async function PostList({ organizationId, brandId, site, kind, query, canWrite }: { organizationId: string; brandId: string; site: SiteRow; kind: "post" | "page"; query: ListQuery; canWrite: boolean }) {
  const now = new Date();
  const base = kind === "page" ? "/websites/pages" : "/websites/posts";
  const trash = query.status === "trash";
  const filters = {
    kind,
    status: trash ? undefined : query.status,
    publicationId: query.pub,
    access: query.access,
    contentType: query.type,
    termId: query.term,
    q: query.q?.trim().slice(0, 100),
    trash,
  };
  const page = Math.max(1, Number(query.page) || 1);
  const db = tenantDb(organizationId);
  const where = postWhere(site.id, filters, now);
  const [posts, total, counts, pubs, terms, timeZone] = await Promise.all([
    db.webPost.findMany({
      where,
      orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, title: true, slug: true, status: true, publishedAt: true, deletedAt: true, publicationId: true, contentType: true, access: true, authorName: true, updatedAt: true, featuredAssetId: true, terms: { select: { term: { select: { name: true, kind: true } } } } },
    }),
    db.webPost.count({ where }),
    statusCounts(organizationId, site.id, kind, now),
    sitePublications(organizationId, brandId),
    siteTerms(organizationId, site.id),
    orgTimezone(organizationId),
  ]);
  const pubById = new Map(pubs.all.map((pub) => [pub.id, pub]));
  const link = (patch: Partial<ListQuery>) => {
    const params = new URLSearchParams();
    const merged = { ...query, page: undefined, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, String(value));
    const text = params.toString();
    return text ? `${base}?${text}` : base;
  };
  const tabs = [
    ["", "All", counts.all],
    ["published", "Published", counts.published],
    ["scheduled", "Scheduled", counts.scheduled],
    ["draft", "Drafts", counts.draft],
    ["pending", "Pending review", counts.pending],
    ["trash", "Trash", counts.trash],
  ] as const;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div>
      <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Status">
        {tabs.map(([key, label, count]) => (
          <Link key={key} href={link({ status: key || undefined })} className={`${(query.status ?? "") === key ? "border-b-2 border-accent font-semibold text-ink" : "text-muted hover:text-ink"} pb-0.5`}>
            {label} <span className="text-muted">({count})</span>
          </Link>
        ))}
      </nav>
      <div className="rounded-xl border border-line bg-white">
        <form className="flex flex-wrap items-end gap-2 border-b border-line p-3" action={base}>
          {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
          {kind === "post" ? (
            <>
              <select name="pub" defaultValue={query.pub ?? ""} className="pc-control" aria-label="Publication">
                <option value="">All publications</option>
                <option value="none">Site-wide (no publication)</option>
                {pubs.all.map((pub) => (
                  <option key={pub.id} value={pub.id}>
                    {pub.name}
                  </option>
                ))}
              </select>
              <select name="type" defaultValue={query.type ?? ""} className="pc-control" aria-label="Content type">
                <option value="">All content types</option>
                {CONTENT_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
              <select name="access" defaultValue={query.access ?? ""} className="pc-control" aria-label="Access">
                <option value="">All access levels</option>
                {ACCESS_LEVELS.map((level) => (
                  <option key={level.key} value={level.key}>
                    {level.label}
                  </option>
                ))}
              </select>
              <select name="term" defaultValue={query.term ?? ""} className="pc-control" aria-label="Category or tag">
                <option value="">All categories &amp; tags</option>
                {[...terms.categories, ...terms.tags].map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.kind === "tag" ? "#" : ""}
                    {term.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <input name="q" defaultValue={query.q ?? ""} placeholder={`Search ${kind === "page" ? "pages" : "posts"}…`} className="pc-control min-w-0 flex-1 sm:max-w-[260px]" />
          <button className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">Filter</button>
        </form>
        <TableScroll>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-canvas text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="w-[72px] px-3 py-2.5" />
                <th className="px-3 py-2.5">Title</th>
                {kind === "post" ? <th className="px-3 py-2.5">Publication</th> : null}
                {kind === "post" ? <th className="px-3 py-2.5">Type</th> : null}
                <th className="px-3 py-2.5">Access</th>
                <th className="px-3 py-2.5">Author</th>
                {kind === "post" ? <th className="px-3 py-2.5">Categories / tags</th> : null}
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-3">
                    {post.featuredAssetId ? (
                      <img src={`/w/${site.slug}/media/${post.featuredAssetId}`} alt="" loading="lazy" className="h-10 w-16 rounded object-cover" />
                    ) : (
                      <span className="block h-10 w-16 rounded bg-canvas" />
                    )}
                  </td>
                  <td className="max-w-[340px] px-3 py-3">
                    <Link href={`/websites/posts/${post.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-accent">
                      {post.title || "(no title)"}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-accent">
                      <Link href={`/websites/posts/${post.id}`}>Edit</Link>
                      <a href={`/w/${site.slug}/${post.slug}?preview=1`} target="_blank" rel="noreferrer">
                        {post.status === "published" ? "View" : "Preview"}
                      </a>
                      {canWrite ? (
                        <form action={trashPost} className="inline">
                          <input type="hidden" name="postId" value={post.id} />
                          <input type="hidden" name="back" value={link({})} />
                          {post.deletedAt ? (
                            <>
                              <button name="restore" value="1" className="text-accent">
                                Restore
                              </button>
                              <span className="text-muted"> · </span>
                              <button name="forever" value="1" className="text-[#b42318]">
                                Delete for good
                              </button>
                            </>
                          ) : (
                            <button className="text-[#b42318]">Trash</button>
                          )}
                        </form>
                      ) : null}
                    </div>
                  </td>
                  {kind === "post" ? (
                    <td className="px-3 py-3">
                      <PubChip siteSlug={site.slug} pub={post.publicationId ? pubById.get(post.publicationId) : null} />
                    </td>
                  ) : null}
                  {kind === "post" ? <td className="px-3 py-3">{contentTypeLabel(post.contentType)}</td> : null}
                  <td className="px-3 py-3">
                    <AccessBadge access={post.access} />
                  </td>
                  <td className="px-3 py-3">{post.authorName || <span className="text-muted">—</span>}</td>
                  {kind === "post" ? (
                    <td className="max-w-[200px] px-3 py-3 text-xs text-muted">
                      {post.terms
                        .map(({ term }) => (term.kind === "tag" ? `#${term.name}` : term.name))
                        .join(", ") || "—"}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-3">
                    <PostStatusBadge post={post} now={now} />
                    <div className="mt-1 text-xs text-muted">{formatDate(post.publishedAt ?? post.updatedAt, timeZone, true)}</div>
                  </td>
                </tr>
              ))}
              {posts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    Nothing here yet.{" "}
                    {canWrite ? (
                      <Link className="font-semibold text-accent" href={`${base}/new`}>
                        Write the first {kind}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
          <span>
            {total} item{total === 1 ? "" : "s"}
          </span>
          {pages > 1 ? (
            <span className="flex gap-3">
              {page > 1 ? <Link href={link({ page: String(page - 1) })}>‹ Newer</Link> : null}
              <span>
                Page {page} of {pages}
              </span>
              {page < pages ? <Link href={link({ page: String(page + 1) })}>Older ›</Link> : null}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
