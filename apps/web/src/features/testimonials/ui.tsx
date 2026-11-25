import type { Niche } from "@pubcommand/core";
import { Badge, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { TableScroll } from "@/components/table-scroll";
import { CHANNELS, CHANNEL_LABELS, LIMITS, STATUS_LABELS, filtersToQuery, type Channel, type Filters, type Flag, type Status } from "../../../../../modules/testimonials/testimonials";
import type { TestimonialRow } from "./server";

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "approved" ? "ok" : status === "rejected" ? "danger" : "warn";
  return <Badge tone={tone}>{STATUS_LABELS[status as Status] ?? status}</Badge>;
}

export function FlagList({ flags }: { flags: Flag[] }) {
  if (!flags.length) return <p className="text-sm text-muted">No rule-based flags.</p>;
  return (
    <ul className="space-y-2">
      {flags.map((f) => (
        <li key={f.code} className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm">
          <span className="font-semibold text-[#b54708]">{f.label}</span>
          {f.matches.length ? <span className="block text-xs text-[#93370d] [overflow-wrap:anywhere]">Found: {f.matches.map((m) => `“${m}”`).join(", ")}</span> : null}
        </li>
      ))}
    </ul>
  );
}

type Option = { id: string; name: string; code?: string };

export type FieldDefaults = Partial<{
  displayName: string;
  location: string | null;
  quote: string;
  body: string | null;
  resultClaimed: string | null;
  givenOn: string | null;
  channel: string;
  rating: number | null;
  tags: string[];
  videoUrl: string | null;
  contactEmail: string | null;
  publicationId: string | null;
  editorId: string | null;
}>;

/** The shared manual-entry / edit fields. */
/** What the "result" field asks for, per niche. Health testimonials never talk about money. */
const RESULT_FIELD: Record<Niche, { label: string; placeholder: string; hint: string }> = {
  finance: { label: "Result claimed", placeholder: "As they said it, e.g. \"Made back the subscription in a month\"", hint: "Any gain or return is checked against the track record before approval." },
  health: { label: "How they feel now", placeholder: "As they said it, e.g. \"Sleeping through the night after 3 weeks\"", hint: "How the reader feels or what changed for them. Never money made: health testimonials claim no financial gains." },
  general: { label: "Result claimed", placeholder: "As they said it", hint: "" },
};

export function TestimonialFields({ values = {}, publications, editors, niche = "general" }: { values?: FieldDefaults; publications: Option[]; editors: Option[]; niche?: Niche }) {
  const result = RESULT_FIELD[niche];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="t-name">Name or initials *</Label>
        <Input id="t-name" name="displayName" required maxLength={LIMITS.displayName} defaultValue={values.displayName ?? ""} placeholder="e.g. Mark T." />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-location">Location</Label>
        <Input id="t-location" name="location" maxLength={LIMITS.location} defaultValue={values.location ?? ""} placeholder="City or state" />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="t-quote">Quote *</Label>
        <Textarea id="t-quote" name="quote" required rows={3} maxLength={LIMITS.quote} defaultValue={values.quote ?? ""} />
        <p className="text-xs text-muted">The short line you would quote. Use the person&apos;s own words.</p>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="t-body">Full text</Label>
        <Textarea id="t-body" name="body" rows={5} maxLength={LIMITS.body} defaultValue={values.body ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="t-result">{result.label}</Label>
        <Input id="t-result" name="resultClaimed" maxLength={LIMITS.resultClaimed} defaultValue={values.resultClaimed ?? ""} placeholder={result.placeholder} />
        {result.hint ? <p className="text-xs text-muted">{result.hint}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-pub">Publication</Label>
        <select id="t-pub" name="publicationId" defaultValue={values.publicationId ?? ""} className="pc-control w-full">
          <option value="">Not set</option>
          {publications.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.code ? ` (${p.code})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-editor">Editor</Label>
        <select id="t-editor" name="editorId" defaultValue={values.editorId ?? ""} className="pc-control w-full">
          <option value="">Not set</option>
          {editors.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-date">Date given</Label>
        <Input id="t-date" name="givenOn" type="date" defaultValue={values.givenOn ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-channel">Source / channel</Label>
        <select id="t-channel" name="channel" defaultValue={values.channel ?? "email"} className="pc-control w-full">
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-rating">Rating</Label>
        <select id="t-rating" name="rating" defaultValue={values.rating ? String(values.rating) : ""} className="pc-control w-full">
          <option value="">No rating</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} star{n === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-tags">Tags</Label>
        <Input id="t-tags" name="tags" defaultValue={(values.tags ?? []).join(", ")} placeholder="Comma separated" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-video">Video link</Label>
        <Input id="t-video" name="videoUrl" inputMode="url" maxLength={LIMITS.url} defaultValue={values.videoUrl ?? ""} placeholder="https://" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-email">Contact email (private)</Label>
        <Input id="t-email" name="contactEmail" type="email" maxLength={LIMITS.email} defaultValue={values.contactEmail ?? ""} />
        <p className="text-xs text-muted">For verification only. Never shown in the wiki or sent to the Brain.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-photo">Photo</Label>
        <input id="t-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="t-shot">Screenshot (proof)</Label>
        <input id="t-shot" name="screenshot" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
      </div>
    </div>
  );
}

export function ConsentFields({ required }: { required?: boolean }) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold">Consent</legend>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" name="consent" value="yes" required={required} className="mt-1 h-4 w-4" />
        <span>The person gave permission to publish this testimonial.</span>
      </label>
      <Input name="consentNote" maxLength={500} placeholder="How? e.g. replied “yes” to our email on Nov 3" aria-label="How consent was given" />
      <p className="text-xs text-muted">Without consent a testimonial can be saved but never approved.</p>
    </fieldset>
  );
}

type FilterOptions = { publications: Option[]; editors: Option[] };

export function FilterBar({ filters, options, base, lockedPub }: { filters: Filters; options: FilterOptions; base: string; lockedPub?: boolean }) {
  return (
    <form method="get" action={base} className="grid gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      {filters.status !== "all" ? <input type="hidden" name="status" value={filters.status} /> : null}
      <input name="q" type="search" defaultValue={filters.q} placeholder="Search words, names, places…" aria-label="Search" className="pc-control w-full sm:col-span-2" />
      {lockedPub ? null : (
        <select name="pub" defaultValue={filters.pub ?? ""} aria-label="Publication" className="pc-control w-full">
          <option value="">All publications</option>
          {options.publications.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <select name="editor" defaultValue={filters.editor ?? ""} aria-label="Editor" className="pc-control w-full">
        <option value="">All editors</option>
        {options.editors.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <select name="channel" defaultValue={filters.channel ?? ""} aria-label="Channel" className="pc-control w-full">
        <option value="">All channels</option>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABELS[c]}
          </option>
        ))}
      </select>
      <input name="tag" defaultValue={filters.tag ?? ""} placeholder="Tag" aria-label="Tag" className="pc-control w-full" />
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
        From
        <input name="from" type="date" defaultValue={filters.from ?? ""} className="pc-control min-w-0 flex-1" />
      </label>
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
        To
        <input name="to" type="date" defaultValue={filters.to ?? ""} className="pc-control min-w-0 flex-1" />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="flagged" value="1" defaultChecked={filters.flagged} className="h-4 w-4" />
        Flagged only
      </label>
      <div className="flex gap-2">
        <button type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
          Filter
        </button>
        <Link href={`${base}${filters.status !== "all" ? `?status=${filters.status}` : ""}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm">
          Clear
        </Link>
      </div>
    </form>
  );
}

export function StatusTabs({ filters, counts, base }: { filters: Filters; counts: Record<string, number>; base: string }) {
  const tabs: [Filters["status"], string][] = [
    ["all", "All"],
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
  ];
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto text-sm" role="tablist" aria-label="Status">
      {tabs.map(([key, label]) => {
        const query = filtersToQuery({ ...filters, status: key, page: 1 });
        return (
          <Link
            key={key}
            href={`${base}${query ? `?${query}` : ""}`}
            role="tab"
            aria-selected={filters.status === key}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 font-medium ${filters.status === key ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"}`}
          >
            {label} · {counts[key] ?? 0}
          </Link>
        );
      })}
    </div>
  );
}

export function TestimonialTable({ rows, wikiLinks }: { rows: TestimonialRow[]; wikiLinks: boolean }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">No testimonials match.</p>;
  return (
    <div className="rounded-xl border border-line bg-white">
      <TableScroll>
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Who</th>
              <th className="px-3 py-2 font-semibold">Quote</th>
              <th className="px-3 py-2 font-semibold">Publication</th>
              <th className="px-3 py-2 font-semibold">Editor</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Channel</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((t) => (
              <tr key={t.id} className="align-top hover:bg-canvas/60">
                <td className="px-3 py-2.5">
                  <Link href={`/testimonials/${t.id}`} className="font-semibold text-accent hover:underline">
                    {t.displayName}
                  </Link>
                  {t.location ? <span className="block text-xs text-muted">{t.location}</span> : null}
                </td>
                <td className="max-w-[340px] px-3 py-2.5">
                  <span className="line-clamp-3">{t.quote}</span>
                  {t.resultClaimed ? <span className="mt-1 block text-xs text-muted">Result: {t.resultClaimed}</span> : null}
                  {t.tags.length ? <span className="mt-1 block text-xs text-muted">#{t.tags.join(" #")}</span> : null}
                </td>
                <td className="px-3 py-2.5">
                  {t.publication ? (
                    wikiLinks ? (
                      <Link href={`/wiki/publications/${t.publication.slug}`} className="hover:text-accent hover:underline">
                        {t.publication.name}
                      </Link>
                    ) : (
                      t.publication.name
                    )
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {t.editor ? (
                    wikiLinks ? (
                      <Link href={`/wiki/editors/${t.editor.slug}`} className="hover:text-accent hover:underline">
                        {t.editor.name}
                      </Link>
                    ) : (
                      t.editor.name
                    )
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{t.givenOn ?? "None"}</td>
                <td className="px-3 py-2.5 text-muted">{CHANNEL_LABELS[t.channel as Channel] ?? t.channel}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge status={t.status} />
                    {t.flags.length ? <Badge tone="warn">{t.flags.length} flag{t.flags.length === 1 ? "" : "s"}</Badge> : null}
                    {!t.consentGiven ? <Badge tone="danger">No consent</Badge> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

export function Pager({ filters, total, pageSize, base }: { filters: Filters; total: number; pageSize: number; base: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (page: number) => `${base}?${filtersToQuery({ ...filters, page })}`;
  return (
    <nav className="flex items-center justify-between text-sm" aria-label="Pages">
      {filters.page > 1 ? <Link href={href(filters.page - 1)} className="inline-flex min-h-11 items-center text-accent">← Newer</Link> : <span />}
      <span className="text-muted">
        Page {filters.page} of {pages}
      </span>
      {filters.page < pages ? <Link href={href(filters.page + 1)} className="inline-flex min-h-11 items-center text-accent">Older →</Link> : <span />}
    </nav>
  );
}
