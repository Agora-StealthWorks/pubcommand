import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { CARD_SELECT, liveWhere, pubBySlug } from "@/features/websites/public";
import { membersPage } from "@/features/websites/members-area";
import { Img, MembersShell, PubBadge, fmtDate } from "@/features/websites/site-view";
import { ownsPublication } from "../../../../../../../../../../../modules/websites/content";

type Params = Promise<{ slug: string; siteSlug: string; pub: string }>;

export const metadata: Metadata = { title: { absolute: "My research" }, robots: { index: false } };

const TABS = [
  ["latest", "Latest", null],
  ["issues", "Issues", "issue"],
  ["alerts", "Alerts", "alert"],
  ["updates", "Updates", "update"],
  ["reports", "Special Reports", "report"],
  ["start", "Getting Started", "guide"],
] as const;

/** A publication inside the members area: its latest issue and tabs by content type. */
export default async function MemberPublication({ params, searchParams }: { params: Params; searchParams: Promise<{ tab?: string }> }) {
  const { slug, siteSlug, pub: pubSlug } = await params;
  const query = await searchParams;
  const area = await membersPage(slug, siteSlug, `/my/${pubSlug}`);
  if (!area) notFound();
  const { loaded, member } = area;
  const pub = pubBySlug(loaded, pubSlug);
  if (!pub) notFound();
  const { base, timeZone } = loaded;
  const owns = ownsPublication(member.access, pub.id) || loaded.free.includes(pub);
  const tab = TABS.find((item) => item[0] === query.tab) ?? TABS[0];
  const db = tenantDb(loaded.organizationId);
  const posts = await db.webPost.findMany({
    where: liveWhere(loaded, { kind: "post", publicationId: pub.id, ...(tab[2] ? { contentType: tab[2] } : {}) }),
    orderBy: { publishedAt: "desc" },
    take: 40,
    select: CARD_SELECT,
  });
  const [lead, ...rest] = posts;
  const offer = owns ? null : ((await db.webProduct.findFirst({ where: { siteId: loaded.site.id, active: true, offerUrl: { not: null }, publicationIds: { has: pub.id } }, select: { offerUrl: true } }))?.offerUrl ?? `${base}/research/${pub.slug}`);
  return (
    <MembersShell loaded={loaded} member={member} active="research">
      <section className="pmast dark">
        <div className="wrap">
          <div className="top">
            <PubBadge loaded={loaded} pub={pub} size="lg" />
            <div className="info">
              <span className={`tag ${owns ? "tag-gold" : "tag-cream"}`}>{owns ? "Active" : "🔒 Not in your plan"}</span>
              {pub.editors.length ? (
                <p style={{ margin: "8px 0 0" }}>
                  Edited by <b>{pub.editors.map((editor) => editor.name).join(", ")}</b>
                  {pub.frequency ? <><br />{pub.frequency}</> : null}
                </p>
              ) : null}
            </div>
          </div>
          <nav className="tabs" aria-label={pub.name}>
            {TABS.map(([key, label]) => (
              <a key={key} href={`${base}/my/${pub.slug}${key === "latest" ? "" : `?tab=${key}`}`} className={tab[0] === key ? "on" : undefined}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>
      <div className="wrap" style={{ padding: "30px 16px 60px" }}>
        {!owns ? (
          <div className="panel" style={{ borderTop: "4px solid var(--gold)" }}>
            <div className="ph2">
              <h2>Unlock {pub.name}</h2>
            </div>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>You can see what is published here. Upgrade to read the full issues.</p>
            <a className="btn btn-gold" href={offer!}>
              Upgrade
            </a>
          </div>
        ) : null}
        {lead ? (
          <div className="panel" style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" }}>
            <a href={`${base}/${lead.slug}`}>
              <Img loaded={loaded} assetId={lead.featuredAssetId} className="img" />
            </a>
            <div>
              <span className="label">{fmtDate(lead.publishedAt, timeZone, "long")}</span>
              <h3 className="serif" style={{ fontSize: 30, lineHeight: 1.15, color: "var(--navy)", margin: "8px 0 10px" }}>
                <a href={`${base}/${lead.slug}`}>{lead.title}</a>
              </h3>
              <p style={{ color: "var(--muted)" }}>{lead.excerpt}</p>
              <a className="btn btn-navy" href={`${base}/${lead.slug}`}>
                {owns ? "Read" : "Preview"}
              </a>
            </div>
          </div>
        ) : (
          <p className="empty">Nothing in {tab[1].toLowerCase()} yet.</p>
        )}
        {rest.length ? (
          <div className="panel">
            <div className="ph2">
              <h2>{tab[0] === "latest" ? "Past issues & updates" : tab[1]}</h2>
            </div>
            {rest.map((post) => (
              <a key={post.id} className="iss" href={`${base}/${post.slug}`}>
                <span className="d">{fmtDate(post.publishedAt, timeZone)}</span>
                <h4>{post.title}</h4>
                {!owns && post.access === "members" ? <span className="lock">🔒</span> : <span />}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <style>{`@media(max-width:820px){.ws .panel[style*="grid-template-columns"]{grid-template-columns:1fr!important}}.ws .panel .img{aspect-ratio:16/9;border-radius:3px;overflow:hidden}`}</style>
    </MembersShell>
  );
}
