import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { StatusBadge } from "@/features/pubsetup/ui";
import { wikiPublication } from "@/features/wiki/data";
import { wikiPage } from "@/features/wiki/guard";
import { Avatar, ExternalLink, Fact, Section, TestimonialCard, wikiImage, wikiLogo } from "@/features/wiki/ui";
import { contrastText } from "../../../../../../../../../../modules/pubsetup/branding";
import { EDITOR_ROLE_LABELS, fontStack } from "../../../../../../../../../../modules/pubsetup/fields";

export default async function WikiPublicationPage({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  const access = await wikiPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const data = await wikiPublication(ctx.resolved.id, ctx.brand.id, decodeURIComponent(ref), { calendar: can.calendar, promos: can.promos });
  if (!data) notFound();
  const { pub, branding, team, testimonials, issues, promos } = data;
  const primary = branding?.values.primaryColor ?? pub.color;
  const onPrimary = contrastText(primary);
  const heading = branding ? fontStack(branding.values.headingFont) : undefined;
  // The header sits on the primary color: use the logo made for that background.
  const headerBg = onPrimary === "#ffffff" ? "dark" : "light";
  const logo = branding
    ? wikiLogo({ id: pub.id, logos: branding.logos.publication, updatedAt: pub.updatedAt }, headerBg, { id: ctx.brand.id, logos: branding.logos.brand, updatedAt: branding.brandVersion })
    : wikiLogo(pub, headerBg);
  // Only the other variant exists: put it on a tile so it stays readable.
  const logoTile = logo && logo.slot !== headerBg ? (logo.slot === "light" ? "#ffffff" : "#111827") : null;
  const pricing = (
    [
      ["Retail price", pub.retailPrice],
      ["Unlimited / lifetime", pub.lifetimePrice],
      ["Typical sale price", pub.salePrice],
    ] as const
  ).filter(([, v]) => v);
  const tagline = pub.tagline || (branding?.sources.tagline === "brand" ? "" : branding?.values.tagline) || "";
  const editorRef = (id: string | null) => (id ? team.find((m) => m.id === id) : undefined);

  return (
    <div className="space-y-4">
      <header className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6" style={{ background: primary, color: onPrimary }}>
          {logo ? (
            <img src={logo.src} alt="" className="h-20 w-20 shrink-0 rounded-lg object-contain p-1.5 sm:h-24 sm:w-24" style={logoTile ? { background: logoTile } : undefined} />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-white/15 text-lg font-bold sm:h-24 sm:w-24" aria-hidden>
              {pub.code.slice(0, 4)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{[pub.code, pub.pubType].filter(Boolean).join(" · ")}</p>
            <h2 className="mt-1 text-2xl font-semibold [overflow-wrap:anywhere] sm:text-3xl" style={{ fontFamily: heading }}>
              {pub.name}
            </h2>
            {tagline ? <p className="mt-1 text-sm opacity-90 [overflow-wrap:anywhere]">{tagline}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm">
          <StatusBadge status={pub.status} />
          {[pub.tier, pub.frequency, pub.launchDate ? `Since ${pub.launchDate}` : null].filter(Boolean).map((x) => (
            <span key={String(x)} className="text-muted">
              {x}
            </span>
          ))}
          {branding ? (
            <span className="flex items-center gap-1" title="Brand colors">
              {[branding.values.primaryColor, branding.values.accentColor, branding.values.textColor, branding.values.backgroundColor].map((c, i) => (
                <span key={i} className="h-4 w-4 rounded-full border border-line" style={{ background: c }} />
              ))}
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
            <ExternalLink href={pub.websiteUrl}>Website</ExternalLink>
            <ExternalLink href={pub.signupUrl}>Sign-up page</ExternalLink>
            <ExternalLink href={pub.archiveUrl}>Archive</ExternalLink>
            {can.editSetup ? (
              <Link href={`/publication-setup/publications/${pub.id}`} className="text-accent hover:underline">
                Edit in Publication Setup
              </Link>
            ) : null}
          </span>
        </div>
        {pub.hasCover ? (
          <img src={wikiImage("pub-cover", pub.id, pub.updatedAt)} alt="" className="max-h-72 w-full border-t border-line object-cover" />
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Section title="About">
            <dl className="space-y-4">
              <Fact label="Summary">{pub.description}</Fact>
              <Fact label="Description">{pub.longDescription}</Fact>
              <Fact label="Positioning">{pub.positioning}</Fact>
              <Fact label="Audience">{pub.audience}</Fact>
              {pub.deliverables.length ? (
                <Fact label="What's included">
                  <ul className="list-disc space-y-1 pl-5">
                    {pub.deliverables.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </Fact>
              ) : null}
            </dl>
            {!pub.description && !pub.longDescription && !pub.positioning && !pub.audience && !pub.deliverables.length ? <p className="text-sm text-muted">No description yet.</p> : null}
          </Section>

          {pricing.length || pub.pricingNotes || pub.offers.length ? (
            <Section title="Pricing">
              {pricing.length ? (
                <dl className="grid gap-3 sm:grid-cols-3">
                  {pricing.map(([label, v]) => (
                    <div key={label} className="min-w-0 rounded-lg bg-canvas p-3">
                      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
                      <dd className="mt-1 text-base font-semibold [overflow-wrap:anywhere]">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {pub.pricingNotes ? <p className="mt-3 whitespace-pre-line text-sm text-muted [overflow-wrap:anywhere]">{pub.pricingNotes}</p> : null}
              {pub.offers.length ? <h3 className="mb-1 mt-4 text-sm font-semibold">Offers and price points</h3> : null}
              <ul className="divide-y divide-line">
                {pub.offers.map((o, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="font-medium [overflow-wrap:anywhere]">{o.label || "Offer"}</span>
                    <span className="text-muted [overflow-wrap:anywhere]">{[o.price, o.term].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section
            title={`Testimonials${testimonials.total ? ` · ${testimonials.total}` : ""}`}
            action={
              can.testimonials ? (
                <span className="flex gap-3 text-sm">
                  {can.addTestimonial ? (
                    <Link href={`/testimonials/new?pub=${pub.id}`} className="text-accent hover:underline">
                      + Add
                    </Link>
                  ) : null}
                  <Link href={`/testimonials/publication/${pub.slug}`} className="text-accent hover:underline">
                    See all
                  </Link>
                </span>
              ) : null
            }
          >
            {testimonials.items.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {testimonials.items.map((t) => {
                  const ed = editorRef(t.editorId);
                  return (
                    <li key={t.id} className="min-w-0">
                      <TestimonialCard t={t} editor={ed ? { slug: ed.slug, name: ed.name } : null} manageHref={can.testimonials ? `/testimonials/${t.id}` : null} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No approved testimonials yet.</p>
            )}
          </Section>

          {can.calendar ? (
            <Section title="Recent issues" action={<Link href="/editorial" className="text-sm text-accent hover:underline">Calendar</Link>}>
              {issues.length ? (
                <ul className="divide-y divide-line">
                  {issues.map((i) => (
                    <li key={i.id}>
                      <Link href={`/editorial/issues/${i.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm hover:text-accent">
                        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{i.title}</span>
                        <span className="text-xs text-muted">{[i.mailDate?.toISOString().slice(0, 10), i.issueType, i.status].filter(Boolean).join(" · ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No issues mailed yet for {pub.code}.</p>
              )}
            </Section>
          ) : null}

          {can.promos && promos.length ? (
            <Section title="Promos" action={<Link href="/promo-studio" className="text-sm text-accent hover:underline">Promo Analyzer</Link>}>
              <ul className="divide-y divide-line">
                {promos.map((p) => (
                  <li key={p.id}>
                    <Link href={`/promo-studio/${p.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm hover:text-accent">
                      <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{p.title}</span>
                      <span className="text-xs text-muted">{[p.promoType, p.promoStatus].filter(Boolean).join(" · ")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <Section title={team.length === 1 ? "Editor" : "Editors"}>
            {team.length ? (
              <ul className="space-y-3">
                {team.map((m) => (
                  <li key={m.id}>
                    <Link href={`/wiki/editors/${m.slug}`} className="flex items-center gap-3 hover:text-accent">
                      <Avatar editor={m.editor} />
                      <span className="min-w-0">
                        <span className="block font-medium [overflow-wrap:anywhere]">{m.name}</span>
                        <span className="block text-xs text-muted [overflow-wrap:anywhere]">{[EDITOR_ROLE_LABELS[m.role] ?? m.role, m.title].filter(Boolean).join(" · ")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No editor linked yet.</p>
            )}
          </Section>

          {pub.sampleIssues.length ? (
            <Section title="Sample issues">
              <ul className="space-y-2 text-sm">
                {pub.sampleIssues.map((s, i) => (
                  <li key={i}>
                    <ExternalLink href={s.url}>{s.title || s.url}</ExternalLink>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {pub.voiceNotes || pub.complianceNotes ? (
            <Section title="Writing notes">
              <dl className="space-y-4">
                <Fact label="Voice">{pub.voiceNotes}</Fact>
                <Fact label="Compliance">{pub.complianceNotes}</Fact>
              </dl>
            </Section>
          ) : null}

          {branding ? (
            <Section title="Branding">
              <dl className="grid grid-cols-2 gap-3">
                <Fact label="Headings">{branding.values.headingFont}</Fact>
                <Fact label="Body">{branding.values.bodyFont}</Fact>
                <Fact label="Primary">{branding.values.primaryColor}</Fact>
              </dl>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
