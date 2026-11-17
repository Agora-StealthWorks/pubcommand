import { clickTotals } from "@/features/miniblog/links";
import { MiniBlogRichText } from "@/features/miniblog/rich-text";
import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { loadSiteForBrand, orgTimezone, statusBadge } from "@/features/miniblog/data";
import { miniBlogPath } from "../../../../../../../../../modules/miniblog/paths";
import { Check, ColorField, Field, LinkBox, Section, SectionTabs } from "@/features/miniblog/fields";
import { miniblogAccess, orgPublicUrl } from "@/features/miniblog/guard";
import { createPost, deleteSite, saveSite, setSiteStatus } from "@/features/miniblog/actions";
import { checkSite, postState } from "../../../../../../../../../modules/miniblog/site";
import { consentText, maskPhone } from "../../../../../../../../../modules/miniblog/sms";
import { formatZoned } from "../../../../../../../../../modules/miniblog/time";

const TABS = [
  { key: "posts", label: "Posts" },
  { key: "settings", label: "Settings" },
  { key: "subscribers", label: "Subscribers" },
] as const;

export default async function MiniBlogPage({ params, searchParams }: { params: Promise<{ slug: string; siteId: string }>; searchParams: Promise<{ tab?: string; error?: string; notice?: string }> }) {
  const { slug, siteId } = await params;
  const query = await searchParams;
  const access = await miniblogAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canPublish } = access;
  const site = await loadSiteForBrand(ctx.resolved.id, ctx.brand.id, siteId);
  if (!site) notFound();
  const db = tenantDb(ctx.resolved.id);
  const tab = query.tab === "settings" || query.tab === "subscribers" ? query.tab : "posts";
  const [timeZone, posts, optinCount, recentOptins, publications, clicks] = await Promise.all([
    orgTimezone(ctx.resolved.id),
    db.textPost.findMany({ where: { siteId: site.id, deletedAt: null }, orderBy: { publishAt: "desc" }, take: 200 }),
    db.textOptin.count({ where: { siteId: site.id } }),
    tab === "subscribers" ? db.textOptin.findMany({ where: { siteId: site.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, phone: true, createdAt: true } }) : [],
    ctx.subject.entitledModuleIds.includes("editorial") ? db.calendarPublication.findMany({ where: { brandId: ctx.brand.id, active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }) : [],
    tab === "posts" ? clickTotals(ctx.resolved.id, site.id) : new Map<string, number>(),
  ]);
  const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, miniBlogPath(site.slug));
  const badge = statusBadge(site.status);
  const checks = checkSite(site);
  const now = new Date();

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
            <span>/b/{site.slug}</span>
            <span>·</span>
            <span>{optinCount} subscribers</span>
          </p>
        </div>
        <a href={`${publicUrl}?preview=1`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
          Preview
        </a>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <SectionTabs label="Mini-Blog sections" active={tab} items={TABS.map((item) => ({ key: item.key, label: item.label, href: `/mini-blog/${site.id}?tab=${item.key}` }))} />

      {tab === "posts" ? (
        <div className="space-y-4">
          {canWrite ? (
            <form action={createPost} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end">
              <input type="hidden" name="siteId" value={site.id} />
              <Field label="New post title" htmlFor="post-title" className="flex-1">
                <Input id="post-title" name="title" required maxLength={200} />
              </Field>
              <Button type="submit">Write post</Button>
            </form>
          ) : null}
          <div className="rounded-xl border border-line bg-white">
            <TableScroll>
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Post</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Publish time</th>
                    <th className="px-4 py-2.5 text-right">Link clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => {
                    const state = statusBadge(postState(post, now));
                    return (
                      <tr key={post.id} className="border-b border-line last:border-0">
                        <td className="max-w-[340px] px-4 py-3">
                          <Link href={`/mini-blog/${site.id}/posts/${post.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-accent">
                            {post.title}
                          </Link>
                          <span className="block truncate text-xs text-muted">
                            /b/{site.slug}/{post.slug}
                            {post.calendarIssueId ? " · on the Marketing Calendar" : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={state.tone}>{state.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted">{formatZoned(post.publishAt, timeZone, { weekday: false })}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{clicks.get(post.id) ?? 0}</td>
                      </tr>
                    );
                  })}
                  {posts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted">
                        No posts yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableScroll>
          </div>
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
                  <Field label="Tagline" htmlFor="tagline" className="sm:col-span-2">
                    <Input id="tagline" name="tagline" defaultValue={site.tagline} maxLength={200} placeholder="One line about what subscribers get" />
                  </Field>
                </div>
                <Field label="Subscribe page intro" htmlFor="introHtml">
                  <MiniBlogRichText siteId={site.id} id="introHtml" name="introHtml" defaultValue={site.introHtml} minHeight={120} disabled={!canWrite} />
                </Field>
                <Check name="archivesEnabled" label="Show the archive of older posts on the home page" defaultChecked={site.archivesEnabled} />
              </Section>
              <Section title="SMS compliance" description="These fill the consent text next to the checkbox. Each opt-in stores the exact text it was shown.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Program name" htmlFor="programName">
                    <Input id="programName" name="programName" defaultValue={site.programName} maxLength={120} />
                  </Field>
                  <Field label="Company name" htmlFor="companyName">
                    <Input id="companyName" name="companyName" defaultValue={site.companyName} maxLength={120} />
                  </Field>
                  <Field label="Message frequency" htmlFor="messageFrequency" hint="e.g. “Up to 5 msgs/week”.">
                    <Input id="messageFrequency" name="messageFrequency" defaultValue={site.messageFrequency} maxLength={120} />
                  </Field>
                  <Field label="HELP contact" htmlFor="helpContact" hint="An email or phone number.">
                    <Input id="helpContact" name="helpContact" defaultValue={site.helpContact} maxLength={120} />
                  </Field>
                  <Field label="Privacy-policy link" htmlFor="privacyUrl">
                    <Input id="privacyUrl" name="privacyUrl" type="url" defaultValue={site.privacyUrl ?? ""} placeholder="https://" />
                  </Field>
                  <Field label="SMS terms link" htmlFor="termsUrl">
                    <Input id="termsUrl" name="termsUrl" type="url" defaultValue={site.termsUrl ?? ""} placeholder="https://" />
                  </Field>
                </div>
                <div className="rounded-lg bg-canvas p-3 text-xs text-muted">
                  <p className="mb-1 font-semibold text-ink">Consent text now:</p>
                  {consentText(site)}
                </div>
              </Section>
              <Section title="Look">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Logo upload" htmlFor="logo" hint={site.logoAssetId ? "A logo is uploaded. Upload another to replace it." : "PNG, JPG, WebP or GIF up to 3 MB."}>
                    <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
                  </Field>
                  <Field label="…or logo link" htmlFor="logoUrl">
                    <Input id="logoUrl" name="logoUrl" type="url" defaultValue={site.logoUrl ?? ""} placeholder="https://" />
                  </Field>
                  <Field label="Logo height (px)" htmlFor="logoHeight">
                    <Input id="logoHeight" name="logoHeight" type="number" min={16} max={120} defaultValue={site.logoHeight} />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <ColorField name="headerBg" label="Header" value={site.headerBg} />
                    <ColorField name="accentColor" label="Buttons" value={site.accentColor} />
                  </div>
                </div>
                {site.logoAssetId ? <Check name="removeLogo" label="Remove the uploaded logo" defaultChecked={false} /> : null}
              </Section>
              <Section title="Connections">
                <Field
                  label="Marketing Calendar publication"
                  htmlFor="calendarCode"
                  hint={publications.length ? "Each published or scheduled post adds one issue under this publication." : "No Marketing Calendar publications for this brand (or the calendar is off)."}
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
                <Check name="brainSyncEnabled" label="Teach the brand Brain about published posts" defaultChecked={site.brainSyncEnabled} hint="Post text and aggregate counts only. Never phone numbers." />
              </Section>
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
            {canPublish ? (
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
          {canPublish ? (
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
            </Section>
          ) : null}
        </div>
      ) : null}

      {tab === "subscribers" ? (
        <div className="space-y-4">
          <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            No SMS provider is connected, so nothing is sent from here. Export the opt-ins (each with its consent text, time and page) to load into your SMS platform.
          </p>
          <Section title={`${optinCount} opt-ins`} description="Numbers are masked here; the full list is in the export.">
            {canPublish ? (
              <a href={`/mini-blog/${site.id}/optins`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
                Download opt-ins (CSV)
              </a>
            ) : (
              <p className="text-sm text-muted">Exporting needs the miniblog.publish permission.</p>
            )}
            <ul className="divide-y divide-line text-sm">
              {recentOptins.map((optin) => (
                <li key={optin.id} className="flex justify-between gap-3 py-2">
                  <span className="font-mono">{maskPhone(optin.phone)}</span>
                  <span className="text-muted">{formatZoned(optin.createdAt, timeZone, { weekday: false })}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}
    </div>
  );
}
