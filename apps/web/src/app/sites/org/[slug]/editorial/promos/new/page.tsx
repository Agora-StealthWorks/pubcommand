import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { calendarPage } from "@/features/calendar/context";
import { loadOptions } from "@/features/calendar/options";
import { createPromoAction } from "@/features/calendar/promo-actions";
import { PromoForm } from "@/features/calendar/promo-form";
import { getPickerOptions } from "@/features/pubsetup/read";

export default async function NewPromoPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  if (!ctx.canWrite) return <Denied />;
  const [options, picks] = await Promise.all([loadOptions(ctx.resolved.id, ctx.brand.id), getPickerOptions(ctx.resolved.id, ctx.brand.id)]);
  return (
    <div className="max-w-4xl space-y-4">
      <Flash error={query.error} />
      <h2 className="text-xl font-semibold">New promo</h2>
      <PromoForm action={createPromoAction} stages={options["promo.stage"]} publications={picks.publications} editors={picks.editors} />
    </div>
  );
}
