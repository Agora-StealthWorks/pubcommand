import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { CARD_SELECT, liveWhere } from "@/features/websites/public";
import { membersPage } from "@/features/websites/members-area";
import { MembersShell, PubBadge, fmtDate } from "@/features/websites/site-view";
import { contentTypeLabel } from "../../../../../../../../../../../modules/websites/content";

type Params = Promise<{ slug: string; siteSlug: string }>;

export const metadata: Metadata = { title: { absolute: "Alerts" }, robots: { index: false } };

export default async function MemberList({ params }: { params: Params }) {
  const { slug, siteSlug } = await params;
  const area = await membersPage(slug, siteSlug, "/my/alerts");
  if (!area) notFound();
  const { loaded, member, owned } = area;
  const { base, timeZone } = loaded;
  const ids = owned.map((pub) => pub.id);
  const posts = ids.length
    ? await tenantDb(loaded.organizationId).webPost.findMany({ where: liveWhere(loaded, { kind: "post", publicationId: { in: ids }, contentType: "alert" }), orderBy: { publishedAt: "desc" }, take: 60, select: CARD_SELECT })
    : [];
  return (
    <MembersShell loaded={loaded} member={member} active="alerts">
      <section className="welcome dark" style={{ paddingBottom: 30 }}>
        <div className="wrap">
          <span className="label gold">Members</span>
          <h1>Alerts</h1>
        </div>
      </section>
      <div className="wrap" style={{ padding: "30px 16px 60px" }}>
        
        <div className="panel feed">
          {posts.map((post) => {
            const pub = owned.find((item) => item.id === post.publicationId)!;
            return (
              <a key={post.id} className="it" href={`${base}/${post.slug}`}>
                <PubBadge loaded={loaded} pub={pub} noName />
                <div>
                  <span className="tag tag-cream">{contentTypeLabel(post.contentType)}</span>
                  <h4>{post.title}</h4>
                  <div className="m">
                    {pub.name} · {fmtDate(post.publishedAt, timeZone)}
                  </div>
                </div>
                <span />
              </a>
            );
          })}
          {posts.length === 0 ? <p className="empty">No alerts from your services yet.</p> : null}
        </div>
      </div>
    </MembersShell>
  );
}
