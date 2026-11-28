/** The small enums ISpy stores as strings (see packages/db/prisma/schema/ispy.prisma). */

export const FEEDS = ["FINPUB", "HEALTH"] as const;
export type Feed = (typeof FEEDS)[number];
export const FEED_LABELS: Record<Feed, string> = { FINPUB: "FinPub", HEALTH: "Health" };

export const PUBLISHER_TYPES = ["INTERNAL", "COMPETITOR", "AFFILIATE", "UNKNOWN", "GROUP"] as const;
export type PublisherType = (typeof PUBLISHER_TYPES)[number];
export const PUBLISHER_TYPE_LABELS: Record<PublisherType, string> = {
  INTERNAL: "Internal",
  COMPETITOR: "Competitor",
  AFFILIATE: "Affiliate",
  UNKNOWN: "Unknown",
  GROUP: "Group",
};

export const LIST_CATEGORIES = ["FREE_EDITORIAL", "PAID_EDITORIAL", "HOTLIST", "MARKETING_FILE"] as const;
export type ListCategory = (typeof LIST_CATEGORIES)[number];
export const LIST_CATEGORY_LABELS: Record<ListCategory, string> = {
  FREE_EDITORIAL: "Free editorial",
  PAID_EDITORIAL: "Paid editorial",
  HOTLIST: "Hotlist",
  MARKETING_FILE: "Marketing file",
};

export const EMAIL_TYPES = ["EDITORIAL", "PROMO", "INTERNAL_LIFT", "EXTERNAL_LIFT", "WELCOME", "OTHER"] as const;
export type IspyEmailType = (typeof EMAIL_TYPES)[number];
export const EMAIL_TYPE_LABELS: Record<IspyEmailType, string> = {
  EDITORIAL: "Editorial",
  PROMO: "Promo",
  INTERNAL_LIFT: "Internal lift",
  EXTERNAL_LIFT: "External lift",
  WELCOME: "Welcome",
  OTHER: "Other",
};

export const SEND_KINDS = ["INTERNAL", "EXTERNAL", "AFFILIATE"] as const;
export type SendKind = (typeof SEND_KINDS)[number];

export const INBOX_PROVIDERS = ["GMAIL_LEGACY", "MACHINEMAIL", "MANUAL"] as const;
export type InboxProvider = (typeof INBOX_PROVIDERS)[number];
export const INBOX_LEVELS = ["PUBLISHER_CATCHALL", "PUBLICATION", "LIST", "LEGACY"] as const;
export type InboxLevel = (typeof INBOX_LEVELS)[number];
export const INBOX_LEVEL_LABELS: Record<InboxLevel, string> = {
  PUBLISHER_CATCHALL: "Publisher catch-all",
  PUBLICATION: "Publication",
  LIST: "List",
  LEGACY: "Legacy Gmail",
};

export const PROMO_KINDS = ["VSL", "LEAD_GEN", "EQUITY_RAISE", "EVENT"] as const;
export type IspyPromoKind = (typeof PROMO_KINDS)[number];
export const PROMO_KIND_LABELS: Record<IspyPromoKind, string> = { VSL: "VSL", LEAD_GEN: "Lead-gen", EQUITY_RAISE: "Equity raise", EVENT: "Event" };

export const REPORT_KINDS = ["NOT_A_PROMO", "DUPLICATE"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
