import { tenantDb } from "@pubcommand/db";
import { websiteLinks } from "./links";
import { Input, Label, Textarea } from "@pubcommand/ui";
import { groupByFunnel } from "../../../../../modules/pubsetup/groups";
import { utcToZonedLocal } from "../../../../../modules/miniblog/time";
import { ACCESS_LEVELS, CONTENT_TYPES, effectiveStatus, readingMinutes } from "../../../../../modules/websites/content";
import { savePost, trashPost } from "./actions";
import { PostStatusBadge, formatDate } from "./admin-ui";
import { orgTimezone, siteEditors, siteMedia, sitePublications, siteTerms, type PostRow, type SiteRow } from "./data";
import { WebsiteRichText } from "./rich-text";

function Box({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white">
      <h2 className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm font-semibold">
        {title}
        {aside}
      </h2>
      <div className="space-y-3 p-4 text-sm">{children}</div>
    </section>
  );
}

const btn = "inline-flex min-h-11 items-center justify-center rounded-md border px-3.5 text-sm font-semibold";

/** The post/page editor: title, WYSIWYG body, and a WordPress-style sidebar. */
export async function PostEditor({ organizationId, brandId, site, post, kind, canPublish, canWrite }: { organizationId: string; brandId: string; site: SiteRow; post: PostRow | null; kind: "post" | "page"; canPublish: boolean; canWrite: boolean }) {
  const links = await websiteLinks(site);
  const now = new Date();
  const [pubs, editors, terms, media, timeZone, postTerms] = await Promise.all([
    sitePublications(organizationId, brandId),
    siteEditors(organizationId, brandId),
    siteTerms(organizationId, site.id),
    siteMedia(organizationId, site.id, 60),
    orgTimezone(organizationId),
    post ? tenantDb(organizationId).webPostTerm.findMany({ where: { postId: post.id }, select: { termId: true } }) : Promise.resolve([]),
  ]);
  const chosen = new Set(postTerms.map((row) => row.termId));
  const tags = terms.tags.filter((tag) => chosen.has(tag.id)).map((tag) => tag.name);
  const status = post ? effectiveStatus(post, now) : "draft";
  const live = status === "published" || status === "scheduled";
  const images = media.filter((item) => item.mimeType.startsWith("image/"));
  const groups = groupByFunnel(pubs.all);
  const readonly = !canWrite || (live && !canPublish);
  return (
    <form action={savePost} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <input type="hidden" name="siteId" value={site.id} />
      <input type="hidden" name="kind" value={kind} />
      {post ? <input type="hidden" name="postId" value={post.id} /> : null}
      <div className="min-w-0 space-y-4">
        <div>
          <label htmlFor="post-title" className="sr-only">
            Title
          </label>
          <textarea
            id="post-title"
            name="title"
            defaultValue={post?.title ?? ""}
            placeholder="Add title"
            maxLength={300}
            required
            rows={2}
            className="block w-full resize-y rounded-lg border border-line bg-white px-4 py-3 font-serif text-2xl font-bold leading-tight text-[#10213a] sm:text-3xl"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Address: /w/{site.slug}/</span>
            <input name="slug" defaultValue={post?.slug ?? ""} placeholder="made-from-the-title" aria-label="Address (slug)" className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-xs sm:max-w-[320px]" />
            {post ? (
              <a href={links.preview(post.slug)} target="_blank" rel="noreferrer" className="font-semibold text-accent">
                {status === "published" ? "View ↗" : "Preview ↗"}
              </a>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-white">
          <WebsiteRichText siteId={site.id} defaultValue={post?.bodyHtml ?? ""} />
        </div>
        <Box title="Excerpt">
          <Textarea name="excerpt" defaultValue={post?.excerpt ?? ""} rows={2} maxLength={600} placeholder="Shown on cards and in search results. Left empty, the first lines of the post are used." />
        </Box>
        <Box title="Search engines (SEO)">
          <div>
            <Label htmlFor="seo-title">SEO title</Label>
            <Input id="seo-title" name="seoTitle" defaultValue={post?.seoTitle ?? ""} maxLength={120} placeholder="Defaults to the post title" />
          </div>
          <div>
            <Label htmlFor="seo-desc">Meta description</Label>
            <Textarea id="seo-desc" name="seoDescription" defaultValue={post?.seoDescription ?? ""} rows={2} maxLength={300} placeholder="Defaults to the excerpt" />
          </div>
          {post ? <p className="text-xs text-muted">About {readingMinutes(post.bodyHtml)} min read.</p> : null}
        </Box>
      </div>

      <aside className="space-y-4">
        <Box title="Publish" aside={post ? <PostStatusBadge post={post} now={now} /> : null}>
          <div>
            <Label htmlFor="publish-at">Publish on ({timeZone.replace("_", " ")})</Label>
            <Input id="publish-at" name="publishAt" type="datetime-local" defaultValue={utcToZonedLocal(post?.publishedAt ?? null, timeZone)} />
            <p className="mt-1 text-xs text-muted">Leave empty to publish now. A future time schedules it.</p>
          </div>
          {post?.publishedAt && live ? <p className="text-xs text-muted">{status === "scheduled" ? "Goes live" : "Went live"} {formatDate(post.publishedAt, timeZone, true)}</p> : null}
          {readonly ? (
            <p className="rounded-md bg-[#fffaeb] px-3 py-2 text-xs text-[#93370d]">{canWrite ? "This is live. Only editors with publish rights can change it." : "You can read this but not change it."}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button name="intent" value={live ? "save" : "draft"} className={`${btn} border-line bg-white`}>
                {live ? "Update" : "Save draft"}
              </button>
              {canPublish ? (
                <button name="intent" value="publish" className={`${btn} border-accent bg-accent text-white`}>
                  {live ? "Update & publish" : "Publish / schedule"}
                </button>
              ) : (
                <button name="intent" value="pending" className={`${btn} border-accent bg-accent text-white`}>
                  Submit for review
                </button>
              )}
              {live && canPublish ? (
                <button name="intent" value="unpublish" className={`${btn} col-span-2 border-line bg-white text-[#b42318]`}>
                  Unpublish (back to draft)
                </button>
              ) : null}
            </div>
          )}
        </Box>

        {kind === "post" ? (
          <Box title="Publication" aside={<span className="rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-semibold text-[#067647]">Publication Setup</span>}>
            <select name="publicationId" defaultValue={post?.publicationId ?? ""} className="pc-control w-full" aria-label="Publication">
              <option value="">Site-wide (no publication)</option>
              {groups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.items.map((pub) => (
                    <option key={pub.id} value={pub.id}>
                      {pub.name}
                      {pub.code ? ` (${pub.code})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div>
              <Label htmlFor="content-type">Content type</Label>
              <select id="content-type" name="contentType" defaultValue={post?.contentType ?? "article"} className="pc-control w-full">
                {CONTENT_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            {pubs.all.length === 0 ? <p className="text-xs text-muted">No publications yet. Add them in Publication Setup and they appear here.</p> : null}
          </Box>
        ) : null}

        <Box title="Who can read this">
          {ACCESS_LEVELS.map((level) => (
            <label key={level.key} className="flex cursor-pointer gap-2 rounded-lg border border-line p-2.5 has-[:checked]:border-accent has-[:checked]:bg-[#f5f8ff]">
              <input type="radio" name="access" value={level.key} defaultChecked={(post?.access ?? "public") === level.key} className="mt-0.5" />
              <span>
                <span className="block font-medium">{level.label}</span>
                <span className="block text-xs text-muted">{level.hint}</span>
              </span>
            </label>
          ))}
          <div>
            <Label htmlFor="teaser">Paragraphs shown before the paywall</Label>
            <Input id="teaser" name="teaserBlocks" type="number" min={0} max={10} defaultValue={post?.teaserBlocks ?? 2} />
          </div>
          <p className="text-xs text-muted">&quot;Members&quot; means anyone whose product includes the publication chosen above (see Products &amp; access). With no publication, any paying member can read it.</p>
        </Box>

        <Box title="Author">
          <select name="authorEditorId" defaultValue={post?.authorEditorId ?? ""} className="pc-control w-full" aria-label="Editor">
            <option value="">— Choose an editor —</option>
            {editors.map((editor) => (
              <option key={editor.id} value={editor.id}>
                {editor.name}
              </option>
            ))}
          </select>
          <Input name="authorName" defaultValue={post?.authorName ?? ""} maxLength={120} placeholder="Byline (defaults to the editor's name)" aria-label="Byline" />
        </Box>

        {kind === "post" ? (
          <Box title="Categories">
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {terms.categories.map((term) => (
                <label key={term.id} className="flex items-center gap-2">
                  <input type="checkbox" name="categoryIds" value={term.id} defaultChecked={chosen.has(term.id)} />
                  {term.name}
                </label>
              ))}
              {terms.categories.length === 0 ? <p className="text-xs text-muted">No categories yet (Categories &amp; tags).</p> : null}
            </div>
          </Box>
        ) : null}
        {kind === "post" ? (
          <Box title="Tags">
            <Input name="tags" defaultValue={tags.join(", ")} placeholder="gold, dividends, small caps" aria-label="Tags" />
            <p className="text-xs text-muted">Separate with commas. New tags are created.</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="featured" defaultChecked={post?.featured ?? false} /> Feature on the homepage
            </label>
          </Box>
        ) : null}

        <Box title="Featured image">
          {post?.featuredAssetId ? (
            <img src={`/w/${site.slug}/media/${post.featuredAssetId}`} alt="" className="aspect-video w-full rounded-md object-cover" />
          ) : null}
          <input type="file" name="featuredFile" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="block w-full text-xs" aria-label="Upload a featured image" />
          {images.length ? (
            <select name="featuredAssetId" defaultValue={post?.featuredAssetId ?? ""} className="pc-control w-full" aria-label="Or choose from the media library">
              <option value="">Or choose from the media library…</option>
              {images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.filename}
                </option>
              ))}
            </select>
          ) : null}
          {post?.featuredAssetId ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="featuredRemove" /> Remove the featured image
            </label>
          ) : null}
        </Box>
        {post && canWrite ? (
          <button formAction={trashPost} className="text-sm font-semibold text-[#b42318]" formNoValidate>
            Move to trash
          </button>
        ) : null}
      </aside>
    </form>
  );
}
