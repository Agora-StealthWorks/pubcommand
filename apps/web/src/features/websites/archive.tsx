import type { Prisma } from "@pubcommand/db";
import { tenantDb } from "@pubcommand/db";
import type { ReactNode } from "react";
import { liveWhere, livePosts, type LoadedSite } from "./public";
import type { SignedInMember } from "./members";
import { Img, Kicker, SiteShell, fmtDate } from "./site-view";

const PER_PAGE = 20;

/** A list of live posts (latest, a category, a tag, a publication's archive). */
export async function Archive({
  loaded,
  member,
  where,
  title,
  kicker,
  intro,
  page,
  path,
  active,
  aside,
  header,
}: {
  loaded: LoadedSite;
  member: SignedInMember | null;
  where: Prisma.WebPostWhereInput;
  title: string;
  kicker?: string;
  intro?: string;
  page: number;
  path: string;
  active?: string;
  aside?: ReactNode;
  header?: ReactNode;
}) {
  const [posts, total] = await Promise.all([
    livePosts(loaded, where, PER_PAGE, (page - 1) * PER_PAGE),
    tenantDb(loaded.organizationId).webPost.count({ where: liveWhere(loaded, { kind: "post", ...where }) }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <SiteShell loaded={loaded} member={member} active={active}>
      {header}
      <section className="sec">
        <div className="wrap two">
          <div className="list">
            {header ? null : (
              <div style={{ marginBottom: 18 }}>
                {kicker ? <span className="label">{kicker}</span> : null}
                <h1 className="page-title" style={{ marginTop: 6 }}>
                  {title}
                </h1>
                {intro ? <p style={{ color: "var(--muted)", maxWidth: 680 }}>{intro}</p> : null}
              </div>
            )}
            <div className="sec-h" style={{ marginBottom: 0 }}>
              <h2 style={{ fontSize: 20 }}>{header ? title : "Latest"}</h2>
              <span className="label">{total} articles</span>
            </div>
            {posts.map((post, index) => (
              <a key={post.id} className="row" href={`${loaded.base}/${post.slug}`}>
                <Img loaded={loaded} assetId={post.featuredAssetId} light={index % 2 === 1} />
                <div>
                  <Kicker loaded={loaded} post={post} />
                  <h4>{post.title}</h4>
                  <p>{post.excerpt}</p>
                  <div className="meta">
                    {post.authorName ? `${post.authorName} · ` : ""}
                    {fmtDate(post.publishedAt, loaded.timeZone)}
                  </div>
                </div>
              </a>
            ))}
            {posts.length === 0 ? <p className="empty">Nothing here yet.</p> : null}
            {pages > 1 ? (
              <div className="pager">
                {page > 1 ? <a href={`${path}?page=${page - 1}`}>← Newer</a> : <span />}
                <span>
                  Page {page} of {pages}
                </span>
                {page < pages ? <a href={`${path}?page=${page + 1}`}>Older →</a> : <span />}
              </div>
            ) : null}
          </div>
          <aside>{aside}</aside>
        </div>
      </section>
    </SiteShell>
  );
}

export function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
}
