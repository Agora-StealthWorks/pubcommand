import { rawPrisma, tenantDb } from "@pubcommand/db";
import { Badge, Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { decidePendingPost } from "@/features/agents/actions";
import { agentLabels } from "@/features/agents/data";
import { agentsPage, when } from "@/features/agents/page-access";

type Row = {
  kind: "web" | "text";
  id: string;
  title: string;
  preview: string;
  where: string;
  brandId: string;
  editHref: string;
  authorId: string | null;
  createdById: string | null;
  requestedAt: Date | null;
  updatedAt: Date;
};

function plain(html: string, max = 280) {
  const value = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Every post waiting for approval (AI agents' and people's), in the brands and apps this person can publish. */
export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await agentsPage(slug);
  if (!access) notFound();
  if (!access.canApprove) return <Denied title="Approvals need publish rights in Websites or Mini-Blog" />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const [webPosts, textPosts, labels] = await Promise.all([
    access.webPublishBrands.length
      ? db.webPost.findMany({ where: { status: "pending", deletedAt: null, site: { brandId: { in: access.webPublishBrands } } }, include: { site: true }, orderBy: { updatedAt: "asc" } })
      : [],
    access.textPublishBrands.length
      ? db.textPost.findMany({ where: { status: "pending", deletedAt: null, site: { brandId: { in: access.textPublishBrands } } }, include: { site: true }, orderBy: { updatedAt: "asc" } })
      : [],
    agentLabels(ctx.resolved.id),
  ]);
  const rows: Row[] = [
    ...webPosts.map((post) => ({
      kind: "web" as const,
      id: post.id,
      title: post.title,
      preview: post.excerpt || plain(post.bodyHtml),
      where: `Website · ${post.site.name}`,
      brandId: post.site.brandId,
      editHref: `/websites/posts/${post.id}`,
      authorId: post.updatedById ?? post.createdById,
      createdById: post.createdById,
      requestedAt: post.publishedAt,
      updatedAt: post.updatedAt,
    })),
    ...textPosts.map((post) => ({
      kind: "text" as const,
      id: post.id,
      title: post.title,
      preview: plain(post.bodyHtml),
      where: `Mini-Blog · ${post.site.name}`,
      brandId: post.site.brandId,
      editHref: `/mini-blog/${post.siteId}/posts/${post.id}`,
      authorId: post.createdById,
      createdById: post.createdById,
      requestedAt: post.publishAt,
      updatedAt: post.updatedAt,
    })),
  ].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  const people = await rawPrisma().user.findMany({ where: { id: { in: rows.map((row) => row.authorId).filter((id): id is string => Boolean(id) && !labels.has(id!)) } }, select: { id: true, name: true, email: true } });
  const personName = new Map(people.map((person) => [person.id, person.name || person.email]));
  const brandName = new Map(ctx.brands.map((brand) => [brand.id, brand.name]));
  const multiBrand = ctx.brands.length > 1;

  return (
    <div className="min-w-0 max-w-4xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">Nothing is waiting for approval.</p>
      ) : (
        rows.map((row) => {
          // An agent's post stays marked as one even after a person edits it.
          const agent = (row.createdById ? labels.get(row.createdById) : undefined) ?? (row.authorId ? labels.get(row.authorId) : undefined);
          const future = row.requestedAt && row.requestedAt > new Date();
          return (
            <article key={`${row.kind}-${row.id}`} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={row.editHref} className="text-base font-semibold text-accent">
                  {row.title}
                </Link>
                {agent ? (
                  <Badge tone="accent" title={`${agent.name}, ${agent.ownerName}'s agent`}>
                    AI · {agent.platformLabel} · {agent.ownerName}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted">
                {row.where}
                {multiBrand ? ` · ${brandName.get(row.brandId) ?? ""}` : ""} · by {agent ? agent.name : row.authorId ? personName.get(row.authorId) ?? "someone" : "someone"} · submitted {when(row.updatedAt)}
                {future ? ` · asks to go live ${when(row.requestedAt)}` : ""}
              </p>
              {row.preview ? <p className="mt-2 text-sm text-ink">{row.preview}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={decidePendingPost}>
                  <input type="hidden" name="kind" value={row.kind} />
                  <input type="hidden" name="postId" value={row.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <Button type="submit">{future ? "Approve and schedule" : "Approve and publish"}</Button>
                </form>
                <form action={decidePendingPost} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="kind" value={row.kind} />
                  <input type="hidden" name="postId" value={row.id} />
                  <input type="hidden" name="decision" value="return" />
                  <Input name="note" placeholder="Note (optional, kept in Activity)" maxLength={500} className="min-w-0 flex-1 sm:max-w-xs" />
                  <Button type="submit" variant="secondary">
                    Send back to draft
                  </Button>
                </form>
                <Link href={row.editHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
                  Open in editor
                </Link>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}
