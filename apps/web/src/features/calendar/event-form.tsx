import { Button, Input, Textarea } from "@pubcommand/ui";
import { FREQUENCIES, FREQUENCY_LABELS, type SeriesScope } from "../../../../../modules/editorial/recurrence";
import { EVENT_FORMATS, EVENT_STAGES, EVENT_TYPES } from "../../../../../modules/editorial/stages";
import type { ChannelView, LoadedEvent } from "./data";
import { Field } from "./ui";

type Props = {
  action: (formData: FormData) => Promise<void>;
  channels: ChannelView[];
  loaded?: LoadedEvent;
  scope?: SeriesScope;
  defaultDate?: string;
};

const num = (n: number | null | undefined) => (n == null ? "" : String(n));

export function EventForm({ action, channels, loaded, scope = "single", defaultDate }: Props) {
  const e = loaded?.event;
  const d = loaded?.dates;
  const inSeries = Boolean(loaded?.series);
  const showCadence = !inSeries || scope === "following";
  const channelNames = [...new Set([...channels.map((c) => c.name), ...(e?.channels ?? [])])];
  return (
    <form action={action} className="space-y-5">
      {e ? <input type="hidden" name="eventId" value={e.id} /> : null}
      <input type="hidden" name="scope" value={scope} />

      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <Field label="Name">
          <Input name="name" required maxLength={200} defaultValue={e?.name ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Stage">
            <select name="stage" className="pc-control w-full" defaultValue={e?.stage ?? "Idea"}>
              {EVENT_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Event type">
            <Input name="eventType" list="cal-event-types" defaultValue={e?.eventType ?? ""} maxLength={80} />
          </Field>
          <Field label="Format">
            <Input name="format" list="cal-event-formats" defaultValue={e?.format ?? ""} maxLength={80} />
          </Field>
        </div>
        <datalist id="cal-event-types">
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <datalist id="cal-event-formats">
          {EVENT_FORMATS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Dates</h2>
        <p className="text-sm text-muted">The calendar colors three stages: marketing start → event (to its end date, if it runs several days) → marketing end.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Marketing starts">
            <input type="date" name="marketingStart" className="pc-control w-full" defaultValue={d?.marketingStart ?? ""} />
          </Field>
          <Field label="Event date">
            <input type="date" name="eventDate" className="pc-control w-full" defaultValue={d?.eventDate ?? defaultDate ?? ""} />
          </Field>
          <Field label="Event ends" hint="For a multi-day event or open house.">
            <input type="date" name="eventEnd" className="pc-control w-full" defaultValue={d?.eventEnd ?? ""} />
          </Field>
          <Field label="Marketing ends">
            <input type="date" name="marketingEnd" className="pc-control w-full" defaultValue={d?.marketingEnd ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Start time (ET)">
            <input type="time" name="startTime" className="pc-control w-full" defaultValue={e?.startTime ?? ""} />
          </Field>
          <Field label="End time (ET)">
            <input type="time" name="endTime" className="pc-control w-full" defaultValue={e?.endTime ?? ""} />
          </Field>
        </div>
        {showCadence ? (
          <div className="grid gap-4 rounded-lg border border-dashed border-line p-3 sm:grid-cols-2">
            <Field label="Repeats" hint={inSeries ? "Changing this re-plans the occurrences after this one. Earlier ones stay." : "Creates the later occurrences now."}>
              <select name="repeat" className="pc-control w-full" defaultValue={loaded?.series?.active ? loaded.series.frequency : ""}>
                <option value="">Does not repeat</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Repeat until" hint="Leave empty to plan about six months ahead.">
              <input type="date" name="repeatUntil" className="pc-control w-full" defaultValue={loaded?.series?.until ?? ""} />
            </Field>
          </div>
        ) : (
          <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-muted">Editing only this occurrence, so the repeat schedule is not shown and will not change.</p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Details</h2>
        {channelNames.length ? (
          <fieldset>
            <legend className="text-sm font-medium">Channels</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {channelNames.map((name) => (
                <label key={name} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm">
                  <input type="checkbox" name="channels" value={name} defaultChecked={e?.channels.includes(name)} /> {name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-xs text-muted">Add channels or rooms under Setup to tag where events run.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hosts" hint="Separate names with commas.">
            <Input name="hosts" defaultValue={e?.hosts.join(", ") ?? ""} maxLength={600} />
          </Field>
          <Field label="Offer">
            <Input name="offer" defaultValue={e?.offer ?? ""} maxLength={300} />
          </Field>
          <Field label="Promo code">
            <Input name="promoCode" defaultValue={e?.promoCode ?? ""} maxLength={80} />
          </Field>
          <Field label="Call-to-action link">
            <Input name="ctaLink" type="url" inputMode="url" defaultValue={e?.ctaLink ?? ""} />
          </Field>
          <Field label="Registration link">
            <Input name="registrationLink" type="url" inputMode="url" defaultValue={e?.registrationLink ?? ""} />
          </Field>
          <Field label="Replay link">
            <Input name="replayLink" type="url" inputMode="url" defaultValue={e?.replayLink ?? ""} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea name="notes" rows={5} defaultValue={e?.notes ?? ""} />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Results</h2>
        <p className="text-sm text-muted">Numbers for this occurrence only. They are never copied to other occurrences.</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(
            [
              ["peakAttendance", "Peak attendance"],
              ["avgAttendance", "Average attendance"],
              ["registrations", "Registrations"],
              ["newSubscribers", "New subscribers"],
              ["leads", "Leads"],
              ["orders", "Orders"],
              ["revenue", "Revenue ($)"],
              ["messages", "Chat messages"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input name={key} inputMode="decimal" defaultValue={num(e?.[key])} />
            </Field>
          ))}
        </div>
      </section>

      <Button type="submit" className="w-full sm:w-auto">
        {e ? (scope === "following" && inSeries ? `Save this and ${loaded?.followingCount ?? 0} later` : "Save") : "Save event"}
      </Button>
    </form>
  );
}
