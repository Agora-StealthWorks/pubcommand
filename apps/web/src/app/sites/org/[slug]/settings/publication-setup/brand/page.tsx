import { notFound, redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";

/** Brand defaults moved to Settings → Brands (one per brand). Old links land on the current brand's page. */
export default async function MovedBrandDefaults({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  redirect(ctx.brand ? `/settings/brands/${ctx.brand.id}/branding` : "/settings/brands");
}
