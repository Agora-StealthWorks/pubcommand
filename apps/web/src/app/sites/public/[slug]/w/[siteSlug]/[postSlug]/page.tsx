import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { RichContentStyles } from "@/components/rich-text-editor";
import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";
import { loadSite, loadViewer, liveWhere, pubFor, CARD_SELECT } from "@/features/websites/public";
import { EditorPhoto, FormNote, Img, PubBadge, SignupForm, SiteShell, editorOf, fmtDate } from "@/features/websites/site-view";
import { canRead, contentTypeLabel, isLive, readingMinutes, teaserHtml } from "../../../../../../../../../../modules/websites/content";

type Params = Promise<{ slug: string; siteSlug: string; postSlug: string }>;
type Search = Promise<{ preview?: string; signup?: string }>;

async function findPost(slug: string, siteSlug: string, postSlug: string, preview: boolean) {
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded || !/^[a-z0-9-]{1,80}$/.test(postSlug)) return null;
  const post = await tenantDb(loaded.organizationId).webPost.findFirst({ where: { siteId: loaded.site.id, slug: postSlug, deletedAt: null } });
  if (!post) return null;
  const live = isLive(post, loaded.now);
  if (!live && !(preview && loaded.staff)) return null;
  return { loaded, post, live };
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, siteSlug, postSlug } = await params;
  const found = await findPost(slug, siteSlug, postSlug, (await searchParams).preview === "1");
  if (!found) return { title: { absolute: "Not found" } };
  const { loaded, post, live } = found;
  const description = post.seoDescription || post.excerpt || undefined;
  const image = post.featuredAssetId ? `${loaded.base}/media/${post.featuredAssetId}` : undefined;
  return {
    title: { absolute: `${post.seoTitle || post.title} | ${loaded.site.name}` },
    description,
    openGraph: { title: post.seoTitle || post.title, description, type: "article", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title: post.seoTitle || post.title, description },
    robots: !live || post.access !== "public" ? { index: post.access === "public" && live, follow: true } : undefined,
  };
}

/** A post or page. Locked posts show a teaser and the right call to action. */
export default async function WebsitePost({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, siteSlug, postSlug } = await params;
  const query = await searchParams;
  const found = await findPost(slug, siteSlug, postSlug, query.preview === "1");
  if (!found) notFound();
  const { loaded, post, live } = found;
  const { base, site, timeZone } = loaded;
  const db = tenantDb(loaded.organizationId);
  const { member, viewer } = await loadViewer(loaded.organizationId, site.id);
  const pub = pubFor(loaded, post.publicationId);
  const decision = loaded.staff ? ({ allowed: true } as const) : canRead(post, viewer);
  const html = sanitizeRichText(post.bodyHtml, 400_000);
  const shown = decision.allowed ? html : teaserHtml(html, post.teaserBlocks);
  const editor = editorOf(loaded, post);
  const [terms, related, products] = await Promise.all([
    db.webPostTerm.findMany({ where: { postId: post.id }, select: { term: { select: { name: true, slug: true, kind: true } } } }),
    post.kind === "post"
      ? db.webPost.findMany({
          where: liveWhere(loaded, { kind: "post", id: { not: post.id }, ...(post.publicationId ? { publicationId: post.publicationId } : {}), access: { in: ["public", "free"] } }),
          orderBy: { publishedAt: "desc" },
          take: 3,
          select: CARD_SELECT,
        })
      : Promise.resolve([]),
    !decision.allowed && pub ? db.webProduct.findMany({ where: { siteId: site.id, active: true, offerUrl: { not: null }, OR: [{ publicationIds: { has: pub.id } }, { allPublications: true }] }, orderBy: { sortOrder: "asc" }, take: 1 }) : Promise.resolve([]),
  ]);
  const category = terms.find((row) => row.term.kind === "category" && row.term.slug !== "uncategorized")?.term;
  const signupPub = pubFor(loaded, site.signupPublicationId) ?? loaded.free[0];
  const promoPub = pub && !loaded.free.includes(pub) ? pub : loaded.paid[0];
  const offer = products[0]?.offerUrl ?? (pub ? `${base}/research/${pub.slug}` : `${base}/research`);
  const backHere = `${base}/${post.slug}`;
  const isPage = post.kind === "page";
  return (
    <SiteShell loaded={loaded} member={member}>
      <RichContentStyles />
      {!live ? <div className="preview-bar">Preview — this {post.kind} is not published.</div> : null}
      <div className={`wrap art`} style={isPage ? { gridTemplateColumns: "minmax(0,1fr)", maxWidth: 900 } : undefined}>
        <article>
          {!isPage ? (
            <div className="crumb">
              {pub ? <a href={`${base}/${loaded.free.includes(pub) ? "newsletters" : "research"}/${pub.slug}`}>{pub.name}</a> : <a href={base || "/"}>{site.name}</a>}
              {category ? (
                <>
                  {" "}
                  / <a href={`${base}/category/${category.slug}`}>{category.name}</a>
                </>
              ) : null}
              {post.contentType !== "article" ? ` / ${contentTypeLabel(post.contentType)}` : ""}
            </div>
          ) : null}
          <h1 className="t">{post.title}</h1>
          {post.excerpt && !isPage ? <p className="dek">{post.excerpt}</p> : null}
          {!isPage ? (
            <div className="byl">
              <EditorPhoto loaded={loaded} editorId={post.authorEditorId} />
              <div>
                {post.authorName ? <b>{post.authorName}</b> : null}
                {editor?.title ? <span style={{ color: "var(--muted)" }}> · {editor.title}</span> : null}
                <br />
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {fmtDate(post.publishedAt, timeZone, "long")} · {readingMinutes(post.bodyHtml)} min read
                </span>
              </div>
              <div className="sh">
                <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}`} target="_blank" rel="noreferrer" aria-label="Share on X">
                  X
                </a>
                <a href={`mailto:?subject=${encodeURIComponent(post.title)}`} aria-label="Share by email">
                  ✉
                </a>
              </div>
            </div>
          ) : null}
          {post.featuredAssetId && !isPage ? <Img loaded={loaded} assetId={post.featuredAssetId} className="figure" eager alt="" /> : null}
          <div className={`body rte-content${isPage ? "" : ""}`} style={isPage ? { marginTop: 24, maxWidth: "none" } : undefined} dangerouslySetInnerHTML={{ __html: shown }} />
          {!decision.allowed ? (
            <div className="paywall">
              <div className="gate">
                {pub ? <PubBadge loaded={loaded} pub={pub} /> : null}
                {decision.reason === "sign-in" ? (
                  <>
                    <h3>Keep reading free</h3>
                    <p>This article is for subscribers. Sign up free, or sign in if you already have an account.</p>
                    {signupPub ? (
                      query.signup ? (
                        <FormNote status={query.signup} />
                      ) : (
                        <div style={{ maxWidth: 480, margin: "0 auto 14px" }}>
                          <SignupForm loaded={loaded} pub={signupPub} back={backHere} dark button="Read free" />
                        </div>
                      )
                    ) : null}
                    <div className="acts">
                      <a className="btn btn-ghost btn-sm" href={`${base}/sign-in?next=${encodeURIComponent(backHere)}`}>
                        Member login
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{pub ? `This is ${pub.name} research` : "This is for members"}</h3>
                    <p>{member ? "Your current membership does not include it. Upgrade to read the full issue and everything else in this service." : "Members read the full issue. Sign in, or see how to join."}</p>
                    <div className="acts">
                      <a className="btn btn-gold" href={offer}>
                        {member ? "Upgrade" : "See how to join"}
                      </a>
                      {!member ? (
                        <a className="btn btn-ghost" href={`${base}/sign-in?next=${encodeURIComponent(backHere)}`}>
                          Member login
                        </a>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
          {decision.allowed && !isPage && signupPub && !member ? (
            <div className="inline-cta dark">
              <PubBadge loaded={loaded} pub={signupPub} noName />
              <div>
                <h4>Enjoying this? Get {signupPub.name}, free.</h4>
                <p>{signupPub.tagline || "From our editors to your inbox."}</p>
                {query.signup ? <FormNote status={query.signup} /> : <SignupForm loaded={loaded} pub={signupPub} back={backHere} dark button="Sign up" />}
              </div>
            </div>
          ) : null}
          {terms.some((row) => row.term.kind === "tag") ? (
            <div className="tags">
              {terms
                .filter((row) => row.term.kind === "tag")
                .map((row) => (
                  <a key={row.term.slug} href={`${base}/tag/${row.term.slug}`}>
                    #{row.term.name}
                  </a>
                ))}
            </div>
          ) : null}
          {site.disclaimer && !isPage ? <p className="disc">{site.disclaimer}</p> : null}
        </article>
        {!isPage ? (
          <aside className="rail">
            {signupPub && !member ? (
              <div className="box" style={{ background: "var(--cream)" }}>
                <h5>Free e-letter</h5>
                <PubBadge loaded={loaded} pub={signupPub} />
                <form method="post" action={`${base}/subscribe`} style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <input type="hidden" name="publicationId" value={signupPub.id} />
                  <input type="hidden" name="back" value={backHere} />
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
                  <input className="field" type="email" name="email" required placeholder="Email address" aria-label="Email address" />
                  <button className="btn btn-navy">Subscribe free</button>
                </form>
              </div>
            ) : null}
            {related.length ? (
              <div className="plain">
                <h5>Related</h5>
                {related.map((item) => (
                  <a key={item.id} className="rel" href={`${base}/${item.slug}`}>
                    <h6>{item.title}</h6>
                    <span>{item.authorName}</span>
                  </a>
                ))}
              </div>
            ) : null}
            {promoPub ? (
              <div className="promo dark">
                <PubBadge loaded={loaded} pub={promoPub} />
                <p>{promoPub.tagline || promoPub.description || "Our premium research."}</p>
                <a className="btn btn-gold btn-sm" href={`${base}/research/${promoPub.slug}`}>
                  See the research
                </a>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </SiteShell>
  );
}
