import { MiniBlogRichText } from "@/features/miniblog/rich-text";
import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { agentLabels } from "@/features/agents/data";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { loadMediums, loadSiteForBrand, orgTimezone, siteBranding, statusBadge } from "@/features/miniblog/data";
import { Check, Field, LinkBox, Section, SectionTabs } from "@/features/miniblog/fields";
import { LookEditor } from "@/features/miniblog/look-editor";
import { miniblogAccess } from "@/features/miniblog/guard";
import { publicLinker } from "@/features/domains/public-links";
import { previewScope } from "@/features/miniblog/public";
import { sanitizeRich } from "@/features/miniblog/sanitize";
import { loadPostStats, loadSiteTotals } from "@/features/miniblog/stats";
import { createPost, deleteSite, restorePost, saveAdCodes, saveSite, setSiteStatus } from "@/features/miniblog/actions";
import { miniBlogPath } from "../../../../../../../../../modules/miniblog/paths";
import { AD_NETWORKS, CONTENT_AD_SHORTCODE, networkLabel, parseAdCodes } from "../../../../../../../../../modules/miniblog/ads";
import { mediumOptions, subscribeKind } from "../../../../../../../../../modules/miniblog/mediums";
import { checkSite, postState } from "../../../../../../../../../modules/miniblog/site";
import { LINK_KIND_LABEL, formatPct, type PostStats } from "../../../../../../../../../modules/miniblog/stats";
import { emailConsentText, maskEmail, maskPhone } from "../../../../../../../../../modules/miniblog/sms";
import { formatZoned, formatZonedDate } from "../../../../../../../../../modules/miniblog/time";

const TABS = [
  { key: "posts", label: "Posts" },
  { key: "stats", label: "Stats" },
  { key: "settings", label: "Settings" },
  { key: "ads", label: "Ads" },
  { key: "subscribers", label: "Subscribers" },
  { key: "trash", label: "Recycle bin" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const num = (value: number) => value.toLocaleString("en-US");

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-white px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function LinkTable({ stats }: { stats: PostStats }) {
  if (!stats.links.length) return <p className="text-sm text-muted">No links yet.</p>;
  return (
    <TableScroll>
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="w-20 py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Link</th>
            <th className="w-16 py-2 text-right">Clicks</th>
            <th className="w-16 py-2 text-right">Unique</th>
            <th className="w-16 py-2 text-right">CTR</th>
          </tr>
        </thead>
        <tbody>
          {stats.links.map((link) => (
            <tr key={link.id} className="border-b border-line last:border-0">
              <td className="py-2 pr-3">
                <Badge tone={link.kind === "ad" ? "accent" : link.kind === "cta" ? "ok" : "neutral"}>{LINK_KIND_LABEL[link.kind]}</Badge>
              </td>
              <td className="max-w-[360px] py-2 pr-3">
                <span className="block truncate font-semibold">{link.label || link.url}</span>
                <span className="block truncate font-mono text-xs text-muted">{link.url}</span>
              </td>
              <td className="py-2 text-right tabular-nums">{num(link.clicks)}</td>
              <td className="py-2 text-right tabular-nums">{num(link.unique)}</td>
              <td className="py-2 text-right tabular-nums">{formatPct(link.ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export default async function MiniBlogPage({ params, searchParams }: { params: Promise<{ slug: string; siteId: string }>; searchParams: Promise<{ tab?: string; cat?: string; edit?: string; error?: string; notice?: string }> }) {
  const { slug, siteId } = await params;
  const query = await searchParams;
  const access = await miniblogAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canManage } = access;
  const site = await loadSiteForBrand(ctx.resolved.id, ctx.brand.id, siteId);
  if (!site) notFound();
  const db = tenantDb(ctx.resolved.id);
  const tab: Tab = TABS.some((item) => item.key === query.tab) ? (query.tab as Tab) : "posts";
  const editorial = ctx.subject.entitledModuleIds.includes("editorial");
  const [timeZone, posts, optinCount, recentOptins, publications, agents, mediums, deletedPosts] = await Promise.all([
    orgTimezone(ctx.resolved.id),
    db.textPost.findMany({ where: { siteId: site.id, deletedAt: null }, orderBy: { publishAt: "desc" }, take: 200 }),
    db.textOptin.count({ where: { siteId: site.id } }),
    tab === "subscribers" ? db.textOptin.findMany({ where: { siteId: site.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, channel: true, phone: true, email: true, createdAt: true } }) : [],
    editorial ? db.calendarPublication.findMany({ where: { brandId: ctx.brand.id, active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }) : [],
    agentLabels(ctx.resolved.id),
    loadMediums(ctx.resolved.id),
    tab === "trash" ? db.textPost.findMany({ where: { siteId: site.id, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, take: 100 }) : [],
  ]);
  const stats = tab === "posts" || tab === "stats" ? await loadPostStats(ctx.resolved.id, posts.map((post) => post.id)) : new Map<string, PostStats>();
  const totals = tab === "stats" ? await loadSiteTotals(ctx.resolved.id, site.id) : null;
  // The Mini-Blog's custom domain when one is Active (Settings → Domains); the PubCommand address only without one.
  const links = await publicLinker({ organizationId: ctx.resolved.id, orgSlug: ctx.resolved.slug, requestHost: ctx.request.host });
  const publicUrl = links.url(miniBlogPath(site.slug));
  const previewUrl = links.preview(miniBlogPath(site.slug), previewScope(site.id));
  const badge = statusBadge(site.status);
  const checks = checkSite(site);
  const now = new Date();
  const kind = subscribeKind(site.medium);
  const codes = parseAdCodes(site.adCodes);
  const categoryFilter = query.cat ?? "";
  const shownPosts = posts.filter((post) => (categoryFilter === "" ? true : categoryFilter === "__none" ? !post.category : post.category === categoryFilter));
  const branding = siteBranding(site, ctx.brand.name, publicUrl.replace(/\/(\?.*)?$/, ""));
  const latest = posts[0];
  const editing = codes.find((code) => code.id === query.edit) ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/mini-blog" className="text-sm font-semibold text-accent">
            ← Mini-Blogs
          </Link>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{site.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <Badge tone="accent">{site.medium}</Badge>
            <span>/b/{site.slug}</span>
            <span>·</span>
            <span>{optinCount} subscribers</span>
          </p>
        </div>
        <a href={previewUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
          Preview
        </a>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <SectionTabs label="Mini-Blog sections" active={tab} items={TABS.map((item) => ({ key: item.key, label: item.label, href: `/mini-blog/${site.id}?tab=${item.key}` }))} />

      {tab === "posts" ? (
        <div className="space-y-4">
          {editorial && !site.calendarCode ? (
            <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
              Posts are not going on the Calendar yet. <Link href={`/mini-blog/${site.id}?tab=settings#connections`} className="font-semibold underline">Pick a Calendar publication</Link> in Settings.
            </p>
          ) : null}
          {canWrite ? (
            <form action={createPost} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end">
              <input type="hidden" name="siteId" value={site.id} />
              <Field label="New post title" htmlFor="post-title" className="flex-1">
                <Input id="post-title" name="title" required maxLength={200} />
              </Field>
              <Button type="submit">Write post</Button>
            </form>
          ) : null}
          {site.postCategories.length ? (
            <nav className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Filter by category">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Category</span>
              {[{ key: "", label: "All" }, ...site.postCategories.map((category) => ({ key: category, label: category })), { key: "__none", label: "Uncategorized" }].map((item) => (
                <Link
                  key={item.key || "all"}
                  href={`/mini-blog/${site.id}?tab=posts${item.key ? `&cat=${encodeURIComponent(item.key)}` : ""}`}
                  aria-current={categoryFilter === item.key ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 font-semibold ${categoryFilter === item.key ? "border-accent bg-[#eef2ff] text-[#1e3a8a]" : "border-line bg-white hover:bg-canvas"}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <div className="rounded-xl border border-line bg-white">
            <TableScroll>
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Post</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Publish time</th>
                    <th className="px-3 py-2.5 text-right">Views</th>
                    <th className="px-3 py-2.5 text-right">Unique</th>
                    <th className="px-3 py-2.5 text-right">Clicks</th>
                    <th className="px-3 py-2.5 text-right">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {shownPosts.map((post) => {
                    const state = statusBadge(postState(post, now));
                    const s = stats.get(post.id);
                    return (
                      <tr key={post.id} className="border-b border-line last:border-0">
                        <td className="max-w-[340px] px-4 py-3">
                          <Link href={`/mini-blog/${site.id}/posts/${post.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-accent">
                            {post.title}
                          </Link>
                          <span className="block truncate text-xs text-muted">
                            /b/{site.slug}/{post.slug}
                            {post.calendarIssueId ? " · on the Calendar" : ""}
                          </span>
                          {post.category ? <span className="mr-1 mt-1 inline-flex items-center rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-ink">{post.category}</span> : null}
                          {/* Internal only: posts an AI agent wrote, and posts waiting in AI Agents → Approvals. */}
                          {post.createdById && agents.has(post.createdById) ? (
                            <span className="mt-1 inline-flex items-center rounded-full bg-[#dbe7ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]" title={agents.get(post.createdById)!.name}>
                              AI · {agents.get(post.createdById)!.platformLabel}
                            </span>
                          ) : null}
                          {post.status === "pending" ? (
                            <Link href="/agents/approvals" className="ml-1 mt-1 inline-flex items-center rounded-full bg-[#fef0c7] px-2 py-0.5 text-xs font-semibold text-[#b54708]">
                              Waiting for approval
                            </Link>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={state.tone}>{state.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted">{formatZoned(post.publishAt, timeZone, { weekday: false })}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{num(s?.views ?? 0)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{num(s?.uniqueViews ?? 0)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{num(s?.clicks ?? 0)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatPct(s?.ctr ?? null)}</td>
                      </tr>
                    );
                  })}
                  {shownPosts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted">
                        {posts.length ? "No posts in this category." : "No posts yet."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableScroll>
          </div>
          <p className="text-xs text-muted">Unique = distinct visitors (an anonymous first-party cookie). CTR = unique clickers ÷ unique views. Bot and data-center clicks are left out.</p>
        </div>
      ) : null}

      {tab === "stats" && totals ? (
        <div className="space-y-4">
          <Section title="This Mini-Blog" description="Every page: home, posts and the subscribe page. Bots, link scanners and data-center clicks are left out; previews never count.">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Page views" value={num(totals.views)} />
              <StatTile label="Unique views" value={num(totals.uniqueViews)} />
              <StatTile label="Link clicks" value={num(totals.clicks)} />
              <StatTile label="Unique clickers" value={num(totals.uniqueClickers)} />
              <StatTile label="CTR" value={formatPct(totals.ctr)} />
              <StatTile label="Subscribers" value={num(totals.subscribers)} />
            </dl>
          </Section>
          {posts.map((post) => {
            const s = stats.get(post.id);
            if (!s) return null;
            return (
              <Section key={post.id} title={post.title} description={`${formatZonedDate(post.publishAt, timeZone)} · ${num(s.views)} views · ${num(s.uniqueViews)} unique · ${num(s.uniqueClickers)} unique clickers · CTR ${formatPct(s.ctr)}${s.flagged ? ` · ${num(s.flagged)} automated clicks left out` : ""}`}>
                <LinkTable stats={s} />
                <Link href={`/mini-blog/${site.id}/posts/${post.id}`} className="text-sm font-semibold text-accent">
                  Open the post →
                </Link>
              </Section>
            );
          })}
          {posts.length === 0 ? <p className="text-sm text-muted">No posts yet.</p> : null}
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="space-y-4">
          <form action={saveSite} encType="multipart/form-data" className="space-y-4">
            <input type="hidden" name="siteId" value={site.id} />
            <fieldset disabled={!canWrite} className="space-y-4">
              <Section title="Mini-Blog">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" htmlFor="name">
                    <Input id="name" name="name" defaultValue={site.name} maxLength={120} required />
                  </Field>
                  <Field label="Link name" htmlFor="slug" hint={`Public link: /b/${site.slug} (old /t/${site.slug} links keep working)`}>
                    <Input id="slug" name="slug" defaultValue={site.slug} maxLength={60} required pattern="[a-z0-9-]+" />
                  </Field>
                  <Field
                    label="Medium"
                    htmlFor="medium"
                    hint={
                      <>
                        How readers get it. Email Mini-Blogs show an email sign-up; every other medium, SMS included, has no sign-up form. It is also the issue type on the Calendar.{" "}
                        {canManage ? (
                          <Link href="/mini-blog/settings" className="font-semibold text-accent">
                            Edit the list
                          </Link>
                        ) : null}
                      </>
                    }
                  >
                    <select id="medium" name="medium" defaultValue={site.medium} className="pc-control w-full text-sm">
                      {mediumOptions(mediums, site.medium).map((medium) => (
                        <option key={medium} value={medium}>
                          {medium}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tagline" htmlFor="tagline">
                    <Input id="tagline" name="tagline" defaultValue={site.tagline} maxLength={200} placeholder="One line about what subscribers get" />
                  </Field>
                </div>
                {kind !== "none" ? (
                  <Field label="Subscribe page intro" htmlFor="introHtml">
                    <MiniBlogRichText siteId={site.id} id="introHtml" name="introHtml" defaultValue={site.introHtml} minHeight={120} disabled={!canWrite} />
                  </Field>
                ) : (
                  <input type="hidden" name="introHtml" value={site.introHtml} />
                )}
                <Check name="archivesEnabled" label="Show the archive of older posts (“View Archives” in the T-Letter footer)" defaultChecked={site.archivesEnabled} />
                <Field label="Post categories (internal)" htmlFor="postCategories" hint="One per line, e.g. “Ticker Tuesday”. Tag posts with them and filter the post list. Never shown publicly.">
                  <Textarea id="postCategories" name="postCategories" defaultValue={site.postCategories.join("\n")} className="min-h-20" />
                </Field>
              </Section>
              <Section title="Footer and legal" description="Shown in the footer of every page.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name" htmlFor="companyName">
                    <Input id="companyName" name="companyName" defaultValue={site.companyName} maxLength={120} />
                  </Field>
                  <Field label="Privacy-policy link" htmlFor="privacyUrl" hint={kind === "email" ? "Required: it is shown on the email sign-up form." : undefined}>
                    <Input id="privacyUrl" name="privacyUrl" type="url" defaultValue={site.privacyUrl ?? ""} placeholder="https://" />
                  </Field>
                  <Field label="Terms link (optional)" htmlFor="termsUrl">
                    <Input id="termsUrl" name="termsUrl" type="url" defaultValue={site.termsUrl ?? ""} placeholder="https://" />
                  </Field>
                </div>
                <input type="hidden" name="helpContact" value={site.helpContact} />
              </Section>
              {kind === "email" ? (
                <Section title="Email sign-up" description="These fill the consent text on the email sign-up form. Each opt-in stores the exact text it was shown.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Newsletter name" htmlFor="programName">
                      <Input id="programName" name="programName" defaultValue={site.programName} maxLength={120} />
                    </Field>
                    <Field label="Message frequency" htmlFor="messageFrequency" hint="e.g. “Every weekday morning”.">
                      <Input id="messageFrequency" name="messageFrequency" defaultValue={site.messageFrequency} maxLength={120} />
                    </Field>
                  </div>
                  <div className="rounded-lg bg-canvas p-3 text-xs text-muted">
                    <p className="mb-1 font-semibold text-ink">Consent text now:</p>
                    {emailConsentText(site)}
                  </div>
                </Section>
              ) : (
                <>
                  <input type="hidden" name="programName" value={site.programName} />
                  <input type="hidden" name="messageFrequency" value={site.messageFrequency} />
                  <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">
                    {site.medium} Mini-Blogs have no sign-up form. Readers reach posts by link; only Email Mini-Blogs collect sign-ups (there is no SMS sign-up).
                  </p>
                </>
              )}
              <Section title="Look" description="Pick a theme, then make it yours. The preview shows the page as visitors will see it.">
                <Check
                  name="followBrand"
                  label="Use the brand look"
                  defaultChecked={site.followBrand}
                  hint={`Header and link colors and the logo come from ${ctx.brand.name}'s branding (Settings → Brands) and update when it changes. The theme, logo size, button color and page background stay yours.`}
                />
                <LookEditor
                  initial={{ theme: site.theme, headerBg: branding.headerBg, accentColor: branding.accentColor, logoHeight: branding.logoHeight, pageBg: site.pageBg, buttonColor: site.buttonColor }}
                  logoSrc={branding.logoSrc}
                  siteName={site.name}
                  companyName={branding.companyName}
                  followBrand={site.followBrand}
                  disabled={!canWrite}
                  sample={
                    latest
                      ? { title: latest.title, date: formatZonedDate(latest.publishAt, timeZone), bodyHtml: sanitizeRich(latest.bodyHtml).replace(/\[\s*content[\s_-]*ad\s*\]/gi, ""), actionToTake: latest.actionToTake, actionSecondary: latest.actionSecondary, buttonText: latest.buttonText }
                      : null
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Logo upload" htmlFor="logo" hint={site.logoAssetId ? "A logo is uploaded. Upload another to replace it." : "PNG, JPG, WebP or GIF up to 3 MB."}>
                    <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
                  </Field>
                  <Field label="…or logo link" htmlFor="logoUrl">
                    <Input id="logoUrl" name="logoUrl" type="url" defaultValue={site.logoUrl ?? ""} placeholder="https://" />
                  </Field>
                </div>
                {site.logoAssetId ? <Check name="removeLogo" label="Remove the uploaded logo" defaultChecked={false} /> : null}
              </Section>
              <div id="connections">
                <Section title="Connections">
                  <Field
                    label="Calendar publication"
                    htmlFor="calendarCode"
                    hint={publications.length ? `Every post becomes one issue under this publication on its publish date, with “${site.medium}” as the issue type and its views, clicks and CTR on the issue.` : "No Calendar publications for this brand (or the calendar is off)."}
                  >
                    <select id="calendarCode" name="calendarCode" defaultValue={site.calendarCode ?? ""} className="pc-control w-full text-sm">
                      <option value="">Don't add posts to the calendar</option>
                      {publications.map((publication) => (
                        <option key={publication.code} value={publication.code}>
                          {publication.code} · {publication.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Check name="brainSyncEnabled" label="Teach the brand Brain about published posts" defaultChecked={site.brainSyncEnabled} hint="Post text and aggregate counts only. Never phone numbers or email addresses." />
                </Section>
              </div>
              {canWrite ? <Button type="submit">Save Mini-Blog</Button> : null}
            </fieldset>
          </form>
          <Section title="Go live" description="Errors block going live.">
            <LinkBox label="Public link" value={publicUrl} />
            {checks.errors.length ? (
              <ul className="space-y-1 text-sm text-[#912018]">
                {checks.errors.map((error) => (
                  <li key={error}>✕ {error}</li>
                ))}
              </ul>
            ) : null}
            {checks.warnings.length ? (
              <ul className="space-y-1 text-sm text-[#93370d]">
                {checks.warnings.map((warning) => (
                  <li key={warning}>! {warning}</li>
                ))}
              </ul>
            ) : null}
            {canManage ? (
              <form action={setSiteStatus}>
                <input type="hidden" name="siteId" value={site.id} />
                {site.status === "live" ? (
                  <Button type="submit" name="intent" value="draft" variant="secondary">
                    Take offline
                  </Button>
                ) : (
                  <Button type="submit" name="intent" value="live" disabled={checks.errors.length > 0}>
                    Go live
                  </Button>
                )}
              </form>
            ) : null}
          </Section>
          {canManage ? (
            <Section title="Delete">
              <form action={deleteSite} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="siteId" value={site.id} />
                <Field label={`Type “${site.name}” to delete`} htmlFor="confirm">
                  <Input id="confirm" name="confirm" autoComplete="off" />
                </Field>
                <Button type="submit" variant="danger" className="mb-0.5">
                  Delete Mini-Blog
                </Button>
              </form>
              <p className="text-xs text-muted">A deleted Mini-Blog can be restored from the Recycle bin on the Mini-Blogs page.</p>
            </Section>
          ) : null}
        </div>
      ) : null}

      {tab === "ads" ? (
        <div className="space-y-4">
          <Section title="Ad codes" description={`Paste the code each ad network gives you (AdSense, Taboola, Kevel or any HTML snippet). Every post then picks what fills its top ad and its ${CONTENT_AD_SHORTCODE} spot: no ad, a text ad, or one of these codes.`}>
            {codes.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {codes.map((code) => (
                  <li key={code.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold [overflow-wrap:anywhere]">{code.name}</span>
                      <span className="block text-xs text-muted">
                        {networkLabel(code.network)} · {num(code.code.length)} characters · used by {posts.filter((post) => post.topAd === `code:${code.id}` || post.contentAd === `code:${code.id}`).length} post(s)
                      </span>
                    </span>
                    {canManage ? (
                      <span className="flex gap-2">
                        <Link href={`/mini-blog/${site.id}?tab=ads&edit=${code.id}`} className="inline-flex min-h-9 items-center rounded-md border border-line bg-white px-3 font-semibold hover:bg-canvas">
                          Edit
                        </Link>
                        <form action={saveAdCodes}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <Button type="submit" name="intent" value={`delete:${code.id}`} variant="secondary">
                            Remove
                          </Button>
                        </form>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No ad codes yet. Text ads need none: pick “Text ad” on a post.</p>
            )}
          </Section>
          {canManage ? (
            <Section title={editing ? `Edit “${editing.name}”` : "Add an ad code"} description="The code runs as-is on this Mini-Blog's public pages (never in the editor preview). Only paste code from your ad network.">
              <form action={saveAdCodes} className="space-y-4">
                <input type="hidden" name="siteId" value={site.id} />
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" htmlFor="ad-name" hint="Writers pick it by this name, e.g. “AdSense leaderboard”.">
                    <Input id="ad-name" name="name" defaultValue={editing?.name ?? ""} maxLength={80} required />
                  </Field>
                  <Field label="Network" htmlFor="ad-network">
                    <select id="ad-network" name="network" defaultValue={editing?.network ?? "adsense"} className="pc-control w-full text-sm">
                      {AD_NETWORKS.map((network) => (
                        <option key={network.id} value={network.id}>
                          {network.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Code" htmlFor="ad-code" hint="The full snippet, including any <script> tags.">
                  <Textarea id="ad-code" name="code" defaultValue={editing?.code ?? ""} className="min-h-40 font-mono text-xs" required spellCheck={false} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">{editing ? "Save ad code" : "Add ad code"}</Button>
                  {editing ? (
                    <Link href={`/mini-blog/${site.id}?tab=ads`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
                      Cancel
                    </Link>
                  ) : null}
                </div>
              </form>
            </Section>
          ) : (
            <p className="text-sm text-muted">Adding and editing ad codes needs the miniblog.manage permission (admins).</p>
          )}
        </div>
      ) : null}

      {tab === "subscribers" ? (
        <div className="space-y-4">
          <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            Nothing is sent from here. Export the opt-ins (each with its consent text, time and page) to load into your email platform. SMS opt-ins listed here were collected before SMS sign-up was removed; none are collected now.
          </p>
          <Section title={`${optinCount} opt-ins`} description="Numbers and addresses are masked here; the full list is in the export.">
            {canManage ? (
              <a href={`/mini-blog/${site.id}/optins`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
                Download opt-ins (CSV)
              </a>
            ) : (
              <p className="text-sm text-muted">Exporting needs the miniblog.manage permission.</p>
            )}
            <ul className="divide-y divide-line text-sm">
              {recentOptins.map((optin) => (
                <li key={optin.id} className="flex justify-between gap-3 py-2">
                  <span className="font-mono">
                    {optin.channel === "email" && optin.email ? maskEmail(optin.email) : optin.phone ? maskPhone(optin.phone) : "—"}
                    <span className="ml-2 font-sans text-xs uppercase text-muted">{optin.channel}</span>
                  </span>
                  <span className="text-muted">{formatZoned(optin.createdAt, timeZone, { weekday: false })}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}

      {tab === "trash" ? (
        <Section title="Recycle bin" description="Deleted posts stay here and can be restored. A restored post keeps its stats and goes back on the Calendar.">
          {deletedPosts.length ? (
            <ul className="divide-y divide-line text-sm">
              {deletedPosts.map((post) => (
                <li key={post.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-semibold [overflow-wrap:anywhere]">{post.title}</span>
                    <span className="block text-xs text-muted">Deleted {formatZoned(post.deletedAt, timeZone, { weekday: false })}</span>
                  </span>
                  {canWrite ? (
                    <form action={restorePost}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <input type="hidden" name="postId" value={post.id} />
                      <Button type="submit" variant="secondary">
                        Restore
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">The Recycle bin is empty.</p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
