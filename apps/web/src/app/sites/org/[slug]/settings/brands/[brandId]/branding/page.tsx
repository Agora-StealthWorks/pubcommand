import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { saveBrandDefaults } from "@/features/pubsetup/actions";
import { BrandingForm } from "@/features/pubsetup/branding-form";
import { brandDefaultsOwn, inheritedFor } from "@/features/pubsetup/data";
import { brandDefaultsPage } from "@/features/pubsetup/guard";
import { BRANDING_FIELDS } from "@/features/pubsetup/module";
import { imageUrl } from "@/features/pubsetup/ui";

/** One brand's defaults (logos, colors, fonts). Every publication of the brand inherits them. */
export default async function BrandDefaultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; brandId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, brandId } = await params;
  const query = await searchParams;
  const access = await brandDefaultsPage(slug, brandId);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const own = await brandDefaultsOwn(ctx.resolved.id, ctx.brand.id);
  return (
    <div className="min-w-0">
      <Link href="/settings/brands" className="text-sm text-accent hover:underline">
        ← Brands
      </Link>
      <h2 className="mb-1 mt-2 text-lg font-semibold">Brand defaults · {ctx.brand.name}</h2>
      <p className="mb-4 text-sm text-muted">
        Every publication of {ctx.brand.name} uses these unless it sets its own. Change them here and every publication that left a field blank follows.
      </p>
      <Flash error={query.error} notice={query.notice} />
      <BrandingForm
        action={saveBrandDefaults}
        hidden={{ brandId: ctx.brand.id }}
        fields={BRANDING_FIELDS}
        own={Object.fromEntries(BRANDING_FIELDS.map((f) => [f.key, own ? ((own as Record<string, unknown>)[f.key] as string | null) : null]))}
        inherited={inheritedFor("brand", ctx.brand.name, null)}
        name={ctx.brand.name}
        tagline=""
        inheritLabel="platform"
        logo={{
          own: { light: own?.logoMime ? imageUrl("brand-logo", ctx.brand.id, own.updatedAt) : null, dark: own?.logoOnDarkMime ? imageUrl("brand-logo-dark", ctx.brand.id, own.updatedAt) : null },
          inherited: { light: null, dark: null },
        }}
      />
    </div>
  );
}
