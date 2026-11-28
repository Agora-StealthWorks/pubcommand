import { Badge } from "@pubcommand/ui";
import { AutoRefresh } from "../promos/auto-refresh";
import Link from "next/link";
import { EMAIL_TYPE_LABELS, ENTITY_LABELS, VIDEO_STEP_LABELS, hostOf, type EmailExtraction, type EmailType, type EntityKind, type VideoStep } from "../../../../../modules/intel/index";

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

export function ExtractionView({ extraction, source = "email" }: { extraction: EmailExtraction; source?: "email" | "video" }) {
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
        <Row label="Price">{e.priceText ? <>{e.priceText} <span className="text-xs text-muted">(as stated in the {source === "video" ? "video or its page" : "email"})</span></> : null}</Row>
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

export function VideoStatusBadge({ status, step }: { status: string; step?: string | null }) {
  if (status === "DONE") return null;
  if (status === "FAILED") return <Badge tone="danger">failed</Badge>;
  if (status === "RUNNING") return <Badge tone="warn">{step ? VIDEO_STEP_LABELS[step as VideoStep]?.toLowerCase() ?? "capturing" : "capturing"}</Badge>;
  return <Badge tone="warn">queued</Badge>;
}

/** The captured landing page (text only). */
export function LandingCard({
  landing,
  children,
}: {
  landing: { url: string; finalUrl: string | null; status: string; title: string | null; description: string | null; headings: string[]; text: string; error: string | null; fetchedAt: Date } | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Landing page</h3>
        {children}
      </div>
      {!landing ? (
        <p className="text-sm text-muted">Not captured yet.</p>
      ) : landing.status !== "OK" ? (
        <p className="pc-break text-sm text-[#912018]">Could not be read: {landing.error ?? "unknown error"}</p>
      ) : (
        <div className="min-w-0 text-sm">
          <a href={landing.finalUrl ?? landing.url} target="_blank" rel="noopener noreferrer nofollow" className="pc-break font-semibold text-accent underline">
            {landing.title ?? hostOf(landing.finalUrl ?? landing.url)}
          </a>
          <p className="pc-break text-xs text-muted">{hostOf(landing.finalUrl ?? landing.url)} · fetched {formatDay(landing.fetchedAt)}</p>
          {landing.description ? <p className="mt-2 text-ink">{landing.description}</p> : null}
          {landing.headings.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink">
              {landing.headings.slice(0, 6).map((heading) => (
                <li key={heading} className="pc-break">
                  {heading}
                </li>
              ))}
            </ul>
          ) : null}
          {landing.text ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-accent">Page text ({Math.round(landing.text.length / 100) / 10}k characters)</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-canvas p-3 font-sans text-xs text-ink">{landing.text.slice(0, 20_000)}</pre>
            </details>
          ) : null}
          {landing.error ? <p className="mt-2 text-xs text-muted">{landing.error}</p> : null}
          <p className="mt-2 text-xs text-muted">Text only, fetched by Intel. Offers and prices are as the page states them.</p>
        </div>
      )}
    </div>
  );
}

/** Experts, list and topics an email or video is linked to; each links to the inbox filtered by it. */
export function EntityChips({ entities, base = "/ispy" }: { entities: Record<EntityKind, { id: string; name: string }[]>; base?: string }) {
  const kinds = (["list", "expert", "topic"] as const).filter((kind) => entities[kind].length);
  if (!kinds.length) return null;
  return (
    <dl className="mt-3 grid gap-1 text-sm">
      {kinds.map((kind) => (
        <div key={kind} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="text-muted">{kind === "list" ? "List" : ENTITY_LABELS[kind].many}</dt>
          <dd className="flex min-w-0 flex-wrap gap-1">
            {entities[kind].map((entity) => (
              <Link key={entity.id} href={`${base}?${kind}=${entity.id}`} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink hover:bg-accent hover:text-white">
                {entity.name}
              </Link>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
