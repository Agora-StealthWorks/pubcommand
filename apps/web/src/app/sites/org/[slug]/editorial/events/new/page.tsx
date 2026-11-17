import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createEventAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { loadFormExtras } from "@/features/calendar/options";
import { listChannels } from "@/features/calendar/data";
import { EventForm } from "@/features/calendar/event-form";
import { isDay } from "../../../../../../../../../../modules/editorial/dates";

export default async function NewEventPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string; error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const extras = await loadFormExtras(ctx.resolved.id, ctx.brand);
  if (!ctx.canWrite) return <Denied title="You can view the calendar but not add events" />;
  const channels = await listChannels(ctx.resolved.id, ctx.brand.id);
  return (
    <div className="max-w-4xl">
      <h2 className="mb-3 text-xl font-semibold">New event</h2>
      <Flash error={query.error} />
      <EventForm extras={extras} action={createEventAction} channels={channels} defaultDate={isDay(query.date) ? query.date : undefined} />
    </div>
  );
}
