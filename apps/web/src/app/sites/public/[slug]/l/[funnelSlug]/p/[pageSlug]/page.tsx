import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { orgPublicUrl } from "@/features/funnels/guard";
import { isClosed } from "../../../../../../../../../../../modules/funnels/state";
import { funnelRules } from "@/features/funnels/data";
import { loadPublicFunnel, publicSiteMatches, viewerFacts, type PreviewOptions } from "@/features/funnels/public";
import { pageContext } from "@/features/funnels/public-context";
import { FunnelShell, NavStrip } from "@/features/funnels/public-shell";
import { ClosedView, EmailOptin, FormOptin, PreviewBar, Rich } from "@/features/funnels/public-view";
import { HtmlFrame } from "@/features/funnels/site-client";
import { pageHref } from "@/features/funnels/site-data";

type Params = Promise<{ slug: string; funnelSlug: string; pageSlug: string }>;
type Search = Promise<PreviewOptions & { joined?: string; error?: string }>;

async function load(slug: string, funnelSlug: string, pageSlug: string, query: PreviewOptions) {
  if (!/^[a-z0-9-]{1,60}$/.test(pageSlug) || !(await publicSiteMatches(slug))) return null;
  const loaded = await loadPublicFunnel(slug, funnelSlug, query);
  const item = loaded?.navItems.find((row) => row.kind === "page" && row.slug === pageSlug);
  return loaded && item ? { loaded, item } : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, funnelSlug, pageSlug } = await params;
  const found = await load(slug, funnelSlug, pageSlug, await searchParams);
  if (!found) return { title: { absolute: "Not found" } };
  return { title: { absolute: `${found.item.title || found.item.label || "Page"} · ${found.loaded.funnel.name}` }, robots: found.loaded.preview ? { index: false, follow: false } : undefined };
}

/** A custom page: /l/<funnel>/p/<page>. Rich text in the content box, or admin HTML in a sandbox; optional opt-in under it. */
export default async function FunnelCustomPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, funnelSlug, pageSlug } = await params;
  const query = await searchParams;
  const found = await load(slug, funnelSlug, pageSlug, query);
  if (!found) notFound();
  const { loaded, item } = found;
  const { funnel, timeZone, preview, now, carry } = loaded;
  const ctx = await pageContext(loaded, { fresh: query.fresh });
  const { base, viewer, theme } = ctx;
  const closed = isClosed(funnelRules(funnel), viewerFacts(viewer), now);
  if (closed && funnel.closeMode === "redirect" && funnel.closeRedirectUrl && !preview) redirect(funnel.closeRedirectUrl);
  const previewBar = preview ? <PreviewBar asOf={now} label={[funnel.status === "published" ? "" : "draft", loaded.draftShown ? "unsaved changes" : ""].filter(Boolean).join(", ")} timeZone={timeZone} /> : null;
  if (closed) {
    return (
      <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} showDeadline={false}>
        <ClosedView funnel={funnel} branding={theme.branding} />
      </FunnelShell>
    );
  }
  const title = item.title.trim() || item.label.trim();
  const heading = title ? <h1 className="text-2xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">{title}</h1> : null;
  const back = pageHref(funnel, base, item.slug);
  const nav = <NavStrip funnel={funnel} days={ctx.safeDays} states={ctx.states} navItems={loaded.navItems} base={base} carry={carry} currentPageSlug={item.slug} />;
  return (
    <FunnelShell theme={theme} loaded={loaded} viewer={viewer} preview={previewBar} nav={nav}>
      <main className="mx-auto max-w-4xl px-4 py-8">
        {item.titlePlacement === "outside" && heading ? <div className="mb-4">{heading}</div> : null}
        <article className="pcf-content">
          {item.titlePlacement === "inside" && heading ? <div className="mb-4">{heading}</div> : null}
          {item.contentMode === "html" ? (
            <HtmlFrame html={item.html} title={title || "Page"} textColor={theme.design.content.text ?? theme.design.page.text} linkColor={theme.design.content.link ?? theme.design.page.accent} />
          ) : (
            <Rich html={item.bodyHtml} className="text-base" />
          )}
        </article>
        {item.optinMode === "email" ? (
          <div className="pcf-content mt-6">
            <EmailOptin funnel={funnel} branding={theme.branding} action={`${base || `/l/${funnel.slug}`}/optin`} back={back} joined={query.joined === "1"} error={query.error} />
          </div>
        ) : item.optinMode === "form" && item.optinFormSlug ? (
          <div className="mt-6">
            <FormOptin src={orgPublicUrl(ctx.host, slug, `/embed/${item.optinFormSlug}`)} headline="" />
          </div>
        ) : null}
      </main>
    </FunnelShell>
  );
}
