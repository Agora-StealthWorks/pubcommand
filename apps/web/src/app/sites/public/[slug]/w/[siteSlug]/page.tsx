import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { loadSite, loadViewer, livePosts, pubFor, CARD_SELECT, liveWhere } from "@/features/websites/public";
import { EditorPhoto, FormNote, Img, Kicker, PubBadge, SignupForm, SiteShell, ago, editorOf, fmtDate } from "@/features/websites/site-view";
import { homepageFrom, type HomeSectionKey } from "../../../../../../../../../modules/websites/content";

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

const honeypot = <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />;

/** Website homepage (preview on PubCommand): the sections chosen in Websites → Homepage, in that order. */
export default async function WebsiteHome({ params, searchParams }: { params: Params; searchParams: Promise<{ signup?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { base, site, timeZone, now } = loaded;
  const db = tenantDb(loaded.organizationId);
  const home = homepageFrom(site.homepage);
  const layout = home.sections.filter((section) => section.on);
  const showing = new Set<HomeSectionKey>(layout.map((section) => section.key));
  const [{ member }, featuredRow, latest] = await Promise.all([
    loadViewer(loaded.organizationId, site.id),
    showing.has("featured") ? db.webPost.findFirst({ where: liveWhere(loaded, { kind: "post", featured: true }), orderBy: { publishedAt: "desc" }, select: CARD_SELECT }) : Promise.resolve(null),
    livePosts(loaded, { access: { in: ["public", "free"] } }, 16),
  ]);
  const featured = showing.has("featured") ? (featuredRow ?? latest[0]) : undefined;
  const rest = latest.filter((post) => post.id !== featured?.id);
  const side = featured ? rest.slice(0, 4) : [];
  const pool = featured ? rest.slice(4) : rest;
  const picks = showing.has("picks") ? pool.slice(0, 4) : [];
  const list = pool.slice(picks.length, picks.length + 6);
  const signupPub = pubFor(loaded, site.signupPublicationId) ?? loaded.free[0];
  const heroPub = pubFor(loaded, home.hero.signupPublicationId);
  const featuredEditor = featured ? editorOf(loaded, featured) : undefined;
  const home_ = base || "";

  const sections: Record<HomeSectionKey, () => ReactNode> = {
    hero: () =>
      home.hero.headline ? (
        <section key="hero" className="herob dark">
          {home.hero.imageAssetId ? <div className="bg" style={{ backgroundImage: `url(${base}/media/${home.hero.imageAssetId})` }} aria-hidden /> : null}
          <div className="wrap">
            <div>
              {home.hero.kicker ? <span className="label gold">{home.hero.kicker}</span> : null}
              <h1>{home.hero.headline}</h1>
              {home.hero.text ? <p className="lead">{home.hero.text}</p> : null}
              <div className="acts">
                {home.hero.buttonLabel && home.hero.buttonHref ? (
                  <a className="btn btn-gold" href={home.hero.buttonHref.startsWith("/") ? `${home_}${home.hero.buttonHref}` : home.hero.buttonHref}>
                    {home.hero.buttonLabel}
                  </a>
                ) : null}
                {home.hero.button2Label && home.hero.button2Href ? (
                  <a className="btn btn-ghost" href={home.hero.button2Href.startsWith("/") ? `${home_}${home.hero.button2Href}` : home.hero.button2Href}>
                    {home.hero.button2Label}
                  </a>
                ) : null}
              </div>
            </div>
            {heroPub ? (
              <div className="signup-card" id="hero-signup">
                <PubBadge loaded={loaded} pub={heroPub} />
                <h3 style={{ marginTop: 14 }}>Get {heroPub.name}, free</h3>
                <p>{heroPub.tagline || "From our editors to your inbox."}</p>
                {query.signup ? (
                  <FormNote status={query.signup} />
                ) : (
                  <form method="post" action={`${base}/subscribe`}>
                    <input type="hidden" name="publicationId" value={heroPub.id} />
                    <input type="hidden" name="back" value={`${home_}/#hero-signup`} />
                    {honeypot}
                    <input className="field" type="email" name="email" required placeholder="Your email address" aria-label="Email address" />
                    <button className="btn btn-navy">Sign up free</button>
                  </form>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null,

    featured: () =>
      featured ? (
        <section key="featured" className="hero dark">
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
      ) : null,

    signup: () =>
      signupPub ? (
        <section key="signup" className="signup" id="signup">
          <div className="wrap">
            <PubBadge loaded={loaded} pub={signupPub} noName />
            <div>
              <h3>Get {signupPub.name}, free.</h3>
              <p>{signupPub.tagline || signupPub.description || "Ideas on markets, money and liberty from our editors."} Free. Unsubscribe any time.</p>
            </div>
            <div>{query.signup ? <FormNote status={query.signup} /> : <SignupForm loaded={loaded} pub={signupPub} back={`${home_}/#signup`} />}</div>
          </div>
        </section>
      ) : null,

    picks: () =>
      picks.length ? (
        <section key="picks" className="sec">
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
      ) : null,

    latest: () =>
      list.length || loaded.free.length ? (
        <section key="latest" className="sec">
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
                    <input type="hidden" name="back" value={`${home_}/`} />
                    {honeypot}
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
      ) : null,

    research: () =>
      loaded.paid.length ? (
        <section key="research" className="pubs dark">
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
      ) : null,

    editors: () =>
      loaded.editors.length ? (
        <section key="editors" className="sec">
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
      ) : null,
  };

  const blocks = layout.map((section) => sections[section.key]()).filter(Boolean);
  return (
    <SiteShell loaded={loaded} member={member} active="/">
      {blocks.length ? (
        blocks
      ) : (
        <section className="hero dark">
          <div className="wrap">
            <h1 className="serif" style={{ fontSize: 40, color: "#fff", margin: 0 }}>{site.name}</h1>
            <p style={{ color: "#c7cdd7" }}>{site.tagline || "New articles are on the way."}</p>
          </div>
        </section>
      )}
    </SiteShell>
  );
}
