import { Badge } from "@pubcommand/ui";
import { AutoRefresh } from "../promos/auto-refresh";
import { EMAIL_TYPE_LABELS, hostOf, type EmailExtraction, type EmailType } from "../../../../../modules/intel/index";

export function formatDate(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const TYPE_TONE: Partial<Record<EmailType, "accent" | "ok" | "warn" | "danger" | "neutral">> = {
  promo: "accent",
  renewal: "warn",
  upsell: "warn",
  event: "ok",
};

export function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const label = EMAIL_TYPE_LABELS[type as EmailType] ?? type;
  return <Badge tone={TYPE_TONE[type as EmailType] ?? "neutral"}>{label}</Badge>;
}

export function ExtractionState({ status, error }: { status: string; error: string | null }) {
  if (status === "QUEUED" || status === "RUNNING") {
    return (
      <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
        {status === "QUEUED" ? "Queued for extraction" : "Extracting"} · <AutoRefresh />
      </p>
    );
  }
  if (status === "FAILED") return <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Extraction failed: {error ?? "unknown error"}</p>;
  if (error) return <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">Not extracted: {error}</p>;
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid gap-0.5 border-b border-line py-2 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="pc-break min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink">
          {item}
        </span>
      ))}
    </span>
  );
}

export function ExtractionView({ extraction }: { extraction: EmailExtraction }) {
  const e = extraction;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TypeBadge type={e.type} />
        {e.urgency.level !== "none" ? <Badge tone={e.urgency.level === "high" ? "danger" : "warn"}>{e.urgency.level} urgency</Badge> : null}
      </div>
      {e.summary ? <p className="mb-3 text-sm text-ink">{e.summary}</p> : null}
      <dl>
        <Row label="Headline">{e.headline}</Row>
        <Row label="Big idea">{e.bigIdea}</Row>
        <Row label="Hook">{e.hook}</Row>
        <Row label="Product">{e.product}</Row>
        <Row label="Offer">{e.offer}</Row>
        <Row label="Price">{e.priceText ? <>{e.priceText} <span className="text-xs text-muted">(as stated in the email)</span></> : null}</Row>
        <Row label="Discount">{e.discount}</Row>
        <Row label="Guarantee">{e.guarantee}</Row>
        <Row label="Expert">{e.experts.length ? e.experts.join(", ") : null}</Row>
        <Row label="Call to action">{e.cta}</Row>
        <Row label="Urgency">
          {e.urgency.level !== "none" || e.urgency.tactics.length ? (
            <>
              <Chips items={e.urgency.tactics} />
              {e.urgency.deadline ? <span className="mt-1 block text-xs text-muted">Deadline: {e.urgency.deadline}</span> : null}
            </>
          ) : null}
        </Row>
        <Row label="Landing page">
          {e.landingUrl ? (
            <a href={e.landingUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
              {hostOf(e.landingUrl)}
            </a>
          ) : null}
        </Row>
        <Row label="Angles">{e.angles.length ? <Chips items={e.angles} /> : null}</Row>
        <Row label="Topics">{e.topics.length ? <Chips items={e.topics} /> : null}</Row>
        <Row label="Takeaway">{e.takeaway}</Row>
      </dl>
    </div>
  );
}

export function AiMissingNotice({ what }: { what: string }) {
  return (
    <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
      The AI key is not set, so {what}. Add <code>ANTHROPIC_API_KEY</code> in Railway, then press Extract.
    </p>
  );
}
