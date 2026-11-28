import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { EMAIL_TYPE_LABELS, FEED_LABELS, PROMO_KIND_LABELS, type Feed, type IspyEmailType, type IspyPromoKind } from "../../../../../modules/ispy/index";
import { qs } from "./org-data";

const TYPE_TONE: Record<string, "accent" | "ok" | "warn" | "danger" | "neutral"> = {
  PROMO: "accent",
  INTERNAL_LIFT: "ok",
  EXTERNAL_LIFT: "warn",
  WELCOME: "neutral",
  EDITORIAL: "neutral",
  OTHER: "neutral",
};

export function IspyTypeBadge({ type }: { type: string }) {
  return <Badge tone={TYPE_TONE[type] ?? "neutral"}>{EMAIL_TYPE_LABELS[type as IspyEmailType] ?? type}</Badge>;
}

const KIND_STYLE: Record<string, string> = {
  INTERNAL: "bg-[#d3f0eb] text-[#0b5248]",
  EXTERNAL: "bg-canvas text-muted",
  AFFILIATE: "bg-[#ebe3ff] text-[#44238f]",
};
const KIND_LABEL: Record<string, string> = { INTERNAL: "Internal", EXTERNAL: "External", AFFILIATE: "Affiliate" };

export function KindBadge({ kind }: { kind: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[kind] ?? KIND_STYLE.EXTERNAL}`}>{KIND_LABEL[kind] ?? kind}</span>;
}

export function PromoKindBadge({ kind }: { kind: string }) {
  return <Badge tone="accent">{PROMO_KIND_LABELS[kind as IspyPromoKind] ?? kind}</Badge>;
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function shortDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** FinPub / Health switch: every feed is shown; one the org can't see opens the locked notice. */
export function FeedSwitcher({ base, feed, params }: { base: string; feed: Feed; params?: Record<string, string | undefined> }) {
  return (
    <div role="group" aria-label="Feed" className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
      {(["FINPUB", "HEALTH"] as const).map((f) => (
        <Link key={f} href={`${base}${qs({ ...(params ?? {}), feed: f })}`} aria-current={f === feed ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${f === feed ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}>
          {FEED_LABELS[f]}
        </Link>
      ))}
    </div>
  );
}

export function FeedLocked({ feed, base }: { feed: Feed; base: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <Badge tone="warn">Not enabled for this organization</Badge>
      <h2 className="mt-2 text-lg font-semibold text-ink">The {FEED_LABELS[feed]} feed isn&apos;t on for your organization</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        ISpy shows the feed that matches your brand&apos;s niche. PubCommand staff can grant the {FEED_LABELS[feed]} feed in the admin console under ISpy › Access.
      </p>
      <Link href={base} className="mt-3 inline-flex min-h-10 items-center rounded-md border border-line px-3 text-sm font-semibold text-ink hover:bg-canvas">
        Back to your feed
      </Link>
    </div>
  );
}

/** A sortable column header: click toggles asc/desc; the active column shows its arrow. */
export function SortLink({ label, column, sort, dir, href, align = "left" }: { label: string; column: string; sort: string; dir: "asc" | "desc"; href: (sort: string, dir: "asc" | "desc") => string; align?: "left" | "right" }) {
  const active = sort === column;
  const next: "asc" | "desc" = active && dir === "desc" ? "asc" : "desc";
  return (
    <Link href={href(column, next)} className={`inline-flex min-h-9 items-center gap-1 text-xs font-bold uppercase tracking-wide ${active ? "text-ink" : "text-muted hover:text-ink"} ${align === "right" ? "justify-end" : ""}`} aria-label={`Sort by ${label}${active ? (dir === "asc" ? ", ascending" : ", descending") : ""}`}>
      {label} <span aria-hidden="true">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </Link>
  );
}

export function TranscriptLine({ status, url, text }: { status: string | null; url: string | null; text: string | null }) {
  if (status === "FOUND" && url) {
    return (
      <p className="text-sm">
        <span className="font-semibold text-ink">Transcript / full page:</span>{" "}
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="pc-break text-accent underline">
          {text || url}
        </a>
      </p>
    );
  }
  return (
    <p className="text-sm text-muted">
      <span className="font-semibold text-ink">Transcript / full page:</span> {status === "UNREADABLE" ? "page could not be read (gated or expired)" : "not detected"}
    </p>
  );
}

export function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
