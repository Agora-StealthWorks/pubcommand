import { redirect } from "next/navigation";

/** The package list lives on the promo page's Package tab. */
export default async function PackageIndex({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;
  redirect(`/promo-studio/${promoId}?tab=package`);
}
