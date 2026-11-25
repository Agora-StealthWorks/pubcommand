import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { submitPublicTestimonialAction } from "@/features/testimonials/actions";
import { captureLinkByToken } from "@/features/testimonials/server";
import { LIMITS } from "../../../../../../../../../modules/testimonials/testimonials";

export default async function PublicTestimonialPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { slug, token } = await params;
  const query = await searchParams;
  const found = await captureLinkByToken(slug, token);
  if (!found) notFound();
  const { link, brand, publications } = found;
  const fixedPub = link.publicationId ? publications.find((p) => p.id === link.publicationId) : null;

  if (query.done) {
    return (
      <div className="rounded-xl border border-line bg-white p-6 text-center">
        <h1 className="text-xl font-semibold">Thank you</h1>
        <p className="mt-2 text-sm text-muted">We got your story. Someone at {brand.name} will read it soon.</p>
      </div>
    );
  }
  if (!link.active) {
    return (
      <div className="rounded-xl border border-line bg-white p-6 text-center">
        <h1 className="text-xl font-semibold">{link.title}</h1>
        <p className="mt-2 text-sm text-muted">This form is closed.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{fixedPub ? `${brand.name} · ${fixedPub.name}` : brand.name}</p>
        <h1 className="mt-1 text-2xl font-semibold [overflow-wrap:anywhere]">{link.title}</h1>
        {link.intro ? <p className="mt-2 whitespace-pre-line text-sm text-muted">{link.intro}</p> : null}
      </header>
      {query.error ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{query.error}</p> : null}
      <form action={submitPublicTestimonialAction} className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <input type="hidden" name="token" value={token} />
        <div className="hidden" aria-hidden>
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Your name or initials *</Label>
          <Input id="p-name" name="displayName" required maxLength={LIMITS.displayName} autoComplete="name" placeholder="e.g. Mark T." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-location">City or state</Label>
          <Input id="p-location" name="location" maxLength={LIMITS.location} autoComplete="address-level2" />
        </div>
        {!fixedPub && publications.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="p-pub">Which publication?</Label>
            <select id="p-pub" name="publicationId" className="pc-control w-full" defaultValue="">
              <option value="">Not sure / several</option>
              {publications.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="p-quote">In a sentence or two, what would you tell a friend? *</Label>
          <Textarea id="p-quote" name="quote" required rows={3} maxLength={LIMITS.quote} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-body">Tell us more (optional)</Label>
          <Textarea id="p-body" name="body" rows={5} maxLength={LIMITS.body} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-result">{brand.niche === "health" ? "How do you feel now? (optional)" : "What changed for you? (optional)"}</Label>
          <Input id="p-result" name="resultClaimed" maxLength={LIMITS.resultClaimed} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-email">Email (optional, never published)</Label>
          <Input id="p-email" name="contactEmail" type="email" maxLength={LIMITS.email} autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-photo">Photo (optional)</Label>
          <input id="p-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-line bg-canvas p-3 text-sm">
          <input type="checkbox" name="consent" value="yes" required className="mt-1 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line [overflow-wrap:anywhere]">{link.consentText}</span>
        </label>
        <Button type="submit" className="w-full sm:w-auto">
          Send my story
        </Button>
      </form>
    </div>
  );
}
