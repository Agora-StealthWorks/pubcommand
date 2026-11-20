import { orgPublicUrl } from "./guard";
import type { NavItemRow } from "./data";
import type { LoadedFunnel } from "./public";
import type { PageContext } from "./public-context";
import { ClickTracker, ViewerSync } from "./public-client";
import { NavStrip } from "./public-shell";
import { EmailOptin, FormOptin, Rich } from "./public-view";
import { HtmlFrame } from "./site-client";
import { pageHref } from "./site-data";
import { SmsSlot, smsFormFor, type SmsQuery } from "./sms-slot";

/** A custom page's body (its own URL, or the funnel's front door when it is set as the home page). */
export function CustomPageView({ loaded, ctx, item, query, orgSlug }: { loaded: LoadedFunnel; ctx: PageContext; item: NavItemRow; query: SmsQuery & { joined?: string; error?: string }; orgSlug: string }) {
  const { funnel } = loaded;
  const { base, theme } = ctx;
  const title = item.title.trim() || item.label.trim();
  const heading = title ? <h1 className="pcf-title">{title}</h1> : null;
  const back = item.isHome ? base || "/" : pageHref(funnel, base, item.slug);
  const syncUrl = loaded.preview ? null : `${base}/sync`;
  return (
    <section className="pcf-wrap pcf-day">
      {syncUrl ? <ViewerSync syncUrl={syncUrl} dayId={item.id} page="custom" /> : null}
      <ClickTracker syncUrl={syncUrl} dayId={item.id} page="custom" />
      {item.titlePlacement === "outside" ? heading : null}
      <article className="pcf-content pcf-text">
        {item.titlePlacement === "inside" ? heading : null}
        {item.contentMode === "html" ? (
          <HtmlFrame html={item.html} title={title || "Page"} textColor={theme.design.content.text ?? theme.design.page.text} linkColor={theme.design.content.link ?? theme.design.page.accent} />
        ) : (
          <Rich html={item.bodyHtml} />
        )}
      </article>
      {item.optinMode === "email" ? (
        <div className="pcf-content mt-6">
          <EmailOptin funnel={funnel} branding={theme.branding} action={`${base || `/l/${funnel.slug}`}/optin`} back={back} joined={query.joined === "1"} error={query.error} />
        </div>
      ) : item.optinMode === "sms" && smsFormFor(loaded, item.smsFormId) ? (
        <div className="mt-6">
          <SmsSlot loaded={loaded} form={smsFormFor(loaded, item.smsFormId)!} base={base} back={back} query={query} />
        </div>
      ) : item.optinMode === "form" && item.optinFormSlug ? (
        <div className="mt-6">
          <FormOptin src={orgPublicUrl(ctx.host, orgSlug, `/embed/${item.optinFormSlug}`)} headline="" />
        </div>
      ) : null}
    </section>
  );
}

export function customPageNav(loaded: LoadedFunnel, ctx: PageContext, item: NavItemRow) {
  return <NavStrip funnel={loaded.funnel} days={ctx.safeDays} states={ctx.states} navItems={loaded.navItems} base={ctx.base} carry={loaded.carry} currentPageSlug={item.slug} />;
}
