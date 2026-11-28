/**
 * The one small AI call ISpy makes per NEW copy (re-sends reuse it): key takeaways,
 * the offer, topics, gurus, and who the email promotes. The AI never supplies facts;
 * it only records what the email says.
 */
export type CopyExtraction = {
  typeHint: "editorial" | "promo" | "lift" | "welcome" | "other";
  headline: string | null;
  takeaways: string[];
  offer: { product: string | null; priceText: string | null; discount: string | null; guarantee: string | null; cta: string | null };
  topics: string[];
  gurus: string[];
  promotedBrand: string | null;
  promotedGuru: string | null;
  hasEdNote: boolean;
  listName: string | null;
};

const n = { anyOf: [{ type: "string" }, { type: "null" }] };
const list = { type: "array", items: { type: "string" } };

export const COPY_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["typeHint", "headline", "takeaways", "offer", "topics", "gurus", "promotedBrand", "promotedGuru", "hasEdNote", "listName"],
  properties: {
    typeHint: { type: "string", enum: ["editorial", "promo", "lift", "welcome", "other"] },
    headline: n,
    takeaways: list,
    offer: {
      type: "object",
      additionalProperties: false,
      required: ["product", "priceText", "discount", "guarantee", "cta"],
      properties: { product: n, priceText: n, discount: n, guarantee: n, cta: n },
    },
    topics: list,
    gurus: list,
    promotedBrand: n,
    promotedGuru: n,
    hasEdNote: { type: "boolean" },
    listName: n,
  },
} as const;

export const COPY_EXTRACTION_SYSTEM = `You read one marketing or editorial email from a newsletter publisher and record, as structured data, what it says. Record only what the email states: never invent a price, result, statistic or name; use null or an empty list when something is not stated.

- typeHint: "editorial" (free content), "promo" (sells the sending newsletter's own product), "lift" (promotes ANOTHER publication, brand or editor: "my friend", "a message from our partner", an ed note introducing someone else's offer), "welcome" (onboarding after signup), "other".
- headline: the main headline or promise.
- takeaways: 3 to 5 short sentences an editor or copywriter can learn from (the big idea, the hook, the proof, the urgency device). Describe claims; never repeat them as true.
- offer: product name, price exactly as written with its terms, discount, guarantee, call to action as written. Null when not stated.
- topics: 1 to 5 short lowercase subject labels.
- gurus: the named editors or experts the email leans on, as written.
- promotedBrand / promotedGuru: for a lift, the publication/company and the person whose offer is being promoted. Null otherwise.
- hasEdNote: true when a short editor's note introduces someone else's message.
- listName: the newsletter's own masthead name if the email shows it (never the headline). Null if unsure.`;

export const MAX_COPY_TEXT = 16_000;

export function copyExtractionPrompt(input: { feed: string; fromName: string | null; fromAddress: string; subject: string; text: string; landingHeadline?: string | null }): string {
  return [
    `Feed: ${input.feed === "HEALTH" ? "health publishing" : "financial publishing"}`,
    `From: ${input.fromName ?? ""} <${input.fromAddress}>`,
    `Subject: ${input.subject}`,
    input.landingHeadline ? `Landing page headline: ${input.landingHeadline}` : "",
    "",
    "Email text:",
    input.text.slice(0, MAX_COPY_TEXT),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const clip = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const clipList = (v: unknown, count: number, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => clip(x, max)).filter((x): x is string => !!x))].slice(0, count) : [];

export function normalizeCopyExtraction(raw: unknown): CopyExtraction {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const offer = (r.offer && typeof r.offer === "object" ? r.offer : {}) as Record<string, unknown>;
  const hint = String(r.typeHint ?? "other");
  return {
    typeHint: (["editorial", "promo", "lift", "welcome", "other"].includes(hint) ? hint : "other") as CopyExtraction["typeHint"],
    headline: clip(r.headline),
    takeaways: clipList(r.takeaways, 5, 400),
    offer: { product: clip(offer.product), priceText: clip(offer.priceText), discount: clip(offer.discount), guarantee: clip(offer.guarantee), cta: clip(offer.cta) },
    topics: clipList(r.topics, 5, 60).map((t) => t.toLowerCase()),
    gurus: clipList(r.gurus, 6, 80),
    promotedBrand: clip(r.promotedBrand, 120),
    promotedGuru: clip(r.promotedGuru, 120),
    hasEdNote: r.hasEdNote === true,
    listName: clip(r.listName, 80),
  };
}

export function offerLine(offer: CopyExtraction["offer"]): string | null {
  const parts = [offer.product, offer.priceText ? `“${offer.priceText}” (as stated)` : null, offer.discount, offer.guarantee, offer.cta ? `CTA “${offer.cta}”` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
