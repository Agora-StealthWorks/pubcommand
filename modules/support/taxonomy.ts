/**
 * Support Knowledge taxonomy: every record has exactly one category and one audience.
 * An agent profile's scope is a subset of each. This file is the only place they are defined.
 *
 * Niche-neutral on purpose: a brand's niche (finance, health, general) only switches the
 * Track Record category on or off (finance brands only).
 */
import type { Niche } from "@pubcommand/core";

export const CATEGORIES = {
  products: { label: "Products & publications", hint: "What each publication or product is, what members get, who writes it." },
  editors: { label: "Editors & experts", hint: "Public bios of the people behind the publications." },
  howto: { label: "How-to & member help", hint: "Logging in, finding issues, using the website and apps." },
  billing: { label: "Billing & policies", hint: "Renewals, refunds, cancellations, guarantees, privacy: the published policy wording." },
  pricing: { label: "Pricing", hint: "Retail list prices and how to join. No discounts that are not publicly offered." },
  events: { label: "Events & webinars", hint: "Public events, live sessions and how to attend." },
  faqs: { label: "FAQs", hint: "Short answers to common customer questions." },
  issues: { label: "Known issues & fixes", hint: "Known problems and the steps that fix them." },
  website: { label: "Website directory", hint: "Posts, articles and reports on the website: what each is, when it ran and its link." },
  trades: { label: "Track record (closed trades)", hint: "Closed trades, read live from Track Record. Finance brands, members only." },
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

/** Categories a person writes records in. Trades are never stored: they are read live from Track Record. */
export const RECORD_CATEGORIES = CATEGORY_KEYS.filter((key) => key !== "trades");

export const AUDIENCES = ["public", "member"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = { public: "Public (anyone)", member: "Members only" };

export const STATUSES = ["draft", "published", "archived"] as const;
export type RecordStatus = (typeof STATUSES)[number];

export const SOURCES = ["manual", "pubsetup", "brain", "website", "gap", "platform"] as const;
export type RecordSource = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<RecordSource, string> = {
  manual: "Written here",
  pubsetup: "Publication Setup",
  brain: "Brand Brain",
  website: "Website import",
  gap: "From a gap",
  platform: "From the agent platform",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

export function isRecordCategory(value: unknown): value is Category {
  return isCategory(value) && value !== "trades";
}

export function isAudience(value: unknown): value is Audience {
  return value === "public" || value === "member";
}

export function isStatus(value: unknown): value is RecordStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Categories this brand can use at all. Track record is finance-only. */
export function categoriesForNiche(niche: Niche | string): Category[] {
  return CATEGORY_KEYS.filter((key) => key !== "trades" || niche === "finance");
}
