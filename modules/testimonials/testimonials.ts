/**
 * Testimonials: the pure rules. Fields and validation, compliance flags per brand niche,
 * what blocks approval, filters for the table, CSV export and the Brain note.
 * No database and no clock here (callers pass dates), so everything is unit tested.
 */

export type Niche = "finance" | "health" | "general";

export const STATUSES = ["pending", "approved", "rejected"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = { pending: "Pending review", approved: "Approved", rejected: "Rejected" };

export const CHANNELS = ["email", "survey", "chatroom", "social", "phone", "review-site", "event", "public-form", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  survey: "Survey",
  chatroom: "Chatroom / community",
  social: "Social media",
  phone: "Phone / support call",
  "review-site": "Review site",
  event: "Live event",
  "public-form": "Public form",
  other: "Other",
};

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ── Input ────────────────────────────────────────────────────────────────

export type TestimonialInput = {
  displayName: string;
  location: string | null;
  quote: string;
  body: string | null;
  resultClaimed: string | null;
  /** YYYY-MM-DD */
  givenOn: string | null;
  channel: Channel;
  rating: number | null;
  tags: string[];
  videoUrl: string | null;
  contactEmail: string | null;
  publicationId: string | null;
  editorId: string | null;
};

export type FormLike = { get(name: string): unknown };

export const LIMITS = { displayName: 80, location: 120, quote: 600, body: 8000, resultClaimed: 300, tag: 40, tags: 12, url: 1000, email: 200 } as const;

function str(form: FormLike, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ").slice(0, LIMITS.tag);
    if (tag) seen.add(tag);
    if (seen.size >= LIMITS.tags) break;
  }
  return [...seen];
}

export function normalizeHttpUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().slice(0, LIMITS.url);
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParseResult = { ok: true; values: TestimonialInput } | { ok: false; error: string };

/** Validate a manual-entry or public-form submission. Unknown channels fall back to "other". */
export function parseTestimonialInput(form: FormLike, defaults: { channel?: Channel } = {}): ParseResult {
  const displayName = str(form, "displayName");
  const quote = str(form, "quote");
  if (!displayName) return { ok: false, error: "Add a name or initials." };
  if (displayName.length > LIMITS.displayName) return { ok: false, error: `Keep the name under ${LIMITS.displayName} characters.` };
  if (!quote) return { ok: false, error: "Add the quote." };
  if (quote.length > LIMITS.quote) return { ok: false, error: `Keep the quote under ${LIMITS.quote} characters; put the rest in the full text.` };
  const body = str(form, "body");
  if (body.length > LIMITS.body) return { ok: false, error: "The full text is too long." };
  const location = str(form, "location");
  if (location.length > LIMITS.location) return { ok: false, error: "The location is too long." };
  const resultClaimed = str(form, "resultClaimed");
  if (resultClaimed.length > LIMITS.resultClaimed) return { ok: false, error: "The result is too long." };
  const givenOnRaw = str(form, "givenOn");
  if (givenOnRaw && !/^\d{4}-\d{2}-\d{2}$/.test(givenOnRaw)) return { ok: false, error: "Use a real date." };
  if (givenOnRaw && Number.isNaN(Date.parse(`${givenOnRaw}T00:00:00Z`))) return { ok: false, error: "Use a real date." };
  const ratingRaw = str(form, "rating");
  const rating = ratingRaw ? Number(ratingRaw) : null;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return { ok: false, error: "Rating is 1 to 5 stars." };
  const videoRaw = str(form, "videoUrl");
  const videoUrl = normalizeHttpUrl(videoRaw);
  if (videoRaw && !videoUrl) return { ok: false, error: "The video link must be a web address." };
  const email = str(form, "contactEmail").toLowerCase();
  if (email && (email.length > LIMITS.email || !EMAIL.test(email))) return { ok: false, error: "That email address does not look right." };
  const channelRaw = str(form, "channel");
  const channel: Channel = isChannel(channelRaw) ? channelRaw : (defaults.channel ?? "other");
  const pub = str(form, "publicationId");
  const editor = str(form, "editorId");
  return {
    ok: true,
    values: {
      displayName,
      location: location || null,
      quote,
      body: body || null,
      resultClaimed: resultClaimed || null,
      givenOn: givenOnRaw || null,
      channel,
      rating,
      tags: parseTags(str(form, "tags")),
      videoUrl,
      contactEmail: email || null,
      publicationId: isUuid(pub) ? pub : null,
      editorId: isUuid(editor) ? editor : null,
    },
  };
}

// ── Compliance ───────────────────────────────────────────────────────────

export type Flag = { code: string; label: string; matches: string[] };

const GUARANTEE = /\b(guarantee[sd]?|risk[- ]free|can(?:'|no)t lose|sure thing|no[- ]brainer|100% (?:safe|sure|certain)|never lose|always (?:win|works))\b/gi;
const PERCENT = /[+-]?\d[\d,]*(?:\.\d+)?\s?%/g;
const DOLLARS = /(?:\$|usd\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|mm|thousand|million|grand)?\b|\b\d[\d,]*(?:\.\d+)?\s?(?:k|thousand|million|grand)\s+(?:dollars|profit|gain)/gi;
const MULTIPLE = /\b\d+(?:\.\d+)?\s?x\b|\b(?:doubled|tripled|quadrupled|ten[- ]bagger|\d+[- ]bagger)\b/gi;
const TIMEFRAME = /\b(?:in|over|within|after|since|for)\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:day|week|month|year|quarter)s?\b|\b(?:overnight|this (?:week|month|year)|last (?:week|month|year)|per (?:day|week|month|year)|a (?:day|week|month|year)|ytd|annual(?:ly)?|since (?:19|20)\d{2}|in (?:19|20)\d{2})\b/i;
const DISEASE =
  /\b(cure[sd]?|curing|treat(?:s|ed|ing|ment)?|heal(?:s|ed|ing)?|revers(?:e|ed|es|ing)|prevent(?:s|ed)?|diabetes|cancer|tumou?r|arthritis|alzheimer'?s?|dementia|heart disease|blood pressure|hypertension|cholesterol|depression|anxiety disorder|insomnia|off (?:my|her|his) (?:meds|medication)|stopp?ed (?:my|taking) (?:meds|medication|insulin)|prescription|disease)\b/gi;
const BODY_RESULT = /\b(?:lost|dropped|shed)\s+\d+(?:\.\d+)?\s?(?:lbs?|pounds|kg|kilos|inches|sizes)\b|\b\d+(?:\.\d+)?\s?(?:lbs?|pounds|kg)\s+(?:lighter|down|gone)\b/gi;

/** Money-making language that has no place in a health testimonial. */
const MONEY_WORDS = /\b(?:profits?|profited|returns? on|roi|made (?:me )?(?:money|a fortune|\$)|earn(?:ed|ings)|gains? of|my (?:portfolio|stocks?|investments?)|paid for itself|income)\b/gi;

function found(pattern: RegExp, text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
    const value = match[0].trim();
    if (value) out.add(value);
    if (out.size >= 6) break;
  }
  return [...out];
}

/**
 * Rule-based flags from the brand's niche. They never block saving; they decide what a
 * reviewer must look at. Finance: specific gains/returns (and gains with no timeframe).
 * Health: disease or treatment claims and specific body results. All niches: guarantees.
 */
export function complianceFlags(input: { quote: string; body?: string | null; resultClaimed?: string | null }, niche: Niche): Flag[] {
  const text = [input.quote, input.body ?? "", input.resultClaimed ?? ""].join("\n");
  const flags: Flag[] = [];
  const guarantees = found(GUARANTEE, text);
  if (guarantees.length) flags.push({ code: "guarantee", label: "Sounds like a guarantee", matches: guarantees });
  if (niche === "finance") {
    const gains = [...found(PERCENT, text), ...found(DOLLARS, text), ...found(MULTIPLE, text)];
    if (gains.length) {
      flags.push({ code: "specific-gain", label: "Specific gain or return: check it against the record", matches: gains.slice(0, 6) });
      if (!TIMEFRAME.test(text)) flags.push({ code: "gain-no-timeframe", label: "A gain with no timeframe", matches: [] });
    }
  } else if (niche === "health") {
    // Health testimonials are about how people feel, never about money: no gains, returns or profits.
    const money = [...found(DOLLARS, text), ...found(MONEY_WORDS, text)];
    if (money.length) flags.push({ code: "financial-gain", label: "Talks about money made: health testimonials never claim financial gains", matches: money.slice(0, 6) });
    const disease = found(DISEASE, text);
    if (disease.length) flags.push({ code: "disease-claim", label: "Disease or treatment claim", matches: disease });
    const body = found(BODY_RESULT, text);
    if (body.length) flags.push({ code: "specific-result", label: "Specific body result", matches: body });
  } else {
    const numbers = [...found(PERCENT, text), ...found(DOLLARS, text)];
    if (numbers.length) flags.push({ code: "specific-result", label: "Specific result: make sure it can be backed up", matches: numbers });
  }
  return flags;
}

export const DEFAULT_DISCLOSURE: Record<Niche, string> = {
  finance: "Results are not typical. Past performance does not guarantee future results, and all investing involves risk.",
  health: "Results not typical. Individual results vary. This testimonial is not medical advice.",
  general: "Individual results vary.",
};

export type ApprovalInput = {
  consentGiven: boolean;
  disclosure: string | null;
  flags: readonly Flag[];
  /** The reviewer ticked "I checked every flagged claim". */
  acknowledged: boolean;
};

/** Why this testimonial cannot be approved yet ([] = it can). */
export function approvalBlockers(input: ApprovalInput, niche: Niche): string[] {
  const out: string[] = [];
  if (!input.consentGiven) out.push("There is no consent on record. Get the person's permission before approving.");
  if (niche === "health" && !input.disclosure?.trim()) out.push("Health brands need a \"results not typical\" note before a testimonial is approved.");
  if (niche === "health" && input.flags.some((f) => f.code === "financial-gain")) {
    out.push("Health testimonials never claim financial gains. Edit out the money claim before approving.");
  }
  if (input.flags.length && !input.acknowledged) {
    const gain = input.flags.some((f) => f.code === "specific-gain");
    out.push(
      gain
        ? "It claims a specific gain or return. Check the figure against the record, then tick \"I checked every flagged claim\"."
        : "Tick \"I checked every flagged claim\" once you have reviewed the flags.",
    );
  }
  return out;
}

export function asFlags(value: unknown): Flag[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({
      code: typeof f.code === "string" ? f.code : "flag",
      label: typeof f.label === "string" ? f.label : "Flag",
      matches: Array.isArray(f.matches) ? f.matches.filter((m): m is string => typeof m === "string") : [],
    }));
}

// ── Consent ──────────────────────────────────────────────────────────────

export function defaultConsentText(brandName: string): string {
  return `I agree that ${brandName} may publish this testimonial, with my first name or initials and my city or state, in its publications, websites and marketing. It is true and describes my own experience. I can ask for it to be removed at any time.`;
}

export const STAFF_CONSENT_TEXT =
  "Staff attest the person gave permission to publish this testimonial (recorded by the team member who entered it).";

export type ConsentRecord = { consentGiven: boolean; consentText: string | null; consentAt: Date | null; consentMethod: string | null };

/** Public form: the box must be ticked, and the exact wording shown is what gets stored. */
export function publicConsent(ticked: boolean, shownText: string, at: Date): ConsentRecord | null {
  if (!ticked || !shownText.trim()) return null;
  return { consentGiven: true, consentText: shownText, consentAt: at, consentMethod: "public-form" };
}

/** Manual entry: staff attest permission; the note says how it was obtained. */
export function staffConsent(ticked: boolean, note: string, at: Date): ConsentRecord {
  if (!ticked) return { consentGiven: false, consentText: null, consentAt: null, consentMethod: null };
  const how = note.trim().slice(0, 500);
  return { consentGiven: true, consentText: how ? `${STAFF_CONSENT_TEXT} How: ${how}` : STAFF_CONSENT_TEXT, consentAt: at, consentMethod: "staff-attested" };
}

// ── Table filters ────────────────────────────────────────────────────────

export type Filters = {
  status: Status | "all";
  pub: string | null;
  editor: string | null;
  channel: Channel | null;
  tag: string | null;
  q: string;
  from: string | null;
  to: string | null;
  flagged: boolean;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string): string => {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: Params): Filters {
  const status = one(params, "status");
  const channel = one(params, "channel");
  const page = Number.parseInt(one(params, "page"), 10);
  return {
    status: isStatus(status) || status === "all" ? (status as Status | "all") : "all",
    pub: isUuid(one(params, "pub")) ? one(params, "pub") : null,
    editor: isUuid(one(params, "editor")) ? one(params, "editor") : null,
    channel: isChannel(channel) ? channel : null,
    tag: one(params, "tag").toLowerCase().slice(0, LIMITS.tag) || null,
    q: one(params, "q").slice(0, 120),
    from: DATE.test(one(params, "from")) ? one(params, "from") : null,
    to: DATE.test(one(params, "to")) ? one(params, "to") : null,
    flagged: one(params, "flagged") === "1",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1,
  };
}

/** The query string for a filter set (page left out unless > 1). Saved views store this. */
export function filtersToQuery(filters: Partial<Filters>): string {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.pub) params.set("pub", filters.pub);
  if (filters.editor) params.set("editor", filters.editor);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.flagged) params.set("flagged", "1");
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

/** A saved view's query re-parsed, so a stored string can never carry unknown keys. */
export function cleanViewQuery(raw: string): string {
  const params = new URLSearchParams(raw.replace(/^\?/, ""));
  const { page: _page, ...rest } = parseFilters(Object.fromEntries(params.entries()));
  return filtersToQuery(rest);
}

// ── CSV ──────────────────────────────────────────────────────────────────

export type CsvRow = {
  id: string;
  status: string;
  displayName: string;
  location: string | null;
  quote: string;
  body: string | null;
  resultClaimed: string | null;
  givenOn: string | null;
  channel: string;
  rating: number | null;
  tags: string[];
  publication: string | null;
  editor: string | null;
  videoUrl: string | null;
  disclosure: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  consent: string;
  contactEmail: string | null;
  createdAt: string;
};

/** Quote a CSV cell, and neutralize spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function testimonialsCsv(rows: readonly CsvRow[], options: { includeContact: boolean }): string {
  const columns: [keyof CsvRow, string][] = [
    ["id", "ID"],
    ["status", "Status"],
    ["displayName", "Name"],
    ["location", "Location"],
    ["quote", "Quote"],
    ["body", "Full text"],
    ["resultClaimed", "Result claimed"],
    ["givenOn", "Date given"],
    ["channel", "Channel"],
    ["rating", "Rating"],
    ["tags", "Tags"],
    ["publication", "Publication"],
    ["editor", "Editor"],
    ["videoUrl", "Video"],
    ["disclosure", "Disclosure"],
    ["reviewReason", "Review note"],
    ["reviewedAt", "Reviewed at"],
    ["consent", "Consent"],
    ...(options.includeContact ? ([["contactEmail", "Contact email"]] as [keyof CsvRow, string][]) : []),
    ["createdAt", "Added"],
  ];
  const lines = [columns.map(([, label]) => csvCell(label)).join(",")];
  for (const row of rows) lines.push(columns.map(([key]) => csvCell(row[key])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

// ── Brain ────────────────────────────────────────────────────────────────

/**
 * The Brain note for an approved testimonial. Only what may be published: name or
 * initials, location, the words, the result as claimed and the disclosure. Never the
 * contact email, consent IP or reviewer.
 */
export function testimonialNote(t: {
  id: string;
  displayName: string;
  location: string | null;
  quote: string;
  body: string | null;
  resultClaimed: string | null;
  givenOn: string | null;
  channel: string;
  tags: string[];
  disclosure: string | null;
  publication: string | null;
  editor: string | null;
}): { title: string; body: string } {
  const who = [t.displayName, t.location].filter(Boolean).join(", ");
  const about = t.publication ?? "the brand";
  const lines = [
    `Approved reader testimonial for ${about}${t.editor ? ` (mentions ${t.editor})` : ""}.`,
    "",
    `> ${t.quote.replace(/\n+/g, " ")}`,
    `> — ${who}`,
    "",
    ...(t.body && t.body !== t.quote ? ["Full text:", t.body, ""] : []),
    ...(t.resultClaimed ? [`Result claimed (their words, not verified data): ${t.resultClaimed}`] : []),
    ...(t.givenOn ? [`Given: ${t.givenOn}`] : []),
    `Channel: ${CHANNEL_LABELS[t.channel as Channel] ?? t.channel}`,
    ...(t.tags.length ? [`Tags: ${t.tags.join(", ")}`] : []),
    ...(t.disclosure ? [`Always shown with: "${t.disclosure}"`] : []),
    "",
    "Use only as written, with the disclosure. Approved in Testimonials after a compliance review.",
  ];
  return { title: `Testimonial: ${t.displayName}${t.publication ? ` on ${t.publication}` : ""}`.slice(0, 120), body: lines.join("\n") };
}

// ── AI pre-review ────────────────────────────────────────────────────────

export const AI_REVIEW_SYSTEM = [
  "You help a publisher's compliance reviewer read reader testimonials before they are published.",
  "You are given the brand's niche, its audience and its compliance rules, and one testimonial.",
  "List each phrase in the testimonial that could break one of the rules or needs a fact check before publishing.",
  "Quote the phrase exactly as written. Say which rule it touches and why, in one short sentence.",
  "Do not rewrite the testimonial, do not judge whether the claim is true and never add numbers of your own.",
  "If nothing is risky, return an empty list. Keep the summary to one sentence a busy reviewer can act on.",
].join("\n");

export const AI_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "flags"],
  properties: {
    summary: { type: "string" },
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phrase", "rule", "why"],
        properties: { phrase: { type: "string" }, rule: { type: "string" }, why: { type: "string" } },
      },
    },
  },
} as const;

export type AiReview = { summary: string; flags: { phrase: string; rule: string; why: string }[] };

export function asAiReview(value: unknown): AiReview | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string" || !Array.isArray(v.flags)) return null;
  return {
    summary: v.summary,
    flags: v.flags
      .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
      .map((f) => ({ phrase: String(f.phrase ?? ""), rule: String(f.rule ?? ""), why: String(f.why ?? "") })),
  };
}

export function aiReviewInput(brandContext: string, t: { quote: string; body: string | null; resultClaimed: string | null; publication: string | null }): string {
  return [
    brandContext,
    "",
    `Publication: ${t.publication ?? "not set"}`,
    `Quote: ${t.quote}`,
    ...(t.body ? [`Full text: ${t.body}`] : []),
    ...(t.resultClaimed ? [`Result the reader claims: ${t.resultClaimed}`] : []),
  ].join("\n");
}

/** Only approved, live testimonials ever leave this app (wiki pages, Brain). */
export function isPublishable(t: { status: string; deletedAt: Date | null }): boolean {
  return t.status === "approved" && !t.deletedAt;
}
