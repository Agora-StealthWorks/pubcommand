import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite, loadViewer } from "@/features/websites/public";
import { PubBadge, SiteShell } from "@/features/websites/site-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Our research | ${loaded.site.name}` : "Not found" } };
}

export default async function IndexPage({ params, }: { params: Params }) {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  const { base } = loaded;
  const pubs = loaded.paid;
  return (
    <SiteShell loaded={loaded} member={member} active="/research">
      <section className="mast dark" style={{ padding: "40px 0" }}>
        <div className="wrap">
          <span className="label gold">Premium research</span>
          <h1>Our research services</h1>
          <p>In-depth research, model portfolios and alerts from our editors, for members.</p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap">
          
          <div className="pgrid light-pcards">
            {pubs.map((pub) => (
              <div key={pub.id} className="pcard">
                <PubBadge loaded={loaded} pub={pub} />
                <p>{pub.description || pub.tagline || ""}</p>
                <div className="ed">
                  <span>{[pub.frequency, pub.editors.map((editor) => editor.name).slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
                  <a className="btn btn-gold btn-sm" href={`${base}/research/${pub.slug}`}>
                    Learn more
                  </a>
                </div>
              </div>
            ))}
          </div>
          {pubs.length === 0 ? <p className="empty">Nothing here yet.</p> : null}
        </div>
      </section>
    </SiteShell>
  );
}
