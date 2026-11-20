import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite, loadViewer } from "@/features/websites/public";
import { FormNote, PubBadge, SiteShell } from "@/features/websites/site-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Free newsletters | ${loaded.site.name}` : "Not found" } };
}

export default async function IndexPage({ params, searchParams }: { params: Params; searchParams: Promise<{ signup?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  const { base } = loaded;
  const pubs = loaded.free;
  return (
    <SiteShell loaded={loaded} member={member} active="/newsletters">
      <section className="mast dark" style={{ padding: "40px 0" }}>
        <div className="wrap">
          <span className="label gold">Free, by email</span>
          <h1>Our free newsletters</h1>
          <p>Ideas on markets, money and liberty from our editors, free in your inbox. Pick one or all.</p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap">
          {query.signup ? <div style={{ marginBottom: 20 }}><FormNote status={query.signup} /></div> : null}
          <div className="pgrid light-pcards">
            {pubs.map((pub) => (
              <div key={pub.id} className="pcard">
                <PubBadge loaded={loaded} pub={pub} />
                <p>{pub.description || pub.tagline || ""}</p>
                <div className="ed">
                  <span>{[pub.frequency, pub.editors.map((editor) => editor.name).slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
                  <a className="btn btn-navy btn-sm" href={`${base}/newsletters/${pub.slug}`}>
                    Sign up free
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
