import { TableScroll } from "@/components/table-scroll";
import { tenantDb } from "@pubcommand/db";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { UUID_RE, loadSiteForBrand, orgTimezone, siteBranding, statusBadge } from "@/features/miniblog/data";
import { LinkBox, Section } from "@/features/miniblog/fields";
import { miniblogAccess } from "@/features/miniblog/guard";
import { publicLinker } from "@/features/domains/public-links";
import { previewScope } from "@/features/miniblog/public";
import { PostEditorForm } from "@/features/miniblog/post-editor";
import { loadOnePostStats } from "@/features/miniblog/stats";
import { deletePost, savePost } from "@/features/miniblog/actions";
import { miniBlogPath } from "../../../../../../../../../../../modules/miniblog/paths";
import { parseAdCodes } from "../../../../../../../../../../../modules/miniblog/ads";
import { postState } from "../../../../../../../../../../../modules/miniblog/site";
import { LINK_KIND_LABEL, byKind, formatPct } from "../../../../../../../../../../../modules/miniblog/stats";
import { utcToZonedLocal, zoneLabel } from "../../../../../../../../../../../modules/miniblog/time";

const num = (value: number) => value.toLocaleString("en-US");

export default async function MiniBlogPostEditor({ params, searchParams }: { params: Promise<{ slug: string; siteId: string; postId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, siteId, postId } = await params;
  const query = await searchParams;
  const access = await miniblogAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canPublish } = access;
  const site = await loadSiteForBrand(ctx.resolved.id, ctx.brand.id, siteId);
  if (!site || !UUID_RE.test(postId)) notFound();
  const post = await tenantDb(ctx.resolved.id).textPost.findFirst({ where: { id: postId, siteId: site.id, deletedAt: null } });
  if (!post) notFound();
  const timeZone = await orgTimezone(ctx.resolved.id);
  const state = postState(post, new Date());
  const badge = statusBadge(state);
  // The Mini-Blog's custom domain when one is Active; the PubCommand address only without one.
  const links = await publicLinker({ organizationId: ctx.resolved.id, orgSlug: ctx.resolved.slug, requestHost: ctx.request.host });
  const siteUrl = links.url(miniBlogPath(site.slug)).replace(/\/(\?.*)?$/, "");
  const publicUrl = links.url(miniBlogPath(site.slug, post.slug));
  const previewUrl = links.preview(miniBlogPath(site.slug, post.slug), previewScope(site.id));
  const stats = await loadOnePostStats(ctx.resolved.id, post.id);
  const kinds = byKind(stats.links);
  const branding = siteBranding(site, ctx.brand.name, siteUrl);
  const codes = parseAdCodes(site.adCodes).map(({ id, name, network }) => ({ id, name, network }));

  const buttons = (
    <div className="flex flex-wrap gap-2">
      {canWrite ? (
        <Button type="submit" name="intent" value="save" variant="secondary">
          {state === "draft" ? "Save draft" : "Save changes"}
        </Button>
      ) : null}
      {canPublish && state === "draft" ? (
        <Button type="submit" name="intent" value="publish">
          Publish (or schedule)
        </Button>
      ) : null}
      {canPublish && state !== "draft" ? (
        <Button type="submit" name="intent" value="unpublish" variant="secondary">
          Back to draft
        </Button>
      ) : null}
    </div>
  );

  return (
    <div>
      <Link href={`/mini-blog/${site.id}`} className="text-sm font-semibold text-accent">
        ← {site.name}
      </Link>
      <h1 className="mb-1 mt-1 break-words text-2xl font-semibold tracking-tight">{post.title}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <Badge tone="accent">{site.medium}</Badge>
        {post.calendarIssueId ? (
          <Link href={`/editorial/issues/${post.calendarIssueId}`} className="font-semibold text-accent">
            On the Calendar →
          </Link>
        ) : null}
      </p>
      <Flash error={query.error} notice={query.notice} />
      <PostEditorForm
        action={savePost}
        siteId={site.id}
        postId={post.id}
        siteSlug={site.slug}
        initial={{
          title: post.title,
          slug: post.slug,
          publishAt: utcToZonedLocal(post.publishAt, timeZone),
          category: post.category ?? "",
          tickers: post.tickers ?? "",
          bodyHtml: post.bodyHtml,
          topAd: post.topAd,
          topAdText: post.topAdText ?? "",
          topAdLink: post.topAdLink ?? "",
          contentAd: post.contentAd,
          contentAdText: post.contentAdText ?? "",
          contentAdLink: post.contentAdLink ?? "",
          actionToTake: post.actionToTake ?? "",
          actionSecondary: post.actionSecondary ?? "",
          buttonText: post.buttonText ?? "",
          buttonUrl: post.buttonUrl ?? "",
        }}
        look={branding}
        logoSrc={branding.logoSrc}
        siteName={site.name}
        categories={site.postCategories}
        adCodes={codes}
        zoneLabel={zoneLabel(post.publishAt, timeZone)}
        canWrite={canWrite}
        buttons={buttons}
      />
      <div className="mt-6">
        <Section title="Stats" description="Views come from a first-party pixel; links go through a counting redirect. Unique = distinct visitors. Bots, link scanners and data-center clicks are left out; previews never count.">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Views", num(stats.views)],
              ["Unique views", num(stats.uniqueViews)],
              ["Clicks", num(stats.clicks)],
              ["Unique clickers", num(stats.uniqueClickers)],
              ["CTR", formatPct(stats.ctr)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-lg border border-line bg-white px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            {(["ad", "cta", "content"] as const).map((kind) => `${LINK_KIND_LABEL[kind]}: ${num(kinds[kind].clicks)} clicks (${num(kinds[kind].unique)} unique)`).join(" · ")}
          </p>
          {stats.links.length ? (
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
          ) : (
            <p className="text-sm text-muted">No links yet. Links are picked up when you save the post.</p>
          )}
          {stats.flagged ? <p className="text-xs text-muted">{num(stats.flagged)} automated click{stats.flagged === 1 ? "" : "s"} (bots, link scanners, cloud servers) not counted.</p> : null}
        </Section>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Section title="Links">
          <LinkBox label={state === "published" ? "Public link" : "Public link (after publishing)"} value={publicUrl} />
          <a href={previewUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
            Preview post
          </a>
        </Section>
        {canWrite ? (
          <Section title="Delete">
            <form action={deletePost}>
              <input type="hidden" name="siteId" value={site.id} />
              <input type="hidden" name="postId" value={post.id} />
              <Button type="submit" variant="danger">
                Delete post
              </Button>
            </form>
            <p className="text-xs text-muted">It goes to the Recycle bin and can be restored. Its Calendar issue is removed unless it was already Sent.</p>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
