import { notFound } from "next/navigation";
import { roundByToken, roundReviews } from "@/features/calendar/cub";
import { CubRoundBody } from "@/features/calendar/cub-view";

export default async function CubOwnerPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const found = await roundByToken(slug, "owner", token);
  if (!found) notFound();
  const { averages, reviews } = await roundReviews(found.organization.id, found.round.id);
  const base = `/p/cub/o/${token}`;
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{found.brandName} · CUB revisions</p>
        <h1 className="mt-1 break-words [overflow-wrap:anywhere] text-2xl font-semibold">{found.round.promoName}</h1>
      </header>
      <CubRoundBody round={found.round} averages={averages} reviews={reviews} hrefs={{ draft: `${base}/draft`, file: (id) => `${base}/files/${id}`, zip: `${base}/zip` }} />
    </div>
  );
}
