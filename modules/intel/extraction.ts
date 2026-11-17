/**
 * AI extraction for one competitor email: what kind of send it is, and for a
 * promo the offer, price as written, product, expert, big idea, headline, CTA,
 * urgency and landing page. Pure: prompt, schema and clean-up only.
 *
 * The AI reads and classifies. It never supplies facts: a price is only what the
 * email itself says, and the landing page must be one of the links we parsed.
 */
import { hostOf, type EmailLink } from "./links";

export const EMAIL_TYPES = ["promo", "editorial", "renewal", "upsell", "event", "welcome", "survey", "transactional", "other"] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  promo: "Promo",
  editorial: "Editorial",
  renewal: "Renewal",
  upsell: "Upsell",
  event: "Event",
  welcome: "Welcome",
  survey: "Survey",
  transactional: "Transactional",
  other: "Other",
};

/** Sends that sell something. These feed the Promo Radar and teach the Brain. */
export const COMMERCIAL_TYPES: readonly EmailType[] = ["promo", "renewal", "upsell", "event"];

export const URGENCY_LEVELS = ["none", "low", "medium", "high"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export type EmailExtraction = {
  type: EmailType;
  summary: string;
  headline: string | null;
  bigIdea: string | null;
  hook: string | null;
  product: string | null;
  offer: string | null;
  /** Exactly as the email states it ("$49 for the first year"). Null when the email names no price. */
  priceText: string | null;
  discount: string | null;
  guarantee: string | null;
  experts: string[];
  cta: string | null;
  urgency: { level: UrgencyLevel; tactics: string[]; deadline: string | null };
  landingUrl: string | null;
  angles: string[];
  topics: string[];
  takeaway: string | null;
};

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const stringList = { type: "array", items: { type: "string" } };

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "summary", "headline", "bigIdea", "hook", "product", "offer", "priceText", "discount", "guarantee", "experts", "cta", "urgency", "landingLink", "angles", "topics", "takeaway"],
  properties: {
    type: { type: "string", enum: [...EMAIL_TYPES] },
    summary: { type: "string" },
    headline: nullableString,
    bigIdea: nullableString,
    hook: nullableString,
    product: nullableString,
    offer: nullableString,
    priceText: nullableString,
    discount: nullableString,
    guarantee: nullableString,
    experts: stringList,
    cta: nullableString,
    urgency: {
      type: "object",
      additionalProperties: false,
      required: ["level", "tactics", "deadline"],
      properties: {
        level: { type: "string", enum: [...URGENCY_LEVELS] },
        tactics: stringList,
        deadline: nullableString,
      },
    },
    landingLink: { anyOf: [{ type: "integer" }, { type: "null" }] },
    angles: stringList,
    topics: stringList,
    takeaway: nullableString,
  },
} as const;

type RawExtraction = Omit<EmailExtraction, "landingUrl"> & { landingLink: number | null };

export const EXTRACTION_SYSTEM = `You are a competitive-intelligence analyst for a newsletter publisher. You read one email that a competing publisher sent to its list and record, as structured data, what it is and how it sells.

How to classify the send:
- promo: sells a paid product, subscription, course, supplement, book, service or bundle, including lift notes that push a sales page.
- editorial: free content (an article, a market or health update, a tip), even if it carries a small ad.
- renewal: asks an existing customer to renew, extend or upgrade before expiry.
- upsell: a follow-on offer to people who already bought.
- event: a webinar, live session, summit, workshop or in-person event.
- welcome: onboarding after signup.
- survey: asks for feedback or answers.
- transactional: receipts, password resets, account notices.
- other: none of the above.

Rules:
- Record only what the email says. Never invent a price, a discount, a result, a statistic or a name. If the email does not state something, use null (or an empty list).
- priceText is the price exactly as written in the email, with its terms ("$49 for the first year", "3 bottles for $99"). Null if no price appears.
- experts are the named people the email leans on: the author, editor, doctor, analyst, coach or spokesperson. Names only, as written.
- headline is the main headline or subject promise. bigIdea is the single core idea or promise the send is built on, in one sentence. hook is the opening device (a story, a question, a shocking claim, a prediction).
- offer describes what the reader gets and on what terms. cta is the main call to action as written (the button or link text).
- urgency.tactics names the pressure devices used (deadline, limited spots, price going up, bonus expires, countdown). urgency.deadline is the stated deadline, as written.
- landingLink is the number of the link in the provided list that goes to the main sales or landing page, or null if none of them do. Never choose unsubscribe, preference, privacy or social links.
- angles are 1 to 5 short, reusable labels for the persuasion angle (for example "insider secret", "fear of missing out", "contrarian warning", "new discovery", "social proof"), lowercase, two to four words each.
- topics are 1 to 5 short lowercase subject labels.
- summary is two sentences on what the email does. takeaway is one sentence on what our editors and copywriters can learn from it, or null if nothing.
- Follow the brand's compliance rules when you write the summary and takeaway: describe the competitor's claims, never repeat them as true.`;

export const MAX_EXTRACTION_TEXT = 24_000;

export function extractionPrompt(input: {
  brandContext: string;
  competitorName: string | null;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  text: string;
  links: readonly EmailLink[];
}): string {
  const body = input.text.length > MAX_EXTRACTION_TEXT ? `${input.text.slice(0, MAX_EXTRACTION_TEXT)}\n[…email truncated]` : input.text;
  const links = input.links.length
    ? input.links.map((link, index) => `${index + 1}. ${link.text ? `"${link.text}" → ` : ""}${link.href}${link.count > 1 ? ` (linked ${link.count} times)` : ""}`).join("\n")
    : "(no links)";
  return [
    "Our brand (the reader of this analysis):",
    input.brandContext,
    "",
    "The competitor email:",
    `Competitor: ${input.competitorName ?? "not matched yet"}`,
    `From: ${input.fromName ? `${input.fromName} <${input.fromAddress}>` : input.fromAddress}`,
    `Date: ${input.receivedAt.toISOString().slice(0, 10)}`,
    `Subject: ${input.subject}`,
    "",
    "Links in the email (numbered):",
    links,
    "",
    "Body:",
    body || "(empty body)",
  ].join("\n");
}

function cleanText(value: unknown, max = 600): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function cleanList(value: unknown, max: number, lower = false): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 80);
    if (!text) continue;
    const display = lower ? text.toLowerCase() : text;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display);
    if (out.length >= max) break;
  }
  return out;
}

/** Clamp the AI answer to the schema and map the chosen link number to a parsed link. */
export function normalizeExtraction(raw: RawExtraction, links: readonly EmailLink[], fallbackLanding: string | null): EmailExtraction {
  const type = (EMAIL_TYPES as readonly string[]).includes(raw.type) ? raw.type : "other";
  const level = (URGENCY_LEVELS as readonly string[]).includes(raw.urgency?.level) ? raw.urgency.level : "none";
  const linkIndex = typeof raw.landingLink === "number" && Number.isInteger(raw.landingLink) ? raw.landingLink - 1 : -1;
  const chosen = linkIndex >= 0 && linkIndex < links.length ? links[linkIndex]!.href : null;
  const commercial = COMMERCIAL_TYPES.includes(type);
  return {
    type,
    summary: cleanText(raw.summary, 800) ?? "",
    headline: cleanText(raw.headline, 300),
    bigIdea: cleanText(raw.bigIdea, 400),
    hook: cleanText(raw.hook, 400),
    product: cleanText(raw.product, 200),
    offer: cleanText(raw.offer, 500),
    priceText: cleanText(raw.priceText, 200),
    discount: cleanText(raw.discount, 200),
    guarantee: cleanText(raw.guarantee, 300),
    experts: cleanList(raw.experts, 6),
    cta: cleanText(raw.cta, 160),
    urgency: { level, tactics: cleanList(raw.urgency?.tactics, 6, true), deadline: cleanText(raw.urgency?.deadline, 160) },
    landingUrl: chosen ?? (commercial ? fallbackLanding : null),
    angles: cleanList(raw.angles, 5, true),
    topics: cleanList(raw.topics, 5, true),
    takeaway: cleanText(raw.takeaway, 400),
  };
}

export function isCommercial(type: string | null | undefined): boolean {
  return Boolean(type) && (COMMERCIAL_TYPES as readonly string[]).includes(type!);
}

/** The Brain note one extracted competitor promo teaches the brand. */
export function emailBrainNote(input: {
  competitorName: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  extraction: EmailExtraction;
}): { title: string; body: string } {
  const e = input.extraction;
  const who = input.competitorName ?? input.fromAddress;
  const day = input.receivedAt.toISOString().slice(0, 10);
  const line = (label: string, value: string | null | undefined) => (value ? `- **${label}:** ${value}` : null);
  const body = [
    `Competitor ${EMAIL_TYPE_LABELS[e.type].toLowerCase()} from **${who}**, sent ${day}. Captured by Intel.`,
    "",
    `**Subject:** ${input.subject}`,
    "",
    e.summary,
    "",
    ...[
      line("Headline", e.headline),
      line("Big idea", e.bigIdea),
      line("Hook", e.hook),
      line("Product", e.product),
      line("Offer", e.offer),
      line("Price (as stated in the email)", e.priceText),
      line("Discount", e.discount),
      line("Guarantee", e.guarantee),
      line("Expert", e.experts.join(", ") || null),
      line("Call to action", e.cta),
      line("Urgency", e.urgency.level === "none" ? null : [e.urgency.level, ...e.urgency.tactics].join(", ") + (e.urgency.deadline ? ` (deadline: ${e.urgency.deadline})` : "")),
      line("Landing page", e.landingUrl ? hostOf(e.landingUrl) : null),
      line("Angles", e.angles.join(", ") || null),
    ].filter((value): value is string => value !== null),
    ...(e.takeaway ? ["", `**Takeaway:** ${e.takeaway}`] : []),
  ].join("\n");
  return { title: `Competitor ${e.type}: ${who}: ${input.subject}`.slice(0, 180), body };
}
