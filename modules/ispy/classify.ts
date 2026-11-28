/**
 * Sorting an email without AI where possible: which publisher sent it, which list
 * it might belong to (masthead and sender signals, from iSpy), whether it is an
 * internal, external or affiliate send, and whether a lift is internal or external.
 */
import { decodeEntities } from "../intel/mime";
import { canonListName, cleanListName, isHotlistSignal, isPlausibleNewListName } from "./list-name";
import type { IspyEmailType, ListCategory, SendKind } from "./types";

export type PublisherMatchRow = { id: string; fromAddresses: readonly string[]; domains: readonly string[]; type: string };

/** iSpy's sender match: an exact address wins, else the longest matching domain (subdomains count). */
export function matchPublisher<T extends PublisherMatchRow>(fromAddress: string, publishers: readonly T[]): { publisher: T; by: "address" | "domain" } | null {
  const address = fromAddress.toLowerCase().trim();
  const domain = address.split("@")[1] ?? "";
  for (const p of publishers) if (p.fromAddresses.some((a) => a.toLowerCase() === address)) return { publisher: p, by: "address" };
  let best: { publisher: T; length: number } | null = null;
  for (const p of publishers) {
    for (const d of p.domains) {
      const want = d.toLowerCase().replace(/^@/, "");
      if (want && (domain === want || domain.endsWith(`.${want}`)) && (!best || want.length > best.length)) best = { publisher: p, length: want.length };
    }
  }
  return best ? { publisher: best.publisher, by: "domain" } : null;
}

/** Masthead text: the email's own brand at the top (title, image alts, first headings). */
export function mastheadSignals(html: string | null, subject: string): string[] {
  if (!html) return [];
  const top = html.slice(0, 6000);
  const out: string[] = [];
  const keep = (v: string) => {
    const clean = cleanListName(decodeEntities(v.replace(/<[^>]+>/g, " ")));
    if (isPlausibleNewListName(clean, subject) && !out.some((o) => canonListName(o) === canonListName(clean))) out.push(clean);
  };
  const title = top.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) keep(title);
  const skip = ["logo", "banner", "header", "image", "photo", "unsubscribe", "view", "spacer", "pixel"];
  for (const m of [...top.matchAll(/\balt=["']([^"']{3,60})["']/gi)].slice(0, 8)) if (!skip.some((s) => m[1]!.toLowerCase().includes(s))) keep(m[1]!);
  for (const m of [...top.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].slice(0, 3)) keep(m[1]!);
  return out.slice(0, 5);
}

/** A list name implied by the sender or a welcome subject ("Welcome to Altucher Confidential"). */
export function listNameFromSender(subject: string, fromAddress: string): string | null {
  const welcome = subject.match(/^(?:you'?re in!?\s*)?welcome\s+to\s+(?:the\s+)?(.+?)(?:\s+(?:family|newsletter|community)\b.*)?[!🎉.]*$/i);
  if (welcome) {
    const candidate = welcome[1]!.trim();
    if (isPlausibleNewListName(candidate, "")) return cleanListName(candidate);
  }
  const local = fromAddress.split("@")[0] ?? "";
  if (local.length > 4 && local.length < 40 && /^[A-Z]/.test(local)) {
    const spaced = local.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
    if (spaced.includes(" ") && spaced.length > 5) return spaced;
  }
  return null;
}

export type ListMatchRow = { id: string; name: string; synonyms: readonly string[]; publisherId: string; isIgnored: boolean };

/** An existing list whose name or synonym equals one of the signals (same publisher first). */
export function matchListBySignals<T extends ListMatchRow>(signals: readonly string[], lists: readonly T[], publisherId: string | null): T | null {
  const wanted = new Set(signals.map(canonListName).filter(Boolean));
  if (!wanted.size) return null;
  const hits = lists.filter((l) => !l.isIgnored && [l.name, ...l.synonyms].some((n) => wanted.has(canonListName(n))));
  return hits.find((l) => l.publisherId === publisherId) ?? hits[0] ?? null;
}

/** The list type to suggest for a new candidate. */
export function suggestListCategory(name: string, fromAddress: string, publisherType: string | null): ListCategory {
  if (publisherType === "AFFILIATE") return "MARKETING_FILE";
  if (isHotlistSignal(name, fromAddress)) return "HOTLIST";
  if (/\b(vip|alert|alerts|pro|premium|inner circle|members?|club|insider)\b/i.test(name)) return "PAID_EDITORIAL";
  if (/\b(partners?|sponsored|special offers?|offers)\b/i.test(name)) return "MARKETING_FILE";
  return "FREE_EDITORIAL";
}

/** A stable key so the same unknown list keeps adding to one candidate. */
export function candidateKey(publisherId: string | null, name: string): string {
  return `${publisherId ?? "none"}:${canonListName(name)}`;
}

/** Ownership chain used by the lift rule: a publication, its publisher and that publisher's group. */
export type Owner = { publicationId: string | null; publisherId: string | null; groupId: string | null };

/**
 * Promo vs internal lift vs external lift, decided by who owns the landing page.
 * - same publication (or same publisher when the advertiser has no publication) → PROMO
 * - same publisher or same group → INTERNAL_LIFT
 * - anyone else → EXTERNAL_LIFT
 * Returns null when the advertiser is unknown (the AI fallback decides then).
 */
export function liftType(sender: Owner, advertiser: Owner | null): IspyEmailType | null {
  if (!advertiser || !advertiser.publisherId) return null;
  if (sender.publicationId && advertiser.publicationId && sender.publicationId === advertiser.publicationId) return "PROMO";
  if (sender.publisherId === advertiser.publisherId) return advertiser.publicationId && sender.publicationId && advertiser.publicationId !== sender.publicationId ? "INTERNAL_LIFT" : "PROMO";
  const senderGroup = sender.groupId ?? sender.publisherId;
  const advertiserGroup = advertiser.groupId ?? advertiser.publisherId;
  if (senderGroup && senderGroup === advertiserGroup) return "INTERNAL_LIFT";
  return "EXTERNAL_LIFT";
}

/** Map the AI's single-call type hint onto ISpy's types when the lift rule can't decide. */
export function typeFromHint(hint: string | null | undefined, opts: { promotedBrandIsSender: boolean | null; promotedBrandIsSameGroup: boolean | null }): IspyEmailType {
  switch ((hint ?? "").toLowerCase()) {
    case "editorial":
      return "EDITORIAL";
    case "welcome":
      return "WELCOME";
    case "promo":
      return "PROMO";
    case "lift":
      if (opts.promotedBrandIsSender) return "PROMO";
      if (opts.promotedBrandIsSameGroup) return "INTERNAL_LIFT";
      return "EXTERNAL_LIFT";
    default:
      return "OTHER";
  }
}

/** The send kind of an email, from the mailer's point of view. */
export function sendKindFor(input: { affiliateSeed: boolean; publisherType: string | null; ruleAction?: string | null }): SendKind {
  if (input.affiliateSeed || input.publisherType === "AFFILIATE" || input.ruleAction === "AFFILIATE") return "AFFILIATE";
  if (input.publisherType === "INTERNAL") return "INTERNAL";
  return "EXTERNAL";
}
