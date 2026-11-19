import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { CARD_SELECT, liveWhere } from "@/features/websites/public";
import { membersPage } from "@/features/websites/members-area";
import { MembersShell, PubBadge, ago, fmtDate } from "@/features/websites/site-view";
import { contentTypeLabel, entitlementActive } from "../../../../../../../../../../modules/websites/content";

type Params = Promise<{ slug: string; siteSlug: string }>;

export const metadata: Metadata = { title: { absolute: "My account" }, robots: { index: false } };

function greeting(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Members dashboard: my subscriptions, the latest from my research, alerts, upgrade. */
export default async function MembersHome({ params }: { params: Params }) {
  const { slug, siteSlug } = await params;
  const area = await membersPage(slug, siteSlug, "/my");
  if (!area) notFound();
  const { loaded, member, owned, locked } = area;
  const { base, site, now, timeZone } = loaded;
  const db = tenantDb(loaded.organizationId);
  const ownedIds = owned.map((pub) => pub.id);
  const paidIds = loaded.paid.map((pub) => pub.id);
  const [feed, alerts, products, upsell] = await Promise.all([
    db.webPost.findMany({ where: liveWhere(loaded, { kind: "post", publicationId: { in: paidIds } }), orderBy: { publishedAt: "desc" }, take: 8, select: CARD_SELECT }),
    db.webPost.findMany({ where: liveWhere(loaded, { kind: "post", contentType: "alert", publicationId: { in: ownedIds.length ? ownedIds : ["00000000-0000-0000-0000-000000000000"] } }), orderBy: { publishedAt: "desc" }, take: 3, select: CARD_SELECT }),
    db.webProduct.findMany({ where: { siteId: site.id }, select: { id: true, name: true, publicationIds: true, allPublications: true } }),
    db.webProduct.findFirst({ where: { siteId: site.id, active: true, allPublications: true, offerUrl: { not: null } }, orderBy: { sortOrder: "asc" } }),
  ]);
  const since = member.entitlements.length ? null : member.createdAt;
  const ownedEntitlement = (pubId: string) => {
    for (const entitlement of member.entitlements) {
      if (!entitlementActive(entitlement, now)) continue;
      const product = products.find((item) => item.id === entitlement.productId);
      if (product && (product.allPublications || product.publicationIds.includes(pubId))) return { entitlement, product };
    }
    return null;
  };
  const offerFor = async (pubId: string) =>
    (await db.webProduct.findFirst({ where: { siteId: site.id, active: true, offerUrl: { not: null }, publicationIds: { has: pubId } }, orderBy: { sortOrder: "asc" }, select: { offerUrl: true } }))?.offerUrl ?? null;
  const lockedOffers = await Promise.all(locked.slice(0, 4).map(async (pub) => ({ pub, offer: (await offerFor(pub.id)) ?? `${base}/research/${pub.slug}` })));
  const firstName = (member.name || "").split(" ")[0];
  return (
    <MembersShell loaded={loaded} member={member} active="home">
      <section className="welcome dark">
        <div className="wrap">
          <span className="label gold">Welcome back</span>
          <h1>
            {greeting(now, timeZone)}
            {firstName ? `, ${firstName}` : ""}.
          </h1>
          <p>{owned.length ? `You have ${owned.length} research service${owned.length === 1 ? "" : "s"}.` : since ? `Free member since ${fmtDate(since, timeZone)}.` : ""}</p>
        </div>
      </section>
      <div className="wrap mmain">
        <div className="panel">
          <div className="ph2">
            <h2>My Subscriptions</h2>
            <a href={`${base}/my/account`}>Manage account →</a>
          </div>
          <div className="subs">
            {owned.map((pub) => {
              const held = ownedEntitlement(pub.id);
              return (
                <div key={pub.id} className="sub">
                  <PubBadge loaded={loaded} pub={pub} />
                  <div className="st">
                    <b>● {held?.entitlement.status === "past_due" ? "Payment due" : "Active"}</b>
                    {held ? ` · ${held.product.name}` : ""}
                    <br />
                    {held?.entitlement.endsAt ? `Through ${fmtDate(held.entitlement.endsAt, timeZone)}` : "No end date"}
                  </div>
                  <div className="acts">
                    <a className="btn btn-navy btn-sm" href={`${base}/my/${pub.slug}`}>
                      Open
                    </a>
                    <a className="btn btn-line btn-sm" href={`${base}/my/${pub.slug}?tab=reports`}>
                      Reports
                    </a>
                  </div>
                </div>
              );
            })}
            {lockedOffers.map(({ pub, offer }) => (
              <div key={pub.id} className="sub locked">
                <span className="badge lock">🔒 Locked</span>
                <PubBadge loaded={loaded} pub={pub} />
                <div className="st">{pub.tagline || pub.description?.slice(0, 90) || "Premium research."}</div>
                <div className="acts">
                  <a className="btn btn-gold btn-sm" href={offer}>
                    Upgrade
                  </a>
                  <a className="btn btn-line btn-sm" href={`${base}/research/${pub.slug}`}>
                    Preview
                  </a>
                </div>
              </div>
            ))}
            {owned.length === 0 && locked.length === 0 ? <p className="empty" style={{ gridColumn: "1/-1" }}>No research services yet.</p> : null}
          </div>
        </div>
        <div className="grid2">
          <div className="panel feed">
            <div className="ph2">
              <h2>Latest From Your Research</h2>
              <a href={`${base}/my/research`}>All issues →</a>
            </div>
            {feed.map((post) => {
              const pub = loaded.paid.find((item) => item.id === post.publicationId)!;
              const mine = ownedIds.includes(pub.id) || post.access !== "members";
              return (
                <a key={post.id} className="it" href={mine ? `${base}/${post.slug}` : `${base}/research/${pub.slug}`} style={mine ? undefined : { opacity: 0.75 }}>
                  <PubBadge loaded={loaded} pub={pub} noName />
                  <div>
                    <span className="tag tag-cream">{contentTypeLabel(post.contentType)}</span>
                    <h4>{post.title}</h4>
                    <div className="m">
                      {pub.name}
                      {post.authorName ? ` · ${post.authorName}` : ""} · {ago(post.publishedAt, now, timeZone)}
                    </div>
                  </div>
                  {mine ? (now.getTime() - (post.publishedAt?.getTime() ?? 0) < 2 * 86400000 ? <span className="tag tag-gold">New</span> : <span />) : <span className="lock">🔒 Upgrade</span>}
                </a>
              );
            })}
            {feed.length === 0 ? <p className="empty">New issues will appear here.</p> : null}
          </div>
          <div>
            <div className="panel">
              <div className="ph2">
                <h2>Recent Alerts</h2>
                <a href={`${base}/my/alerts`}>All →</a>
              </div>
              {alerts.map((post) => (
                <a key={post.id} className="alert" href={`${base}/${post.slug}`}>
                  <span className="tag tag-navy">Alert</span>
                  <h5>{post.title}</h5>
                  <p>
                    {loaded.paid.find((pub) => pub.id === post.publicationId)?.name} · {ago(post.publishedAt, now, timeZone)}
                  </p>
                </a>
              ))}
              {alerts.length === 0 ? <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>No alerts from your services yet.</p> : null}
            </div>
            {upsell && !member.access.all ? (
              <div className="up-card dark">
                <span className="label gold">Our highest level</span>
                <h3 className="serif" style={{ color: "#fff", fontSize: 24, margin: "8px 0 0" }}>{upsell.name}</h3>
                <p>Every publication we publish, now and in the future, with one membership.</p>
                <a className="btn btn-gold" href={upsell.offerUrl!}>
                  See the offer
                </a>
              </div>
            ) : null}
            <div className="panel">
              <div className="ph2">
                <h2>Quick Links</h2>
              </div>
              <div className="qa">
                <a href={`${base}/my/research`}>
                  My research<span>Every issue</span>
                </a>
                <a href={`${base}/newsletters`}>
                  Free newsletters<span>Sign up for more</span>
                </a>
                <a href={`${base}/my/account`}>
                  Account<span>Email &amp; sign out</span>
                </a>
                <a href={site.supportEmail ? `mailto:${site.supportEmail}` : `${base}/my/account`}>
                  Support<span>Talk to us</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MembersShell>
  );
}
