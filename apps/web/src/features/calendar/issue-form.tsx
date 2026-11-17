import { Button, Input, Textarea } from "@pubcommand/ui";
import { ISSUE_STATUSES, ISSUE_TYPES } from "../../../../../modules/editorial/stages";
import type { LoadedIssue, PublicationView } from "./data";
import { Field } from "./ui";

export function IssueForm({
  action,
  publications,
  loaded,
  defaults,
}: {
  action: (formData: FormData) => Promise<void>;
  publications: PublicationView[];
  loaded?: LoadedIssue;
  defaults?: { publicationCode?: string; mailDate?: string };
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
          <Field label="Status">
            <select name="status" className="pc-control w-full" defaultValue={i?.status ?? "Planned"}>
              {ISSUE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <Input name="issueType" list="cal-issue-types" maxLength={80} defaultValue={i?.issueType ?? ""} />
          </Field>
        </div>
        <datalist id="cal-issue-types">
          {ISSUE_TYPES.map((t) => (
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
