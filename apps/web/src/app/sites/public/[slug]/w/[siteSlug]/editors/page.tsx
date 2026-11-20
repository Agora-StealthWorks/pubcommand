import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite, loadViewer } from "@/features/websites/public";
import { EditorPhoto, SiteShell } from "@/features/websites/site-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Our editors | ${loaded.site.name}` : "Not found" } };
}

/** Editors from Publication Setup (public fields only: never their email). */
export default async function EditorsPage({ params }: { params: Params }) {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  const { base } = loaded;
  return (
    <SiteShell loaded={loaded} member={member} active="/editors">
      <section className="sec">
        <div className="wrap">
          <div className="sec-h">
            <h2>Meet our editors</h2>
          </div>
          {loaded.editors.map((editor) => (
            <article key={editor.id} id={editor.slug} style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr)", gap: 28, padding: "28px 0", borderBottom: "1px solid var(--line)" }} className="editor-row">
              <EditorPhoto loaded={loaded} editorId={editor.id} className="av" />
              <div>
                <h3 className="osw" style={{ fontSize: 24, color: "var(--navy)", margin: 0 }}>{editor.name}</h3>
                {editor.title ? <p className="label" style={{ marginTop: 6 }}>{editor.title}</p> : null}
                <p style={{ whiteSpace: "pre-line", color: "var(--text)" }}>{editor.longBio || editor.shortBio || ""}</p>
                {editor.publications.length ? (
                  <p style={{ fontSize: 14, color: "var(--muted)" }}>
                    Writes:{" "}
                    {editor.publications.map((pub, index) => {
                      const full = loaded.publications.find((item) => item.id === pub.id);
                      const href = full ? `${base}/${loaded.free.includes(full) ? "newsletters" : "research"}/${full.slug}` : undefined;
                      return (
                        <span key={pub.id}>
                          {index ? ", " : ""}
                          {href ? <a href={href} style={{ color: "var(--dgold)", fontWeight: 600 }}>{pub.name}</a> : pub.name}
                        </span>
                      );
                    })}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
          {loaded.editors.length === 0 ? <p className="empty">Editors appear here once they are added in Publication Setup.</p> : null}
        </div>
      </section>
      <style>{`.ws .editor-row .av{width:140px;height:140px;border-radius:50%;object-fit:cover;background:linear-gradient(160deg,#d8c7a3,#9e8559);display:block}@media(max-width:700px){.ws .editor-row{grid-template-columns:80px minmax(0,1fr)!important;gap:16px!important}.ws .editor-row .av{width:80px;height:80px}}`}</style>
    </SiteShell>
  );
}
