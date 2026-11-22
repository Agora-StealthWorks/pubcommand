import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { linkEditor, setPublicationArchived, unlinkEditor } from "@/features/pubsetup/actions";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { BRANDING_KEYS, EDITOR_ROLES, EDITOR_ROLE_LABELS, PUBLICATION_FIELDS, optionLabel } from "@/features/pubsetup/module";
import { getBranding, getEditors, getPublication } from "@/features/pubsetup/read";
import { savePublicationSenderAction } from "@/features/email/actions";
import { getSender } from "@/features/email/org-email";
import { SenderForm } from "@/features/email/sender-form";
import { Detail, PubChip, PubLogoTile, SafeLink, StatusBadge, imageUrl } from "@/features/pubsetup/ui";

const BRANDING_LABELS: Record<string, string> = {
  primaryColor: "Header color",
  accentColor: "Accent",
  textColor: "Text",
  backgroundColor: "Background",
  headingFont: "Heading font",
  bodyFont: "Body font",
  tagline: "Tagline",
};

const SOURCE_LABELS = { publication: "own", brand: "brand default", default: "platform default" } as const;

function RoleSelect({ value }: { value: string }) {
  return (
    <select name="role" defaultValue={value} className="pc-control" aria-label="Role">
      {EDITOR_ROLES.map((role) => (
        <option key={role} value={role}>
          {EDITOR_ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

export default async function PublicationPage({ params, searchParams }: { params: Promise<{ slug: string; publicationId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, publicationId } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const pub = await getPublication(ctx.resolved.id, ctx.brand.id, publicationId);
  if (!pub || pub.id !== publicationId) notFound();
  const [branding, editors, sender] = await Promise.all([
    getBranding(ctx.resolved.id, pub.id),
    getEditors(ctx.resolved.id, ctx.brand.id),
    getSender(ctx.resolved.id, "publication", pub.id),
  ]);
  const linked = new Set(pub.editors.map((e) => e.id));
  const available = editors.filter((e) => !linked.has(e.id));
  const def = (key: string) => PUBLICATION_FIELDS.find((d) => d.key === key)!;

  return (
    <div className="space-y-5">
      <Link href={pub.archived ? "/settings/publication-setup?show=archived" : "/settings/publication-setup"} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← Publications
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <header className="flex flex-wrap items-start gap-4 rounded-xl border border-line bg-white p-4">
        <PubLogoTile pub={pub} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{pub.name}</h2>
            <PubChip code={pub.code} color={pub.color} />
            <StatusBadge status={pub.status} archived={pub.archived} />
          </div>
          {pub.tagline ? <p className="mt-1 text-sm text-muted">{pub.tagline}</p> : null}
          <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
            URL name: {pub.slug}
            {[pub.category?.name, pub.tier, pub.frequency].filter(Boolean).length ? ` · ${[pub.category?.name, pub.tier, pub.frequency].filter(Boolean).join(" · ")}` : ""}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href={`/settings/publication-setup/publications/${pub.id}/edit`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
            Edit details
          </Link>
          <Link href={`/settings/publication-setup/publications/${pub.id}/branding`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
            Branding
          </Link>
          <form action={setPublicationArchived}>
            <input type="hidden" name="publicationId" value={pub.id} />
            <input type="hidden" name="archive" value={pub.archived ? "0" : "1"} />
            <Button type="submit" variant={pub.archived ? "secondary" : "danger"}>
              {pub.archived ? "Restore" : "Archive"}
            </Button>
          </form>
        </div>
      </header>

      {pub.archived ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Archived: hidden from every picker and the calendar. Old issues and send stats keep it. Restore to use it again.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-4">
          <h3 className="font-semibold">Details</h3>
          {pub.hasCover ? <img src={imageUrl("pub-cover", pub.id, pub.updatedAt)} alt="" className="max-h-56 w-full rounded-md border border-line object-cover" /> : null}
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Status">{optionLabel(def("status"), pub.status)}</Detail>
            <Detail label="Launch date">{pub.launchDate}</Detail>
          </dl>
          <dl className="space-y-4">
            <Detail label="Short description">{pub.description}</Detail>
            <Detail label="Long description">{pub.longDescription}</Detail>
            <Detail label="Positioning">{pub.positioning}</Detail>
            <Detail label="Audience">{pub.audience}</Detail>
            <Detail label="What readers get">{pub.deliverables.length ? pub.deliverables.map((d) => `• ${d}`).join("\n") : null}</Detail>
            <Detail label="Pricing">
              {[pub.retailPrice, pub.lifetimePrice, pub.salePrice].some(Boolean) ? (
                <span className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  {(
                    [
                      ["Retail price", pub.retailPrice],
                      ["Unlimited / lifetime", pub.lifetimePrice],
                      ["Typical sale price", pub.salePrice],
                    ] as const
                  )
                    .filter(([, v]) => v)
                    .map(([label, v]) => (
                      <span key={label} className="contents">
                        <span className="text-muted">{label}</span>
                        <span className="font-medium">{v}</span>
                      </span>
                    ))}
                </span>
              ) : null}
            </Detail>
            <Detail label="Pricing notes">{pub.pricingNotes}</Detail>
            <Detail label="Price points and offers">{pub.offers.length ? pub.offers.map((o) => [o.label, o.price, o.term].filter(Boolean).join(" · ")).join("\n") : null}</Detail>
            <Detail label="Voice and style">{pub.voiceNotes}</Detail>
            <Detail label="Compliance notes">{pub.complianceNotes}</Detail>
            <Detail label="Links">
              {[pub.websiteUrl, pub.signupUrl, pub.archiveUrl].some(Boolean) ? (
                <span className="flex flex-col gap-1">
                  {pub.websiteUrl ? <SafeLink href={pub.websiteUrl}>Website</SafeLink> : null}
                  {pub.signupUrl ? <SafeLink href={pub.signupUrl}>Sign-up page</SafeLink> : null}
                  {pub.archiveUrl ? <SafeLink href={pub.archiveUrl}>Archive</SafeLink> : null}
                </span>
              ) : null}
            </Detail>
            <Detail label="Sample issues">
              {pub.sampleIssues.length ? (
                <span className="flex flex-col gap-1">
                  {pub.sampleIssues.map((s, i) => (
                    <SafeLink key={i} href={s.url}>
                      {s.title || s.url}
                    </SafeLink>
                  ))}
                </span>
              ) : null}
            </Detail>
          </dl>
          {!pub.description && !pub.positioning && !pub.audience ? (
            <p className="text-sm text-muted">
              Add a description, positioning and audience under{" "}
              <Link href={`/settings/publication-setup/publications/${pub.id}/edit`} className="text-accent hover:underline">
                Edit details
              </Link>
              : AI drafts and the Brain use them.
            </p>
          ) : null}
        </section>

        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border border-line bg-white p-4">
            <h3 className="mb-3 font-semibold">Editors</h3>
            <ul className="divide-y divide-line">
              {pub.editors.map((editor) => (
                <li key={editor.id} className="py-3">
                  <Link href={`/settings/publication-setup/editors/${editor.id}`} className="font-medium [overflow-wrap:anywhere] hover:text-accent">
                    {editor.name}
                  </Link>
                  {editor.title ? <span className="block text-xs text-muted">{editor.title}</span> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <form action={linkEditor} className="flex items-center gap-2">
                      <input type="hidden" name="publicationId" value={pub.id} />
                      <input type="hidden" name="editorId" value={editor.id} />
                      <RoleSelect value={editor.role} />
                      <Button type="submit" variant="secondary" size="sm">
                        Save
                      </Button>
                    </form>
                    <form action={unlinkEditor}>
                      <input type="hidden" name="publicationId" value={pub.id} />
                      <input type="hidden" name="editorId" value={editor.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${editor.name}`}>
                        Remove
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
              {pub.editors.length === 0 ? <li className="py-2 text-sm text-muted">No editors yet.</li> : null}
            </ul>
            {available.length ? (
              <form action={linkEditor} className="mt-3 space-y-2 border-t border-line pt-3">
                <input type="hidden" name="publicationId" value={pub.id} />
                <label htmlFor="add-editor" className="text-sm font-medium">
                  Add an editor
                </label>
                <select id="add-editor" name="editorId" className="pc-control w-full" required>
                  {available.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <RoleSelect value={pub.editors.some((e) => e.role === "lead") ? "contributor" : "lead"} />
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                </div>
              </form>
            ) : null}
            <Link href="/settings/publication-setup/editors/new" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
              + New editor
            </Link>
          </section>

          {branding ? (
            <section className="rounded-xl border border-line bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-semibold">Branding</h3>
                <Link href={`/settings/publication-setup/publications/${pub.id}/branding`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
                  Edit
                </Link>
              </div>
              <dl className="space-y-2 text-sm">
                {BRANDING_KEYS.filter((key) => branding.values[key]).map((key) => (
                  <div key={key} className="flex min-w-0 items-start justify-between gap-3">
                    <dt className="shrink-0 text-muted">{BRANDING_LABELS[key]}</dt>
                    <dd className="min-w-0 text-right [overflow-wrap:anywhere]">
                      {key.endsWith("Color") ? <span className="mr-1 inline-block h-3 w-3 rounded-sm border border-line align-middle" style={{ background: branding.values[key] }} aria-hidden /> : null}
                      {branding.values[key]}
                      <span className="block text-xs text-muted">{SOURCE_LABELS[branding.sources[key]]}</span>
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Logo</dt>
                  <dd className="text-right">
                    {branding.logo === "publication" ? "own" : branding.logo === "brand" ? "brand default" : "none (name as text)"}
                    {branding.logo ? (
                      <span className="block text-xs text-muted">
                        {(["light", "dark"] as const)
                          .filter((slot) => branding.logos[branding.logo === "publication" ? "publication" : "brand"][slot])
                          .map((slot) => (slot === "light" ? "light backgrounds" : "dark backgrounds"))
                          .join(" + ")}
                      </span>
                    ) : null}
                  </dd>
                </div>
                {pub.logos.light || pub.logos.dark ? (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {(["light", "dark"] as const).map((slot) => (
                      <div key={slot} className="flex h-14 items-center justify-center rounded-md border border-line px-2" style={{ background: slot === "light" ? "#ffffff" : "#111827" }} title={slot === "light" ? "For light backgrounds" : "For dark backgrounds"}>
                        {pub.logos[slot] ? (
                          <img src={imageUrl(slot === "light" ? "pub-logo" : "pub-logo-dark", pub.id, pub.updatedAt)} alt={`Logo for ${slot} backgrounds`} className="max-h-10 max-w-full object-contain" />
                        ) : (
                          <span className={`text-xs ${slot === "dark" ? "text-white/70" : "text-muted"}`}>Empty</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}
          <section id="email-sender" className="scroll-mt-4 rounded-xl border border-line bg-white p-4">
            <h3 className="text-sm font-semibold">Email sender (optional)</h3>
            <p className="mb-3 mt-1 text-xs text-muted">
              For reader emails about this publication. Blank fields use the brand&apos;s sender, then the default in Settings → Email.
            </p>
            <SenderForm id="publication" action={savePublicationSenderAction} hidden={{ publicationId: pub.id }} value={sender} placeholders={{ fromName: pub.name }} />
          </section>
        </div>
      </div>
    </div>
  );
}
