import { richToInput } from "@/features/miniblog/sanitize";
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

  return (
    <div>
      <Link href={`/mini-blog/${site.id}`} className="text-sm font-semibold text-accent">
        ← {site.name}
      </Link>
      <h1 className="mb-1 mt-1 break-words text-2xl font-semibold tracking-tight">{post.title}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {post.calendarIssueId ? <span>On the Marketing Calendar</span> : null}
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
            <Field label="Body" htmlFor="bodyHtml" hint="Plain text (blank lines make paragraphs, links are linked) or simple HTML. Sanitized on save.">
              <Textarea id="bodyHtml" name="bodyHtml" defaultValue={richToInput(post.bodyHtml)} className="min-h-64" />
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
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
            <p className="text-xs text-muted">Its Marketing Calendar issue, if any, stays on the calendar.</p>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
