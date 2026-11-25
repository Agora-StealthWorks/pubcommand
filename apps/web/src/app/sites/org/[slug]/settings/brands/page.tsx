import { brandProfile, can, NICHE_LABELS, NICHES } from "@pubcommand/core";
import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import Link from "next/link";
import { canManagePublications } from "@/features/pubsetup/module";
import { getOrgContext } from "@/lib/org";
import { createBrand, deleteBrand, updateBrand } from "@/server/org-actions";
import { saveBrandSenderAction } from "@/features/email/actions";
import { getSender } from "@/features/email/org-email";
import { SenderForm } from "@/features/email/sender-form";

function BrandFields({ id, niche, audience, complianceNotes }: { id: string; niche?: string; audience?: string | null; complianceNotes?: string | null }) {
  const defaults = brandProfile({ name: "", niche: niche ?? "general" });
  return (
    <>
      <div>
        <Label htmlFor={`niche-${id}`}>Niche</Label>
        <select id={`niche-${id}`} name="niche" defaultValue={niche ?? "general"} className="pc-control mt-1 w-full">
          {NICHES.map((value) => (
            <option key={value} value={value}>
              {NICHE_LABELS[value]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Sets the AI&apos;s default reader and compliance rules, and which apps show (charts and track records are finance only).</p>
      </div>
      <div>
        <Label htmlFor={`audience-${id}`}>Who you write for</Label>
        <Textarea id={`audience-${id}`} name="audience" rows={2} maxLength={1000} defaultValue={audience ?? ""} placeholder={defaults.audience} />
      </div>
      <div>
        <Label htmlFor={`compliance-${id}`}>Extra compliance rules (one per line)</Label>
        <Textarea id={`compliance-${id}`} name="complianceNotes" rows={3} maxLength={2000} defaultValue={complianceNotes ?? ""} placeholder="e.g. Always include the FDA disclaimer" />
        <p className="mt-1 text-xs text-muted">Added to the defaults for this niche: {defaults.complianceRules.join(" ")}</p>
      </div>
    </>
  );
}

export default async function BrandsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.manage", ctx.scope)) return <Denied />;
  const pubsetupOn = ctx.subject.entitledModuleIds.includes("pubsetup");
  const senders = new Map(await Promise.all(ctx.brands.map(async (brand) => [brand.id, await getSender(ctx.resolved.id, "brand", brand.id)] as const)));
  return (
    <div className="max-w-2xl min-w-0">
      <PageHeader
        title="Brands"
        description="One brand per publisher. Each brand has its own app data and mini-brain. Switch brands from the menu in the sidebar."
      />
      <Flash error={query.error} notice={query.notice} />
      <div className="space-y-4">
        {ctx.brands.map((brand) => (
          <details key={brand.id} className="rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3">
              <span className="font-semibold">{brand.name}</span>
              <span className="text-xs text-muted">{NICHE_LABELS[brandProfile(brand).niche]}</span>
            </summary>
            <form action={updateBrand} className="space-y-3 border-t border-line px-4 py-4">
              <input type="hidden" name="brandId" value={brand.id} />
              <div>
                <Label htmlFor={`name-${brand.id}`}>Name</Label>
                <Input id={`name-${brand.id}`} name="name" defaultValue={brand.name} maxLength={80} required />
              </div>
              <BrandFields id={brand.id} niche={brand.niche} audience={brand.audience} complianceNotes={brand.complianceNotes} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" className="w-full sm:w-auto">
                  Save brand
                </Button>
                {pubsetupOn && canManagePublications(ctx.subject, { ...ctx.scope, brandId: brand.id }) ? (
                  <Link href={`/settings/brands/${brand.id}/branding`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
                    Brand defaults: logos, colors, fonts →
                  </Link>
                ) : null}
              </div>
            </form>
            <div className="border-t border-line px-4 py-4" id={`email-${brand.id}`}>
              <h3 className="text-sm font-semibold">Email sender</h3>
              <p className="mb-3 mt-1 text-xs text-muted">
                Who reader emails from this brand&apos;s websites come from. Blank fields use the default in{" "}
                <Link href="/settings/email" className="font-semibold text-accent">Settings → Email</Link>.
              </p>
              <SenderForm
                id={`brand-${brand.id}`}
                action={saveBrandSenderAction}
                hidden={{ brandId: brand.id }}
                value={senders.get(brand.id) ?? { fromName: null, fromAddress: null, replyTo: null }}
                placeholders={{ fromName: brand.name }}
              />
            </div>
            {ctx.brands.length > 1 ? (
              <form action={deleteBrand} className="space-y-3 border-t border-line px-4 py-4">
                <input type="hidden" name="brandId" value={brand.id} />
                <h3 className="text-sm font-semibold text-[#b42318]">Remove brand</h3>
                <p className="text-xs text-muted">
                  Permanently deletes {brand.name} and everything in it: promos, calendar, brain notes, forms, websites, testimonials and other app data. This cannot be undone.
                </p>
                <div>
                  <Label htmlFor={`confirm-${brand.id}`}>Type {brand.name} to confirm</Label>
                  <Input id={`confirm-${brand.id}`} name="confirmName" autoComplete="off" required maxLength={80} />
                </div>
                <Button type="submit" variant="danger" className="w-full sm:w-auto">
                  Remove {brand.name}
                </Button>
              </form>
            ) : null}
          </details>
        ))}
      </div>
      <form action={createBrand} className="mt-6 space-y-3 rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-semibold">Add a brand</h2>
        <div>
          <Label htmlFor="new-brand-name">Name</Label>
          <Input id="new-brand-name" name="name" placeholder="Publisher name" required maxLength={80} />
        </div>
        <BrandFields id="new" />
        <Button type="submit" className="w-full sm:w-auto">
          Add brand
        </Button>
      </form>
    </div>
  );
}
