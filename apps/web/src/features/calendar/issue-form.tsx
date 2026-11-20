import { Button, Input, Textarea } from "@pubcommand/ui";
import type { LoadedIssue, PublicationView } from "./data";
import type { FormExtras } from "./options";
import { Field, OptionSelect, PromoSelect } from "./ui";

export function IssueForm({
  action,
  publications,
  loaded,
  defaults,
  extras,
}: {
  action: (formData: FormData) => Promise<void>;
  publications: PublicationView[];
  loaded?: LoadedIssue;
  defaults?: { publicationCode?: string; mailDate?: string };
  extras: FormExtras;
}) {
  const i = loaded?.issue;
  const pubs = publications.filter((p) => p.active || p.code === i?.publicationCode);
  return (
    <form action={action} className="space-y-5">
      {i ? <input type="hidden" name="issueId" value={i.id} /> : null}
      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <Field label="Title / topic">
          <Input name="title" required maxLength={200} defaultValue={i?.title ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Publication">
            <select name="publicationCode" className="pc-control w-full" required defaultValue={i?.publicationCode ?? defaults?.publicationCode ?? pubs[0]?.code ?? ""}>
              {pubs.length === 0 ? <option value="">Add a publication under Setup</option> : null}
              {pubs.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mail date">
            <input type="date" name="mailDate" className="pc-control w-full" defaultValue={loaded?.mailDate ?? defaults?.mailDate ?? ""} />
          </Field>
          <OptionSelect name="status" label="Status" options={extras.options["issue.status"]} value={i?.status ?? (extras.options["issue.status"].includes("Planned") ? "Planned" : undefined)} />
          <Field label="Type">
            <Input name="issueType" list="cal-issue-types" maxLength={80} defaultValue={i?.issueType ?? ""} />
          </Field>
        </div>
        <datalist id="cal-issue-types">
          {extras.options["issue.type"].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Writer">
            <Input name="writer" maxLength={120} defaultValue={i?.writer ?? ""} />
          </Field>
          <Field label="Offer">
            <Input name="offer" maxLength={300} defaultValue={i?.offer ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PromoSelect promos={extras.promos} value={i?.calendarPromoId} />
          {extras.tickers ? (
            <Field label="Tickers mentioned" hint="Separate with commas, e.g. NVDA, AAPL. Prices come from market data.">
              <Input name="tickers" maxLength={400} defaultValue={i?.tickers.join(", ") ?? ""} />
            </Field>
          ) : (
            <input type="hidden" name="tickers" value={i?.tickers.join(", ") ?? ""} />
          )}
        </div>
        <Field label="Subject lines" hint="One per line. Used to tell two same-day sends apart when stats are imported.">
          <Textarea name="subjectLines" rows={3} defaultValue={i?.subjectLines.join("\n") ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Web version link">
            <Input name="websiteLink" type="url" inputMode="url" defaultValue={i?.websiteLink ?? ""} />
          </Field>
          <Field label="Call-to-action link">
            <Input name="ctaLink" type="url" inputMode="url" defaultValue={i?.ctaLink ?? ""} />
          </Field>
        </div>
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <Field label="Body or outline">
          <Textarea name="body" rows={10} defaultValue={i?.body ?? ""} />
        </Field>
        <Field label="Notes">
          <Textarea name="notes" rows={4} defaultValue={i?.notes ?? ""} />
        </Field>
      </section>
      <Button type="submit" className="w-full sm:w-auto">
        {i ? "Save" : "Save issue"}
      </Button>
    </form>
  );
}
