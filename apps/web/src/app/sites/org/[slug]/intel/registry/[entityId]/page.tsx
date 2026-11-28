import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { intelAccess } from "@/features/intel/context";
import { competitorOptions } from "@/features/intel/data";
import { deleteEntity, mergeEntityAction, toggleEntityIgnored, updateEntity } from "@/features/intel/more-actions";
import { entityOptions, loadEntity, registryCounts } from "@/features/intel/registry";
import { RegistryTabs } from "@/features/intel/registry-page";
import { TypeBadge, formatDay } from "@/features/intel/ui";
import { ENTITY_LABELS, LIST_CATEGORIES, LIST_CATEGORY_LABELS } from "../../../../../../../../../../modules/intel/index";

export default async function IntelEntityPage({ params, searchParams }: { params: Promise<{ slug: string; entityId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug, entityId } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const entity = await loadEntity(scope.organizationId, scope.brand.id, entityId);
  if (!entity) notFound();
  const label = ENTITY_LABELS[entity.kind];
  const [counts, competitors, others] = await Promise.all([
    registryCounts(scope.organizationId, scope.brand.id),
    competitorOptions(scope.organizationId, scope.brand.id),
    entityOptions(scope.organizationId, scope.brand.id, entity.kind),
  ]);
  const mergeTargets = others.filter((other) => other.id !== entity.id);
  const competitorName = competitors.find((competitor) => competitor.id === entity.competitorId)?.name ?? null;

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      <RegistryTabs kind={entity.kind} counts={counts} />
      <Link href={label.route} className="text-sm text-accent underline">
        ← {label.many}
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-2">
        <h2 className="pc-break text-xl font-semibold tracking-tight">{entity.name}</h2>
        <Badge>{label.one.toLowerCase()}</Badge>
        {entity.ignored ? <Badge tone="warn">ignored</Badge> : null}
        {entity.autoCreated ? <Badge>added automatically</Badge> : null}
      </div>
      <p className="mb-4 text-sm text-muted">
        {entity.count} email{entity.count === 1 ? "" : "s"} and videos
        {competitorName ? ` · ${competitorName}` : ""}
        {entity.category ? ` · ${LIST_CATEGORY_LABELS[entity.category as keyof typeof LIST_CATEGORY_LABELS] ?? entity.category}` : ""}
        {" · "}
        <Link href={`/ispy?${entity.kind}=${entity.id}`} className="text-accent underline">
          See them in the inbox
        </Link>
        {" · "}
        <a href={`/ispy/export?${entity.kind}=${entity.id}`} className="text-accent underline">
          Export CSV
        </a>
      </p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-line bg-white">
            <h3 className="border-b border-line px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">Recent emails</h3>
            {entity.emails.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {entity.emails.map((email) => (
                  <li key={email.id}>
                    <Link href={`/ispy/emails/${email.id}`} className="block px-4 py-2 hover:bg-canvas">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold">{email.competitor?.name ?? email.fromAddress}</span>
                        <TypeBadge type={email.emailType} />
                        <span className="ml-auto text-xs text-muted">{formatDay(email.receivedAt)}</span>
                      </div>
                      <p className="pc-break text-sm">{email.subject}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {entity.videos.length ? (
            <div className="rounded-xl border border-line bg-white">
              <h3 className="border-b border-line px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">Videos</h3>
              <ul className="divide-y divide-line">
                {entity.videos.map((video) => (
                  <li key={video.id}>
                    <Link href={`/ispy/videos/${video.id}`} className="block px-4 py-2 hover:bg-canvas">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="pc-break min-w-0 text-sm">{video.title ?? video.url}</span>
                        <TypeBadge type={video.videoType} />
                        <span className="ml-auto text-xs text-muted">{formatDay(video.createdAt)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {scope.canWrite ? (
          <aside className="min-w-0 space-y-4">
            <form action={updateEntity} className="space-y-3 rounded-xl border border-line bg-white p-4">
              <input type="hidden" name="entityId" value={entity.id} />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Edit</h3>
              <div>
                <Label htmlFor="entity-name">Name</Label>
                <Input id="entity-name" name="name" defaultValue={entity.name} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="entity-aliases">{entity.kind === "list" ? "Aliases and sender addresses" : "Aliases"}</Label>
                <Textarea id="entity-aliases" name="aliases" defaultValue={entity.aliases.join("\n")} rows={3} className="mt-1" />
                <p className="mt-1 text-xs text-muted">One per line. Any of these spellings resolves to this {label.one.toLowerCase()}.</p>
              </div>
              {entity.kind !== "topic" ? (
                <div>
                  <Label htmlFor="entity-competitor">Competitor</Label>
                  <select id="entity-competitor" name="competitorId" defaultValue={entity.competitorId ?? ""} className="pc-control mt-1 w-full">
                    <option value="">None</option>
                    {competitors.map((competitor) => (
                      <option key={competitor.id} value={competitor.id}>
                        {competitor.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {entity.kind === "list" ? (
                <div>
                  <Label htmlFor="entity-category">Category</Label>
                  <select id="entity-category" name="category" defaultValue={entity.category ?? ""} className="pc-control mt-1 w-full">
                    <option value="">Not set</option>
                    {LIST_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {LIST_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <Label htmlFor="entity-notes">Notes</Label>
                <Textarea id="entity-notes" name="notes" defaultValue={entity.notes ?? ""} rows={3} className="mt-1" />
              </div>
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>

            <form action={mergeEntityAction} className="space-y-2 rounded-xl border border-line bg-white p-4">
              <input type="hidden" name="entityId" value={entity.id} />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Merge into another</h3>
              <p className="text-sm text-muted">Same {label.one.toLowerCase()} under another spelling? Its links move over and &quot;{entity.name}&quot; becomes an alias there.</p>
              <label htmlFor="merge-target" className="sr-only">
                Merge into
              </label>
              <select id="merge-target" name="targetId" required defaultValue="" className="pc-control w-full">
                <option value="" disabled>
                  Pick one…
                </option>
                {mergeTargets.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" size="sm" disabled={!mergeTargets.length}>
                Merge
              </Button>
            </form>

            <div className="flex flex-wrap gap-2">
              <form action={toggleEntityIgnored}>
                <input type="hidden" name="entityId" value={entity.id} />
                <Button type="submit" variant="secondary" size="sm">
                  {entity.ignored ? "Stop ignoring" : "Ignore"}
                </Button>
              </form>
              <form action={deleteEntity}>
                <input type="hidden" name="entityId" value={entity.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete
                </Button>
              </form>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
