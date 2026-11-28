import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { HOME_SECTIONS, homepageFrom } from "../../../../../../../../../modules/websites/content";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { saveHomepage } from "@/features/websites/actions";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { sitePublications } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";
import { websiteLinks } from "@/features/websites/links";

/** Homepage builder: turn sections on or off, put them in order, and set up the hero banner. */
export default async function HomepagePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.settings");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const home = homepageFrom(site.homepage);
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const label = new Map(HOME_SECTIONS.map((section) => [section.key, section]));
  return (
    <div>
      <PageHeader title="Homepage" description="Build the homepage from sections: switch each on or off and number them in the order they should appear. The content inside each section (posts, publications, editors) updates by itself." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/homepage" />
      <form action={saveHomepage} className="space-y-5">
        <input type="hidden" name="siteId" value={site.id} />
        <section className="rounded-xl border border-line bg-white">
          <h2 className="border-b border-line px-5 py-3 font-semibold">Sections, top to bottom</h2>
          <ol>
            {home.sections.map((section, index) => {
              const info = label.get(section.key)!;
              return (
                <li key={section.key} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                  <label className="sr-only" htmlFor={`pos_${section.key}`}>
                    Position of {info.label}
                  </label>
                  <input id={`pos_${section.key}`} name={`pos_${section.key}`} type="number" min={1} max={20} defaultValue={index + 1} className="pc-control w-16 text-center" />
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input type="checkbox" name={`on_${section.key}`} defaultChecked={section.on} className="mt-1 h-4 w-4" />
                    <span>
                      <span className="block font-medium">{info.label}</span>
                      <span className="block text-xs text-muted">{info.hint}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">Tip: change the numbers to reorder (e.g. give the hero banner 1), tick the sections you want, then save. For a classic news front page, use &quot;Featured story&quot; at the top; for a campaign or brand look, put the hero banner first.</p>
        </section>

        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="font-semibold">Hero banner</h2>
          <p className="mt-1 text-sm text-muted">A full-width banner on your main color, with a background image if you add one.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="h-kicker">Small label above the headline</Label>
              <Input id="h-kicker" name="heroKicker" defaultValue={home.hero.kicker} maxLength={60} placeholder="Independent research since 2026" />
            </div>
            <div>
              <Label htmlFor="h-headline">Headline</Label>
              <Input id="h-headline" name="heroHeadline" defaultValue={home.hero.headline} maxLength={160} placeholder="Prosperity follows liberty" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="h-text">Text</Label>
              <Textarea id="h-text" name="heroText" defaultValue={home.hero.text} maxLength={600} rows={3} placeholder="Research for investors who believe in free markets." />
            </div>
            <div>
              <Label htmlFor="h-b1">Button</Label>
              <div className="flex gap-2">
                <Input id="h-b1" name="heroButtonLabel" defaultValue={home.hero.buttonLabel} maxLength={40} placeholder="See our research" />
                <Input name="heroButtonHref" defaultValue={home.hero.buttonHref} maxLength={500} placeholder="/research" aria-label="Button link" />
              </div>
            </div>
            <div>
              <Label htmlFor="h-b2">Second button (optional)</Label>
              <div className="flex gap-2">
                <Input id="h-b2" name="heroButton2Label" defaultValue={home.hero.button2Label} maxLength={40} placeholder="Free newsletters" />
                <Input name="heroButton2Href" defaultValue={home.hero.button2Href} maxLength={500} placeholder="/newsletters" aria-label="Second button link" />
              </div>
            </div>
            <div>
              <Label htmlFor="h-signup">Email sign-up box in the hero</Label>
              <select id="h-signup" name="heroSignupPublicationId" defaultValue={home.hero.signupPublicationId ?? ""} className="pc-control w-full">
                <option value="">None</option>
                {pubs.free.map((pub) => (
                  <option key={pub.id} value={pub.id}>
                    {pub.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="h-image">Background image</Label>
              {home.hero.imageAssetId ? (
                <img src={`/w/${site.slug}/media/${home.hero.imageAssetId}`} alt="" className="mb-2 h-24 w-full rounded-md object-cover" />
              ) : null}
              <input id="h-image" type="file" name="heroImage" accept="image/png,image/jpeg,image/webp" className="block w-full text-xs" />
              <p className="mt-1 text-xs text-muted">Wide photo, 1600 px or more. It is darkened so the text stays readable.</p>
              {home.hero.imageAssetId ? (
                <label className="mt-1 flex items-center gap-2 text-xs">
                  <input type="checkbox" name="heroImageRemove" /> Remove the image
                </label>
              ) : null}
            </div>
          </div>
        </section>
        <div className="flex items-center gap-3">
          <Button>Save homepage</Button>
          <a href={(await websiteLinks(site)).site} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent">
            Preview ↗
          </a>
        </div>
      </form>
    </div>
  );
}
