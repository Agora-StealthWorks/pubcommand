import { Badge, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import {
  COMPONENT_GROUPS,
  COMPONENT_STATUS_LABEL,
  PACKAGE_COMPONENTS,
  markdownBlocks,
  type ClaimFlag,
  type MdBlock,
  type PackageDirection,
} from "../../../../../modules/promo-studio/packager";
import type { PackageListItem } from "./data";

const STATUS_TONE: Record<string, "neutral" | "warn" | "ok"> = { DRAFT: "neutral", NEEDS_EDITS: "warn", APPROVED: "ok" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{COMPONENT_STATUS_LABEL[status] ?? status}</Badge>;
}

export function GenBadge({ status }: { status: string }) {
  if (status === "QUEUED") return <Badge tone="warn">Queued</Badge>;
  if (status === "RUNNING") return <Badge tone="accent">Writing…</Badge>;
  if (status === "FAILED") return <Badge tone="danger">Failed</Badge>;
  return null;
}

export function FlagSummary({ flags }: { flags: readonly ClaimFlag[] }) {
  const risks = flags.filter((f) => f.severity === "risk").length;
  const checks = flags.length - risks;
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {risks ? <Badge tone="danger">{risks} risky</Badge> : null}
      {checks ? <Badge tone="warn">{checks} to check</Badge> : null}
    </span>
  );
}

export function FlagList({ flags }: { flags: readonly ClaimFlag[] }) {
  if (!flags.length) {
    return <p className="text-sm text-muted">No risky phrases found. This is a simple check, not a legal review.</p>;
  }
  return (
    <ul className="space-y-2">
      {flags.map((flag, index) => (
        <li key={index} className={`rounded-md border px-3 py-2 text-sm ${flag.severity === "risk" ? "border-[#fecdca] bg-[#fef3f2]" : "border-[#fedf89] bg-[#fffaeb]"}`}>
          <p className="font-semibold">
            {flag.severity === "risk" ? "Risky: " : "Check: "}
            <span className="[overflow-wrap:anywhere]">“{flag.phrase}”</span>
          </p>
          <p className="text-xs text-muted">{flag.rule}</p>
          <p className="[overflow-wrap:anywhere] mt-1 text-xs italic">{flag.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}

function Runs({ block }: { block: MdBlock }) {
  return (
    <>
      {block.runs.map((run, index) => (run.bold ? <strong key={index}>{run.text}</strong> : <span key={index}>{run.text}</span>))}
    </>
  );
}

/** Read-only rendering of a component's Markdown (headings, bold labels, bullets, notes). */
export function CopyPreview({ content }: { content: string }) {
  if (!content.trim()) return <p className="text-sm text-muted">Nothing written yet.</p>;
  return (
    <div className="[overflow-wrap:anywhere] space-y-3 text-sm leading-7">
      {markdownBlocks(content).map((block, index) => {
        if (block.type === "h1" || block.type === "h2") return <h3 key={index} className="pt-2 text-base font-semibold"><Runs block={block} /></h3>;
        if (block.type === "h3") return <h4 key={index} className="border-t border-line pt-4 text-sm font-semibold uppercase tracking-wide text-accent first:border-t-0 first:pt-0"><Runs block={block} /></h4>;
        if (block.type === "bullet") return <p key={index} className="pl-4 before:-ml-3 before:mr-2 before:content-['•']"><Runs block={block} /></p>;
        if (block.type === "quote") return <p key={index} className="rounded-md bg-canvas px-3 py-2 text-xs text-muted"><Runs block={block} /></p>;
        return <p key={index} className="whitespace-pre-wrap"><Runs block={block} /></p>;
      })}
    </div>
  );
}

/** Checkbox + quantity for each component, grouped. Event components only when the package has an event. */
export function ComponentPicker({ exclude = [], includeEvent, preselect = true }: { exclude?: readonly string[]; includeEvent: boolean; preselect?: boolean }) {
  const specs = PACKAGE_COMPONENTS.filter((spec) => !exclude.includes(spec.kind) && (includeEvent || !spec.event));
  const groups = COMPONENT_GROUPS.map((group) => ({ group, specs: specs.filter((s) => s.group === group && !s.event) })).filter((g) => g.specs.length);
  const event = specs.filter((s) => s.event);
  const row = (spec: (typeof specs)[number]) => (
    <li key={spec.kind} className="flex items-center justify-between gap-3 py-1.5">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm">
        <input type="checkbox" name={`c_${spec.kind}`} defaultChecked={preselect && !spec.event} className="h-4 w-4 shrink-0" />
        <span className="min-w-0">{spec.label}</span>
      </label>
      {spec.maxQty > 1 ? (
        <input
          type="number"
          name={`q_${spec.kind}`}
          aria-label={`How many ${spec.label}`}
          defaultValue={spec.defaultQty}
          min={spec.minQty}
          max={spec.maxQty}
          className="pc-control w-20 shrink-0 text-sm"
        />
      ) : (
        <span className="w-20 shrink-0 text-center text-xs text-muted">1</span>
      )}
    </li>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map(({ group, specs: list }) => (
        <fieldset key={group}>
          <legend className="text-xs font-semibold uppercase tracking-wider text-muted">{group === "Ad" ? "Ads" : group === "Email" ? "Emails" : group === "Page" ? "Pages" : group}</legend>
          <ul className="divide-y divide-line">{list.map(row)}</ul>
        </fieldset>
      ))}
      {event.length ? (
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-muted">Live event add-on</legend>
          <ul className="divide-y divide-line">{event.map(row)}</ul>
        </fieldset>
      ) : null}
    </div>
  );
}

/** The Package tab on the promo page. */
export function PackageTab({ promoId, packages, writable, analyzed }: { promoId: string; packages: readonly PackageListItem[]; writable: boolean; analyzed: boolean }) {
  return (
    <section className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold">Copy package</h2>
        <p className="mt-1 text-sm text-muted">
          Turn this promo into its launch copy: alternative headlines, lift notes, ads, cart abandon emails, exit popup, order
          form, upsell, an editorial guide and an optional live event set. Each piece is written from this promo, its analysis,
          the brand&apos;s best performers and its Brain, then edited and approved here.
        </p>
        {!analyzed ? <p className="mt-3 text-sm text-[#93370d]">Tip: analyze the promo first. The package is sharper when it can use the analysis.</p> : null}
        {writable ? (
          <Link href={`/promo-studio/${promoId}/package/new`} className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
            {packages.length ? "Start another package" : "Start a package"}
          </Link>
        ) : null}
      </div>
      {packages.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {packages.map((pkg) => (
            <li key={pkg.id}>
              <Link href={`/promo-studio/${promoId}/package/${pkg.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-canvas">
                <span className="min-w-0">
                  <span className="[overflow-wrap:anywhere] block text-sm font-semibold">{pkg.title}</span>
                  <span className="block text-xs text-muted">
                    {pkg.createdAt.toISOString().slice(0, 10)} · {pkg.approved}/{pkg.total} approved
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {pkg.busy ? <Badge tone="accent">Writing {pkg.busy}</Badge> : null}
                  {pkg.failed ? <Badge tone="danger">{pkg.failed} failed</Badge> : null}
                  <Badge tone={pkg.status === "APPROVED" ? "ok" : "neutral"}>{pkg.status === "APPROVED" ? "Approved" : "Draft"}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Angle, tone, length, offer details, notes and the live event. Shared by the new and edit forms. */
export function DirectionFields({ values, eventToggle }: { values?: PackageDirection; eventToggle: boolean }) {
  const v = values;
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="angle">Angle</Label>
        <Textarea id="angle" name="angle" rows={2} maxLength={1000} defaultValue={v?.angle ?? ""} placeholder="Optional. The hook or story to lean on, if not the promo's own" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="tone">Tone</Label>
          <Input id="tone" name="tone" maxLength={300} defaultValue={v?.tone ?? ""} placeholder="Optional, e.g. warm and plain-spoken" />
        </div>
        <div>
          <Label htmlFor="length">Length</Label>
          <select id="length" name="length" className="pc-control w-full" defaultValue={v?.length ?? "standard"}>
            <option value="standard">Standard</option>
            <option value="shorter">Shorter</option>
            <option value="longer">Longer</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="offerDetails">Offer details</Label>
        <Textarea id="offerDetails" name="offerDetails" rows={3} maxLength={4000} defaultValue={v?.offerDetails ?? ""} placeholder="Prices, bonuses, guarantee and deadline for this launch. Figures here count as facts the copy may use." />
      </div>
      <div>
        <Label htmlFor="notes">Other notes</Label>
        <Textarea id="notes" name="notes" rows={2} maxLength={4000} defaultValue={v?.notes ?? ""} placeholder="Optional. Anything else the writer should know" />
      </div>
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-sm font-semibold">Live event</legend>
        {eventToggle ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="withEvent" className="h-4 w-4" defaultChecked={Boolean(v?.event)} />
            This promo leads to a live event (adds the event emails and ads)
          </label>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="eventName">Event name</Label>
            <Input id="eventName" name="eventName" maxLength={200} defaultValue={v?.event?.name ?? ""} />
          </div>
          <div>
            <Label htmlFor="eventDate">Event date and time</Label>
            <Input id="eventDate" name="eventDate" maxLength={100} defaultValue={v?.event?.date ?? ""} placeholder="As readers should see it" />
          </div>
        </div>
      </fieldset>
    </div>
  );
}
