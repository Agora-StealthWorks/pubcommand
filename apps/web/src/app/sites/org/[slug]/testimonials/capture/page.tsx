import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createCaptureLinkAction, toggleCaptureLinkAction } from "@/features/testimonials/actions";
import { testimonialsPage } from "@/features/testimonials/guard";
import { listCaptureLinks, lookups } from "@/features/testimonials/server";
import { defaultConsentText } from "../../../../../../../../../modules/testimonials/testimonials";

export default async function CaptureLinksPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await testimonialsPage(slug, "testimonials.approve");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const [links, look] = await Promise.all([listCaptureLinks(ctx.resolved.id, ctx.brand.id), lookups(ctx.resolved.id, ctx.brand.id)]);
  const origin = ctx.request.origin;
  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <p className="max-w-2xl text-sm text-muted">
        Share a link and readers can send their story with a consent checkbox. The exact consent wording is stored with each submission. Everything submitted waits for review.
      </p>
      {links.length ? (
        <ul className="space-y-3">
          {links.map((l) => {
            const url = `${origin}/p/testimonial/${l.token}`;
            const pub = l.publicationId ? look.pubs.get(l.publicationId) : null;
            return (
              <li key={l.id} className="space-y-2 rounded-xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{l.title}</span>
                  <span className={`text-xs font-semibold ${l.active ? "text-[#067647]" : "text-muted"}`}>{l.active ? "Open" : "Closed"}</span>
                </div>
                <p className="text-xs text-muted">
                  {pub ? pub.name : "Reader picks the publication"} · {l.submissions} submission{l.submissions === 1 ? "" : "s"}
                </p>
                <a href={url} target="_blank" rel="noreferrer" className="block break-all text-sm text-accent hover:underline">
                  {url}
                </a>
                <form action={toggleCaptureLinkAction}>
                  <input type="hidden" name="linkId" value={l.id} />
                  <input type="hidden" name="active" value={l.active ? "no" : "yes"} />
                  <Button type="submit" variant="secondary" size="sm">
                    {l.active ? "Close link" : "Reopen link"}
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}
      <form action={createCaptureLinkAction} className="max-w-3xl space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">New capture link</h2>
        <div className="space-y-1.5">
          <Label htmlFor="c-title">Title</Label>
          <Input id="c-title" name="title" maxLength={120} placeholder={`Share your ${ctx.brand.name} story`} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-pub">Publication</Label>
          <select id="c-pub" name="publicationId" className="pc-control w-full">
            <option value="">Let the reader pick</option>
            {look.publications
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-intro">Intro</Label>
          <Textarea id="c-intro" name="intro" rows={3} maxLength={1000} placeholder="A line or two shown above the form." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-consent">Consent wording</Label>
          <Textarea id="c-consent" name="consentText" rows={4} maxLength={1500} defaultValue={defaultConsentText(ctx.brand.name)} />
          <p className="text-xs text-muted">Shown next to the checkbox and stored word for word with every submission.</p>
        </div>
        <Button type="submit">Create link</Button>
      </form>
    </div>
  );
}
