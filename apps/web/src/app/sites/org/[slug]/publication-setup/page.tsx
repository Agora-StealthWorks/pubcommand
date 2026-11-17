import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { getPublications } from "@/features/pubsetup/read";
import { PubChip, StatusBadge, imageUrl } from "@/features/pubsetup/ui";
import { EDITOR_ROLE_LABELS } from "@/features/pubsetup/module";

export default async function PublicationsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; show?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const showArchived = query.show === "archived";
  const all = await getPublications(ctx.resolved.id, ctx.brand.id, { includeArchived: true });
  const archivedCount = all.filter((p) => p.archived).length;
  const publications = all.filter((p) => p.archived === showArchived);

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 text-sm">
          <Link href="/publication-setup" className={`inline-flex min-h-11 items-center rounded-md px-3 font-medium ${showArchived ? "text-muted hover:bg-white" : "bg-white text-ink shadow-sm"}`}>
            Current · {all.length - archivedCount}
          </Link>
          <Link href="/publication-setup?show=archived" className={`inline-flex min-h-11 items-center rounded-md px-3 font-medium ${showArchived ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"}`}>
            Archived · {archivedCount}
          </Link>
        </div>
        <Link href="/publication-setup/publications/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
          + Add publication
        </Link>
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {publications.map((pub) => {
          const lead = pub.editors.find((e) => e.role === "lead") ?? pub.editors[0];
          return (
            <li key={pub.id} className="min-w-0">
              <Link href={`/publication-setup/publications/${pub.id}`} className="flex h-full min-w-0 gap-3 rounded-xl border border-line bg-white p-4 hover:border-accent">
                {pub.hasLogo ? (
                  <img src={imageUrl("pub-logo", pub.id, pub.updatedAt)} alt="" className="h-12 w-12 shrink-0 rounded-md border border-line object-contain" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white" style={{ background: pub.color }} aria-hidden>
                    {pub.code.slice(0, 3)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{pub.name}</span>
                    <PubChip code={pub.code} color={pub.color} />
                    <StatusBadge status={pub.status} archived={pub.archived} />
                  </span>
                  {pub.tagline || pub.description ? <span className="mt-1 line-clamp-2 block text-sm text-muted">{pub.tagline || pub.description}</span> : null}
                  <span className="mt-2 block text-xs text-muted [overflow-wrap:anywhere]">
                    {[pub.pubType, pub.frequency, lead ? `${lead.name} (${EDITOR_ROLE_LABELS[lead.role] ?? lead.role})` : "No editor yet"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {publications.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">
          {showArchived ? "Nothing archived." : `No publications yet. Add each newsletter or service ${ctx.brand.name} publishes.`}
        </p>
      ) : null}
    </div>
  );
}
