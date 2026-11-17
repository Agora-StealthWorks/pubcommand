import { postLinkStats } from "@/features/miniblog/links";
import { MiniBlogRichText } from "@/features/miniblog/rich-text";
import { TableScroll } from "@/components/table-scroll";
import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { UUID_RE, loadSiteForBrand, orgTimezone, statusBadge } from "@/features/miniblog/data";
import { Field, LinkBox, Section } from "@/features/miniblog/fields";
import { miniblogAccess, orgPublicUrl } from "@/features/miniblog/guard";
import { deletePost, savePost } from "@/features/miniblog/actions";
import { miniBlogPath } from "../../../../../../../../../../../modules/miniblog/paths";
import { postState } from "../../../../../../../../../../../modules/miniblog/site";
import { utcToZonedLocal, zoneLabel } from "../../../../../../../../../../../modules/miniblog/time";

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
  const publicUrl = orgPublicUrl(ctx.request.host, ctx.resolved.slug, miniBlogPath(site.slug, post.slug));
  const links = await postLinkStats(ctx.resolved.id, post.id);
  const flagged = links.reduce((sum, link) => sum + link.flagged, 0);

  return (
    <div>
      <Link href={`/mini-blog/${site.id}`} className="text-sm font-semibold text-accent">
        ← {site.name}
      </Link>
      <h1 className="mb-1 mt-1 break-words text-2xl font-semibold tracking-tight">{post.title}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {post.calendarIssueId ? <span>On the Calendar</span> : null}
      </p>
      <Flash error={query.error} notice={query.notice} />
      <form action={savePost} className="space-y-4">
        <input type="hidden" name="siteId" value={site.id} />
        <input type="hidden" name="postId" value={post.id} />
        <fieldset disabled={!canWrite} className="space-y-4">
          <Section title="Post">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="title" className="sm:col-span-2">
                <Input id="title" name="title" defaultValue={post.title} maxLength={200} required />
              </Field>
              <Field label="Link name" htmlFor="slug" hint={`/b/${site.slug}/${post.slug}`}>
                <Input id="slug" name="slug" defaultValue={post.slug} maxLength={80} pattern="[a-z0-9-]+" />
              </Field>
              <Field label={`Publish time (${zoneLabel(post.publishAt, timeZone)})`} htmlFor="publishAt" hint="A future time schedules the post; it stays hidden until then.">
                <Input id="publishAt" name="publishAt" type="datetime-local" defaultValue={utcToZonedLocal(post.publishAt, timeZone)} required />
              </Field>
            </div>
            <Field label="Body" htmlFor="bodyHtml" hint="Links are tracked: each one counts clicks for this post (see Link clicks below). Sanitized on save.">
              <MiniBlogRichText siteId={site.id} id="bodyHtml" name="bodyHtml" defaultValue={post.bodyHtml} disabled={!canWrite} />
            </Field>
            <Field label="Action to take" htmlFor="actionToTake" hint="Optional highlighted box under the post.">
              <Textarea id="actionToTake" name="actionToTake" defaultValue={post.actionToTake ?? ""} className="min-h-16" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button text" htmlFor="buttonText" hint="Shown only with a link.">
                <Input id="buttonText" name="buttonText" defaultValue={post.buttonText ?? ""} maxLength={60} />
              </Field>
              <Field label="Button link" htmlFor="buttonUrl">
                <Input id="buttonUrl" name="buttonUrl" type="url" defaultValue={post.buttonUrl ?? ""} placeholder="https://" />
              </Field>
            </div>
          </Section>
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
        </fieldset>
      </form>
      <div className="mt-6">
        <Section title="Link clicks" description="Every link in the post (and its button) goes through a counting redirect. Clicks from bots, link scanners and cloud servers are left out.">
          {links.length ? (
            <TableScroll>
              <table className="w-full table-fixed text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2 pr-3">Link</th>
                    <th className="w-20 py-2 text-right">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3">
                        <span className="block truncate font-semibold">{link.label || link.url}</span>
                        <span className="block truncate font-mono text-xs text-muted">{link.url}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{link.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <p className="text-sm text-muted">No links yet. Links are picked up when you save the post.</p>
          )}
          {flagged ? <p className="text-xs text-muted">{flagged} automated click{flagged === 1 ? "" : "s"} (bots, link scanners, cloud servers) not counted.</p> : null}
        </Section>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Section title="Links">
          <LinkBox label={state === "published" ? "Public link" : "Public link (after publishing)"} value={publicUrl} />
          <a href={`${publicUrl}?preview=1`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
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
            <p className="text-xs text-muted">Its Calendar issue, if any, stays on the calendar.</p>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
