import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { savePublicationBranding } from "@/features/pubsetup/actions";
import { BrandingForm } from "@/features/pubsetup/branding-form";
import { brandDefaultsOwn, inheritedFor, publicationBrandingOwn } from "@/features/pubsetup/data";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { BRANDING_FIELDS } from "@/features/pubsetup/module";
import { getPublication } from "@/features/pubsetup/read";
import { imageUrl } from "@/features/pubsetup/ui";

export default async function PublicationBrandingPage({ params, searchParams }: { params: Promise<{ slug: string; publicationId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, publicationId } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const [own, defaults, pub] = await Promise.all([
    publicationBrandingOwn(ctx.resolved.id, ctx.brand.id, publicationId),
    brandDefaultsOwn(ctx.resolved.id, ctx.brand.id),
    getPublication(ctx.resolved.id, ctx.brand.id, publicationId),
  ]);
  if (!own || !pub) notFound();
  const fields = BRANDING_FIELDS.filter((f) => f.key !== "tagline");
  return (
    <div>
      <Link href={`/settings/publication-setup/publications/${own.id}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← {own.name}
      </Link>
      <h2 className="mb-1 text-lg font-semibold">Branding · {own.name}</h2>
      <p className="mb-4 text-sm text-muted">
        Leave a field blank to use the <Link href={`/settings/brands/${ctx.brand.id}/branding`} className="text-accent hover:underline">brand defaults</Link>. The wiki and other apps use the result.
      </p>
      <Flash error={query.error} notice={query.notice} />
      <BrandingForm
        action={savePublicationBranding}
        hidden={{ publicationId: own.id }}
        fields={fields}
        own={Object.fromEntries(fields.map((f) => [f.key, (own as Record<string, unknown>)[f.key] as string | null]))}
        inherited={inheritedFor("publication", ctx.brand.name, defaults)}
        name={own.name}
        tagline={pub.tagline ?? defaults?.tagline ?? ""}
        inheritLabel="brand"
        logo={{
          own: { light: own.logoMime ? imageUrl("pub-logo", own.id, own.updatedAt) : null, dark: own.logoOnDarkMime ? imageUrl("pub-logo-dark", own.id, own.updatedAt) : null },
          inherited: {
            light: defaults?.logoMime ? imageUrl("brand-logo", ctx.brand.id, defaults.updatedAt) : null,
            dark: defaults?.logoOnDarkMime ? imageUrl("brand-logo-dark", ctx.brand.id, defaults.updatedAt) : null,
          },
        }}
      />
    </div>
  );
}
