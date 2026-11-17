import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { wikiEditor } from "@/features/wiki/data";
import { wikiPage } from "@/features/wiki/guard";
import { Avatar, ExternalLink, Fact, PubLogo, Section, TestimonialCard } from "@/features/wiki/ui";
import { EDITOR_ROLE_LABELS } from "../../../../../../../../../../modules/pubsetup/fields";

export default async function WikiEditorPage({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  const access = await wikiPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const data = await wikiEditor(ctx.resolved.id, ctx.brand.id, decodeURIComponent(ref));
  if (!data) notFound();
  const { editor, writes, testimonials, pubs } = data;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:p-6">
        <Avatar editor={editor} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold [overflow-wrap:anywhere]">{editor.name}</h2>
          {editor.title ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{editor.title}</p> : null}
          {editor.status !== "active" ? <p className="mt-1 text-xs font-semibold text-[#b54708]">Inactive</p> : null}
          {editor.specialties.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {editor.specialties.map((s) => (
                <li key={s} className="rounded-full bg-canvas px-2.5 py-0.5 text-xs text-muted">
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {editor.socialLinks.map((l, i) => (
              <ExternalLink key={i} href={l.url}>
                {l.label || l.url}
              </ExternalLink>
            ))}
            {can.editSetup ? (
              <Link href={`/publication-setup/editors/${editor.id}`} className="text-accent hover:underline">
                Edit in Publication Setup
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Section title="Bio">
            <dl className="space-y-4">
              <Fact label="In short">{editor.shortBio}</Fact>
              <Fact label="Full bio">{editor.longBio}</Fact>
              <Fact label="Credentials">{editor.credentials}</Fact>
              <Fact label="Track record">{editor.trackRecord}</Fact>
            </dl>
            {!editor.shortBio && !editor.longBio && !editor.credentials && !editor.trackRecord ? <p className="text-sm text-muted">No bio yet.</p> : null}
          </Section>

          <Section
            title={`Testimonials${testimonials.total ? ` · ${testimonials.total}` : ""}`}
            action={can.testimonials ? <Link href={`/testimonials?status=approved&editor=${editor.id}`} className="text-sm text-accent hover:underline">See all</Link> : null}
          >
            {testimonials.items.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {testimonials.items.map((t) => {
                  const p = t.publicationId ? pubs.get(t.publicationId) : null;
                  return (
                    <li key={t.id} className="min-w-0">
                      <TestimonialCard t={t} publication={p ? { slug: p.slug, name: p.name } : null} manageHref={can.testimonials ? `/testimonials/${t.id}` : null} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No approved testimonials mention {editor.name} yet.</p>
            )}
          </Section>
        </div>
        <div className="min-w-0 space-y-4">
          <Section title="Writes for">
            {writes.length ? (
              <ul className="space-y-3">
                {writes.map((w) => (
                  <li key={w.id}>
                    <Link href={`/wiki/publications/${w.pub.slug}`} className="flex items-center gap-3 hover:text-accent">
                      <PubLogo pub={w.pub} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-medium [overflow-wrap:anywhere]">{w.name}</span>
                        <span className="block text-xs text-muted">{[w.code, EDITOR_ROLE_LABELS[w.role] ?? w.role].join(" · ")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Not linked to a publication yet.</p>
            )}
          </Section>
          {editor.voiceNotes ? (
            <Section title="Voice">
              <p className="whitespace-pre-line text-sm [overflow-wrap:anywhere]">{editor.voiceNotes}</p>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
