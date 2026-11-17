import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { updateEventAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { listChannels, loadEvent } from "@/features/calendar/data";
import { EventForm } from "@/features/calendar/event-form";
import { normalizeScope } from "../../../../../../../../../../../modules/editorial/recurrence";

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventId: string }>;
  searchParams: Promise<{ scope?: string; error?: string }>;
}) {
  const { slug, eventId } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  if (!ctx.canWrite) return <Denied title="You can view the calendar but not edit events" />;
  const [loaded, channels] = await Promise.all([loadEvent(ctx.resolved.id, ctx.brand.id, eventId), listChannels(ctx.resolved.id, ctx.brand.id)]);
  if (!loaded) notFound();
  const scope = loaded.series ? normalizeScope(query.scope) : "single";
  const base = `/editorial/events/${loaded.event.id}/edit`;
  return (
    <div className="max-w-4xl">
      <p className="mb-2 text-sm">
        <Link href={`/editorial/events/${loaded.event.id}`} className="font-medium text-accent">
          ← Back to event
        </Link>
      </p>
      <h2 className="mb-3 break-words [overflow-wrap:anywhere] text-xl font-semibold">Edit {loaded.event.name}</h2>
      <Flash error={query.error} />
      {loaded.series ? (
        <div className="mb-4 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] p-4 text-sm text-[#1e3a8a]">
          <p className="font-semibold">This event repeats. What should this edit change?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href={`${base}?scope=single`}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 font-semibold ${scope === "single" ? "border-accent bg-accent text-white" : "border-line bg-white text-ink"}`}
            >
              Only this occurrence
            </Link>
            <Link
              href={`${base}?scope=following`}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 font-semibold ${scope === "following" ? "border-accent bg-accent text-white" : "border-line bg-white text-ink"}`}
            >
              This and {loaded.followingCount} later
            </Link>
          </div>
          <p className="mt-2 text-xs">
            {scope === "single"
              ? "Only this date changes. The schedule and the other occurrences stay as they are."
              : "Name, type, stage, channels, hosts, offer, links and notes copy to later occurrences. Their own dates and results never do; if you move this event's date, later ones move by the same number of days. Past occurrences are never changed."}
          </p>
        </div>
      ) : null}
      <EventForm action={updateEventAction} channels={channels} loaded={loaded} scope={scope} />
    </div>
  );
}
