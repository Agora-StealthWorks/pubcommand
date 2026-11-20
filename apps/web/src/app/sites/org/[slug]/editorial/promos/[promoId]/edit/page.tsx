import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { calendarPage } from "@/features/calendar/context";
import { loadOptions } from "@/features/calendar/options";
import { updatePromoAction } from "@/features/calendar/promo-actions";
import { PromoForm } from "@/features/calendar/promo-form";
import { findPromo } from "@/features/calendar/promos";
import { getPickerOptions } from "@/features/pubsetup/read";

export default async function EditPromoPage({ params, searchParams }: { params: Promise<{ slug: string; promoId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, promoId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  if (!ctx.canWrite) return <Denied />;
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, promoId);
  if (!promo) notFound();
  const [options, picks] = await Promise.all([loadOptions(ctx.resolved.id, ctx.brand.id), getPickerOptions(ctx.resolved.id, ctx.brand.id)]);
  return (
    <div className="max-w-4xl space-y-4">
      <Flash error={query.error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-words [overflow-wrap:anywhere] text-xl font-semibold">Edit · {promo.name}</h2>
        <Link href={`/editorial/promos/${promo.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
          Cancel
        </Link>
      </div>
      <PromoForm action={updatePromoAction} promo={promo} stages={options["promo.stage"]} publications={picks.publications} editors={picks.editors} />
    </div>
  );
}
