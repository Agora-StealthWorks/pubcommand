import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { loadSite, loadViewer, livePosts, pubFor, CARD_SELECT, liveWhere } from "@/features/websites/public";
import { EditorPhoto, FormNote, Img, Kicker, PubBadge, SignupForm, SiteShell, ago, editorOf, fmtDate } from "@/features/websites/site-view";
import { readingMinutes } from "../../../../../../../../../modules/websites/content";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) return { title: { absolute: "Not found" } };
  return {
    title: { absolute: loaded.site.tagline ? `${loaded.site.name} | ${loaded.site.tagline}` : loaded.site.name },
    description: loaded.site.tagline || undefined,
    icons: loaded.site.iconAssetId ? { icon: `${loaded.base}/media/${loaded.site.iconAssetId}` } : undefined,
    robots: loaded.site.status !== "live" ? { index: false, follow: false } : undefined,
  };
}

/** Website homepage: featured story, latest list, sign-up bar, editors' picks, premium research, editors. */
export default async function WebsiteHome({ params, searchParams }: { params: Params; searchParams: Promise<{ signup?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { base, site, timeZone, now } = loaded;
  const db = tenantDb(loaded.organizationId);
  const publicOnly = { access: { in: ["public", "free"] } };
  const [{ member }, featuredRow, latest] = await Promise.all([
    loadViewer(loaded.organizationId, site.id),
    db.webPost.findFirst({ where: liveWhere(loaded, { kind: "post", featured: true }), orderBy: { publishedAt: "desc" }, select: CARD_SELECT }),
    livePosts(loaded, publicOnly, 16),
  ]);
  const featured = featuredRow ?? latest[0];
  const rest = latest.filter((post) => post.id !== featured?.id);
  const side = rest.slice(0, 4);
  const picks = rest.slice(4, 8);
  const list = rest.slice(8, 14);
  const signupPub = pubFor(loaded, site.signupPublicationId) ?? loaded.free[0];
  const featuredEditor = featured ? editorOf(loaded, featured) : undefined;
  const featuredBody = featured ? await db.webPost.findFirst({ where: { id: featured.id }, select: { bodyHtml: true } }) : null;
  return (
    <SiteShell loaded={loaded} member={member} active="/">
      {featured ? (
        <section className="hero dark">
          <div className="wrap grid">
            <article className="feat">
              <a href={`${base}/${featured.slug}`}>
                <Img loaded={loaded} assetId={featured.featuredAssetId} eager alt="" />
              </a>
              <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="tag tag-gold">Featured</span>
                <Kicker loaded={loaded} post={featured} gold />
              </div>
              <a href={`${base}/${featured.slug}`}>
                <h1>{featured.title}</h1>
              </a>
              <p>{featured.excerpt}</p>
              <div className="by">
                <EditorPhoto loaded={loaded} editorId={featured.authorEditorId} />
                <span>
                  {featured.authorName ? <b>{featured.authorName}</b> : null}
                  {featuredEditor?.title ? ` · ${featuredEditor.title}` : ""} · {fmtDate(featured.publishedAt, timeZone)}
                  {featuredBody ? ` · ${readingMinutes(featuredBody.bodyHtml)} min read` : ""}
                </span>
              </div>
            </article>
            <aside className="side">
              <h3>LATEST FROM {site.name.toUpperCase()}</h3>
              {side.map((post) => (
                <a key={post.id} className="it" href={`${base}/${post.slug}`}>
                  <div>
                    <Kicker loaded={loaded} post={post} gold />
                    <h4>{post.title}</h4>
                    <span className="m">
                      {post.authorName ? `${post.authorName} · ` : ""}
                      {ago(post.publishedAt, now, timeZone)}
                    </span>
                  </div>
                  <Img loaded={loaded} assetId={post.featuredAssetId} />
                </a>
              ))}
            </aside>
          </div>
        </section>
      ) : (
        <section className="hero dark">
          <div className="wrap">
            <h1 className="serif" style={{ fontSize: 40, color: "#fff", margin: 0 }}>{site.name}</h1>
            <p style={{ color: "#c7cdd7" }}>{site.tagline || "New articles are on the way."}</p>
          </div>
        </section>
      )}

      {signupPub ? (
        <section className="signup" id="signup">
          <div className="wrap">
            <PubBadge loaded={loaded} pub={signupPub} noName />
            <div>
              <h3>Get {signupPub.name}, free.</h3>
              <p>{signupPub.tagline || signupPub.description || "Ideas on markets, money and liberty from our editors."} Free. Unsubscribe any time.</p>
            </div>
            <div>
              {query.signup ? <FormNote status={query.signup} /> : <SignupForm loaded={loaded} pub={signupPub} back={`${base || ""}/#signup`} />}
            </div>
          </div>
        </section>
      ) : null}

      {picks.length ? (
        <section className="sec">
          <div className="wrap">
            <div className="sec-h">
              <h2>Editors&apos; Picks</h2>
              <a href={`${base}/latest`}>View all →</a>
            </div>
            <div className="cards">
              {picks.map((post, index) => (
                <a key={post.id} className="card" href={`${base}/${post.slug}`}>
                  <Img loaded={loaded} assetId={post.featuredAssetId} light={index % 2 === 0} />
                  <Kicker loaded={loaded} post={post} />
                  <h4>{post.title}</h4>
                  <p>{post.excerpt}</p>
                  <div className="meta">{post.authorName}</div>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {list.length || loaded.free.length ? (
        <section className="sec" style={{ paddingTop: picks.length ? 0 : undefined }}>
          <div className="wrap two">
            <div className="list">
              <div className="sec-h">
                <h2>Latest Articles</h2>
                <a href={`${base}/latest`}>Archive →</a>
              </div>
              {list.map((post, index) => (
                <a key={post.id} className="row" href={`${base}/${post.slug}`}>
                  <Img loaded={loaded} assetId={post.featuredAssetId} light={index % 2 === 1} />
                  <div>
                    <Kicker loaded={loaded} post={post} />
                    <h4>{post.title}</h4>
                    <p>{post.excerpt}</p>
                  </div>
                </a>
              ))}
              {list.length === 0 ? <p className="empty">More articles are coming soon.</p> : null}
            </div>
            <aside>
              {loaded.free.length ? (
                <div className="box">
                  <h5>Free Newsletters</h5>
                  <form method="post" action={`${base}/subscribe`}>
                    <input type="hidden" name="back" value={`${base || ""}/`} />
                    <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
                    {loaded.free.map((pub, index) => (
                      <label key={pub.id} className="nl">
                        <PubBadge loaded={loaded} pub={pub} size="sm" />
                        <input type="checkbox" name="publicationId" value={pub.id} defaultChecked={index < 2} />
                      </label>
                    ))}
                    <input className="field" type="email" name="email" required placeholder="Email address" aria-label="Email address" style={{ margin: "12px 0 10px" }} />
                    <button className="btn btn-navy" style={{ width: "100%" }}>
                      Subscribe free
                    </button>
                  </form>
                </div>
              ) : null}
            </aside>
          </div>
        </section>
      ) : null}

      {loaded.paid.length ? (
        <section className="pubs dark">
          <div className="wrap">
            <div className="sec-h">
              <h2>Premium Research</h2>
              <a href={`${base}/research`}>Compare all services →</a>
            </div>
            <div className="pgrid">
              {loaded.paid.slice(0, 6).map((pub) => (
                <div key={pub.id} className="pcard">
                  <PubBadge loaded={loaded} pub={pub} />
                  <p>{pub.description || pub.positioning || pub.tagline || ""}</p>
                  <div className="ed">
                    <span>{pub.editors.map((editor) => editor.name).slice(0, 2).join(", ")}</span>
                    <a className="btn btn-gold btn-sm" href={`${base}/research/${pub.slug}`}>
                      Learn more
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {loaded.editors.length ? (
        <section className="sec">
          <div className="wrap">
            <div className="sec-h">
              <h2>Meet Our Editors</h2>
              <a href={`${base}/editors`}>All editors →</a>
            </div>
            <div className="eds">
              {loaded.editors.slice(0, 5).map((editor) => (
                <a key={editor.id} href={`${base}/editors#${editor.slug}`}>
                  <EditorPhoto loaded={loaded} editorId={editor.id} />
                  <h4>{editor.name}</h4>
                  <p>{editor.publications.map((pub) => pub.name).slice(0, 2).join(", ") || editor.title}</p>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </SiteShell>
  );
}
