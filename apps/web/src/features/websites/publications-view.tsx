import { tenantDb } from "@pubcommand/db";
import type { Publication } from "@/features/pubsetup/read";
import { approvedForPublication } from "@/features/testimonials/read";
import { groupByCategory } from "../../../../../modules/pubsetup/categories";
import { ownsPublication } from "../../../../../modules/websites/content";
import { isFreePublication } from "./data";
import type { SignedInMember } from "./members";
import { livePosts, type LoadedSite } from "./public";
import { EditorPhoto, FormNote, Img, SiteShell, fmtDate } from "./site-view";

/**
 * The website's publications: a list grouped by the brand's categories, and one page per
 * publication. Everything comes from Publication Setup (and approved testimonials); nothing is
 * written per brand. Internal fields (tier, type, positioning, audience, sale price, pricing
 * notes, voice and compliance notes) are never shown.
 */

/** Where a publication's page lives: free ones under /newsletters, paid ones under /research. */
export function publicationHref(loaded: LoadedSite, pub: Publication): string {
  return `${loaded.base}/${isFreePublication(pub) ? "newsletters" : "research"}/${pub.slug}`;
}

/** Short price line for a card: the first offer, else the retail price. Never the internal sale price. */
export function priceLine(pub: Publication): string | null {
  if (isFreePublication(pub)) return "Free";
  const offer = pub.offers.find((row) => row.price);
  if (offer) return [offer.price, offer.term].filter(Boolean).join(" ");
  return pub.retailPrice || null;
}

function editorNames(pub: Publication): string {
  const names = pub.editors.map((editor) => editor.name);
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, 2).join(", ")} & more`;
}

/** The publication's logo on a tile that suits its artwork (light card, or navy for light artwork). */
function LogoTile({ loaded, pub, size = "md" }: { loaded: LoadedSite; pub: Publication; size?: "md" | "lg" }) {
  const darkOnly = !pub.logos.light && pub.logos.dark;
  const v = pub.updatedAt.getTime();
  return (
    <span className={`plogo ${size}${darkOnly || !pub.hasLogo ? " on-dark" : ""}`}>
      {pub.hasLogo ? (
        <img src={`${loaded.base}/pub-logo/${pub.id}?bg=${darkOnly ? "dark" : "light"}&v=${v}`} alt="" loading="lazy" />
      ) : (
        <span className="ini">{pub.name.replace(/^the\s+/i, "").slice(0, 1)}</span>
      )}
    </span>
  );
}

function PublicationCard({ loaded, pub }: { loaded: LoadedSite; pub: Publication }) {
  const href = publicationHref(loaded, pub);
  const price = priceLine(pub);
  const free = isFreePublication(pub);
  return (
    <article className="pubcard">
      <a href={href} className="pubcard-logo" tabIndex={-1} aria-hidden>
        <LogoTile loaded={loaded} pub={pub} />
      </a>
      <div className="pubcard-body">
        <h3>
          <a href={href}>{pub.name}</a>
        </h3>
        {pub.editors.length ? <p className="pubcard-by">With {editorNames(pub)}</p> : null}
        <p className="pubcard-desc">{pub.description || pub.tagline || ""}</p>
        {price || pub.frequency ? (
          <p className="pubcard-meta">
            {[free ? null : pub.frequency, free ? (pub.frequency ? `Free · ${pub.frequency}` : "Free") : price].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
      <a className={`btn ${free ? "btn-gold" : "btn-navy"} btn-sm pubcard-cta`} href={href}>
        {free ? "Sign up free" : "Learn more"} <span aria-hidden>→</span>
      </a>
    </article>
  );
}

/** Publications grouped by category, with a jump bar. `pubs` keeps the caller's filter (all, free or paid). */
export function PublicationsList({
  loaded,
  member,
  pubs,
  active,
  kicker,
  title,
  intro,
  signup,
}: {
  loaded: LoadedSite;
  member: SignedInMember | null;
  pubs: Publication[];
  active: string;
  kicker: string;
  title: string;
  intro: string;
  signup?: string;
}) {
  const groups = groupByCategory(pubs, loaded.categories, "More publications");
  const { base, site } = loaded;
  const signupPub = loaded.free.find((pub) => pub.id === site.signupPublicationId) ?? loaded.free[0];
  return (
    <SiteShell loaded={loaded} member={member} active={active}>
      <section className="mast dark publist-mast">
        <div className="wrap">
          <span className="label gold">{kicker}</span>
          <h1>{title}</h1>
          <p>{intro}</p>
          {groups.length > 1 ? (
            <nav className="catjump" aria-label="Categories">
              {groups.map((group) => (
                <a key={group.key} href={`#cat-${group.key}`}>
                  {group.label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </section>
      {signup ? (
        <div className="wrap" style={{ paddingTop: 20 }}>
          <FormNote status={signup} />
        </div>
      ) : null}
      {groups.map((group, index) => (
        <section key={group.key} id={`cat-${group.key}`} className={`sec catsec${index % 2 ? " alt" : ""}`} aria-labelledby={`cat-h-${group.key}`}>
          <div className="wrap">
            <div className="sec-h">
              <h2 id={`cat-h-${group.key}`}>{group.label}</h2>
              <span className="label">
                {group.items.length} {group.items.length === 1 ? "publication" : "publications"}
              </span>
            </div>
            <div className="pubgrid">
              {group.items.map((pub) => (
                <PublicationCard key={pub.id} loaded={loaded} pub={pub} />
              ))}
            </div>
          </div>
        </section>
      ))}
      {pubs.length === 0 ? (
        <section className="sec">
          <div className="wrap">
            <p className="empty">Nothing here yet.</p>
          </div>
        </section>
      ) : null}
      {signupPub && !member ? (
        <section className="joinband">
          <div className="wrap">
            <span className="label gold">Not sure where to start?</span>
            <h2>Try {signupPub.name}, free</h2>
            <p>{signupPub.description || signupPub.tagline || `Get ${signupPub.name} by email.`}</p>
            <form className="inline" method="post" action={`${base}/subscribe`}>
              <input type="hidden" name="publicationId" value={signupPub.id} />
              <input type="hidden" name="back" value={`${base}/${active.replace(/^\//, "")}`} />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
              <input type="email" name="email" required placeholder="Your email address" aria-label="Email address" />
              <button className="btn btn-gold" type="submit">
                Sign up free
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </SiteShell>
  );
}

/** Splits a long description into paragraphs (blank line or single line breaks). */
function paragraphs(text: string | null): string[] {
  return (text ?? "")
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** One publication's page: hero, what you get, about, editors, pricing, testimonials, FAQ, latest issues, join. */
export async function PublicationProfile({ loaded, member, pub, signup }: { loaded: LoadedSite; member: SignedInMember | null; pub: Publication; signup?: string }) {
  const { base, site } = loaded;
  const free = isFreePublication(pub);
  const db = tenantDb(loaded.organizationId);
  const [product, testimonials, latest] = await Promise.all([
    free
      ? null
      : db.webProduct.findFirst({
          where: { siteId: site.id, active: true, offerUrl: { not: null }, OR: [{ publicationIds: { has: pub.id } }, { allPublications: true }] },
          orderBy: [{ allPublications: "asc" }, { sortOrder: "asc" }],
        }),
    approvedForPublication(loaded.organizationId, site.brandId, pub.id, 6),
    livePosts(loaded, { publicationId: pub.id }, 4),
  ]);
  const offerUrl = product?.offerUrl ?? pub.signupUrl ?? null;
  const owns = member ? ownsPublication(member.access, pub.id) : false;
  const path = publicationHref(loaded, pub);
  const editors = pub.editors.map((ref) => ({ ref, full: loaded.editors.find((editor) => editor.id === ref.id) }));
  const offers = pub.offers.filter((offer) => offer.label || offer.price);
  const showPricing = !free && (offers.length > 0 || pub.retailPrice || pub.lifetimePrice);
  const about = paragraphs(pub.longDescription || pub.description);
  const signInHref = `${base}/sign-in?next=${encodeURIComponent(`${base}/my/${pub.slug}`)}`;

  const freeForm = (dark: boolean) =>
    signup ? (
      <FormNote status={signup} />
    ) : (
      <form className={dark ? "inline" : "stack"} method="post" action={`${base}/subscribe`}>
        <input type="hidden" name="publicationId" value={pub.id} />
        <input type="hidden" name="back" value={`${path}#join`} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
        <input className={dark ? undefined : "field"} type="email" name="email" required placeholder="Your email address" aria-label="Email address" defaultValue={member?.email} />
        <button className={`btn ${dark ? "btn-gold" : "btn-navy"}`} type="submit">
          Sign up free
        </button>
      </form>
    );

  const action = free ? (
    <>
      <h2>Get it free</h2>
      <p>
        {pub.name} by email{pub.frequency ? `, ${pub.frequency.toLowerCase()}` : ""}. Unsubscribe any time.
      </p>
      {freeForm(false)}
      <p className="fine">We respect your privacy. Your email is never sold.</p>
    </>
  ) : owns ? (
    <>
      <h2>You&apos;re a member</h2>
      <p>Read every issue and update in your members area.</p>
      <a className="btn btn-navy" href={`${base}/my/${pub.slug}`}>
        Open {pub.name}
      </a>
    </>
  ) : (
    <>
      <h2>Join {pub.name}</h2>
      {priceLine(pub) ? <p className="price">{priceLine(pub)}</p> : null}
      <p>{pub.deliverables.length ? `Includes ${pub.deliverables.slice(0, 3).join(", ").toLowerCase()}${pub.deliverables.length > 3 ? " and more" : ""}.` : "Members get every issue and update."}</p>
      {offerUrl ? (
        <a className="btn btn-navy" href={offerUrl}>
          Subscribe now
        </a>
      ) : site.supportEmail ? (
        <a className="btn btn-navy" href={`mailto:${site.supportEmail}?subject=${encodeURIComponent(pub.name)}`}>
          Ask about joining
        </a>
      ) : null}
      <p className="fine">
        Already a member?{" "}
        <a href={signInHref} className="lnk">
          Log in
        </a>
      </p>
    </>
  );

  return (
    <SiteShell loaded={loaded} member={member} active={free ? "/newsletters" : "/research"}>
      <section className="mast dark pubhero">
        <div className="wrap grid">
          <div>
            <p className="crumbs">
              <a href={`${base}/publications`}>Publications</a>
              {pub.category ? (
                <>
                  {" "}
                  / <a href={`${base}/publications#cat-${pub.category.id}`}>{pub.category.name}</a>
                </>
              ) : null}
            </p>
            <div className="pubhero-id">
              <span className={`plogo lg${pub.logos.dark || !pub.hasLogo ? " on-dark" : ""}`}>
                {pub.hasLogo ? (
                  <img src={`${base}/pub-logo/${pub.id}?bg=dark&v=${pub.updatedAt.getTime()}`} alt="" />
                ) : (
                  <span className="ini">{pub.name.replace(/^the\s+/i, "").slice(0, 1)}</span>
                )}
              </span>
              <div>
                <h1>{pub.name}</h1>
                {pub.tagline ? <p className="tagline">{pub.tagline}</p> : null}
              </div>
            </div>
            {editors.length ? (
              <div className="pubhero-eds">
                {editors.map(({ ref }) => (
                  <a key={ref.id} href={`${base}/editors#${ref.slug}`} className="ed">
                    <EditorPhoto loaded={loaded} editorId={ref.id} className="av" />
                    <span>
                      <b>{ref.name}</b>
                      {ref.title ? <small>{ref.title}</small> : null}
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
            <ul className="chips" aria-label="At a glance">
              {free ? <li>Free</li> : null}
              {pub.frequency ? <li>{pub.frequency}</li> : null}
              {pub.category ? <li>{pub.category.name}</li> : null}
            </ul>
          </div>
          <div className="signup-card action-card" id="join">
            {action}
          </div>
        </div>
      </section>

      <div className="wrap pubbody">
        <div className="pubmain">
          {pub.deliverables.length ? (
            <section className="pubsec" aria-labelledby="get-h">
              <span className="label">Membership</span>
              <h2 id="get-h">What you get</h2>
              <ul className="gets">
                {pub.deliverables.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {about.length ? (
            <section className="pubsec prose" aria-labelledby="about-h">
              <span className="label">About</span>
              <h2 id="about-h">About {pub.name}</h2>
              {about.map((text, index) => (
                <p key={index}>{text}</p>
              ))}
            </section>
          ) : null}

          {showPricing ? (
            <section className="pubsec" aria-labelledby="price-h">
              <span className="label">Pricing</span>
              <h2 id="price-h">Choose your membership</h2>
              <div className="offers">
                {offers.map((offer, index) => (
                  <div key={index} className="offer">
                    <h3>{offer.label || pub.name}</h3>
                    {offer.price ? <p className="amt">{offer.price}</p> : null}
                    {offer.term ? <p className="term">{offer.term}</p> : null}
                  </div>
                ))}
                {!offers.length && pub.retailPrice ? (
                  <div className="offer">
                    <h3>Membership</h3>
                    <p className="amt">{pub.retailPrice}</p>
                  </div>
                ) : null}
                {!offers.length && pub.lifetimePrice ? (
                  <div className="offer">
                    <h3>Lifetime</h3>
                    <p className="amt">{pub.lifetimePrice}</p>
                  </div>
                ) : null}
              </div>
              {offerUrl && !owns ? (
                <a className="btn btn-navy" href={offerUrl}>
                  Subscribe now
                </a>
              ) : null}
            </section>
          ) : null}

          {testimonials.items.length ? (
            <section className="pubsec" aria-labelledby="say-h">
              <span className="label">Readers</span>
              <h2 id="say-h">What readers say</h2>
              <div className="quotes">
                {testimonials.items.map((item) => (
                  <figure key={item.id} className="quote">
                    <blockquote>“{item.quote}”</blockquote>
                    <figcaption>
                      <b>{item.displayName}</b>
                      {item.location ? `, ${item.location}` : ""}
                    </figcaption>
                    {item.disclosure ? <p className="disc-s">{item.disclosure}</p> : null}
                  </figure>
                ))}
              </div>
            </section>
          ) : null}

          {pub.faq.length ? (
            <section className="pubsec" aria-labelledby="faq-h">
              <span className="label">Questions</span>
              <h2 id="faq-h">Frequently asked questions</h2>
              <div className="faq">
                {pub.faq.map((row, index) => (
                  <details key={index}>
                    <summary>{row.question}</summary>
                    <p>{row.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          {latest.length ? (
            <section className="pubsec" aria-labelledby="latest-h">
              <div className="sec-h">
                <h2 id="latest-h" style={{ fontSize: 22 }}>
                  Latest from {pub.name}
                </h2>
                <a href={`${path}?page=1`}>All issues →</a>
              </div>
              <div className="list">
                {latest.map((post, index) => (
                  <a key={post.id} className="row" href={`${base}/${post.slug}`}>
                    <Img loaded={loaded} assetId={post.featuredAssetId} light={index % 2 === 1} />
                    <div>
                      <h4>
                        {post.title}
                        {post.access === "members" ? <span className="lock"> · Members</span> : null}
                      </h4>
                      <p>{post.excerpt}</p>
                      <div className="meta">{fmtDate(post.publishedAt, loaded.timeZone)}</div>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {editors.length ? (
          <aside className="pubside" aria-labelledby="eds-h">
            <h2 id="eds-h" className="side-h">
              {editors.length === 1 ? "Your editor" : "Your editors"}
            </h2>
            {editors.map(({ ref, full }) => (
              <div key={ref.id} className="edcard">
                <EditorPhoto loaded={loaded} editorId={ref.id} className="av" />
                <h3>{ref.name}</h3>
                {ref.title ? <p className="ttl">{ref.title}</p> : null}
                {full?.shortBio ? <p className="bio">{full.shortBio}</p> : null}
                <a className="lnk" href={`${base}/editors#${ref.slug}`}>
                  More about {ref.name.split(" ")[0]} →
                </a>
              </div>
            ))}
          </aside>
        ) : null}
      </div>

      {!owns ? (
        <section className="joinband">
          <div className="wrap">
            <span className="label gold">{free ? "Free by email" : "Ready to join?"}</span>
            <h2>{pub.tagline || pub.name}</h2>
            {free ? (
              freeForm(true)
            ) : offerUrl ? (
              <a className="btn btn-gold" href={offerUrl}>
                Subscribe to {pub.name}
              </a>
            ) : (
              <a className="btn btn-gold" href={signInHref}>
                Members log in
              </a>
            )}
          </div>
        </section>
      ) : null}
    </SiteShell>
  );
}
