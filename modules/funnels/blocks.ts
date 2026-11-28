/**
 * Microsite home page blocks. PURE and browser-safe: the builder (client), the
 * save action (server) and the public renderer all read blocks through
 * `normalizeBlocks`, so a hand-edited or old row always renders and a crafted
 * POST cannot smuggle in an unknown type, a bad colour or an oversized field.
 *
 * Every block is { id, type, style, ...its own fields }. Blocks reuse the
 * funnel's own data (the agenda is built from the modules, hosts come from the
 * Hosts tab, opt-ins use a published Form or the simple email capture), so
 * nothing is typed twice.
 */
import { isHexColor, isHttpUrl } from "./checks";

export const BLOCK_TYPES = ["headline", "text", "event", "countdown", "agenda", "optin", "hosts", "button", "image", "html", "divider", "pricing", "testimonials", "logos", "faq", "episodes", "rating"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_INFO: Record<BlockType, { label: string; description: string }> = {
  headline: { label: "Headline", description: "Eyebrow, a big headline with an accent part, and a subhead" },
  text: { label: "Text", description: "Paragraphs, lists, links and images" },
  event: { label: "Event box", description: "Title, date, countdown and add-to-calendar" },
  countdown: { label: "Countdown", description: "Counts down to the start, the close or a set time" },
  agenda: { label: "Agenda", description: "The schedule, built from your modules: a list or thumbnail cards" },
  optin: { label: "Opt-in", description: "A published form, the simple email capture, or an SMS opt-in form" },
  hosts: { label: "Meet your hosts", description: "The hosts from the Hosts tab" },
  button: { label: "Button", description: "A button to any web address, a module or a page" },
  image: { label: "Image", description: "One image, optionally linked" },
  html: { label: "Custom HTML", description: "Embed code, run in a sandbox" },
  divider: { label: "Divider", description: "A thin line between sections" },
  pricing: { label: "Pricing", description: "One to three packages: price, features, bonus value stack and a buy button" },
  testimonials: { label: "Testimonials", description: "Reviews or endorsements with optional star ratings" },
  logos: { label: "Logo strip", description: "“As featured in” logos" },
  faq: { label: "FAQ", description: "Questions that open to show their answers" },
  episodes: { label: "Episode grid", description: "Every module as a card with its short description and an unlock button" },
  rating: { label: "Star rating", description: "An overall score like “4.9 out of 5” with stars and a review count" },
};

/** Which design colour a button or accent text uses: the main accent, the second accent or the highlight. */
export const TONES = ["accent", "accent2", "highlight"] as const;
export type Tone = (typeof TONES)[number];

export const BLOCK_WIDTHS = ["narrow", "standard", "wide", "full"] as const;
export const BLOCK_PADDINGS = ["none", "small", "medium", "large"] as const;
export const BLOCK_ALIGNS = ["left", "center", "right"] as const;
export type BlockWidth = (typeof BLOCK_WIDTHS)[number];
export type BlockPadding = (typeof BLOCK_PADDINGS)[number];
export type BlockAlign = (typeof BLOCK_ALIGNS)[number];

export type BlockStyle = {
  /** Band colour behind the block; null = the page background. */
  bg: string | null;
  /** Text colour; null = the page text colour. */
  text: string | null;
  padding: BlockPadding;
  width: BlockWidth;
  align: BlockAlign;
};

type Base<T extends BlockType> = { id: string; type: T; style: BlockStyle };

export type HeadlineBlock = Base<"headline"> & { eyebrow: string; heading: string; accent: string; sub: string; accentTone: Tone };
export type TextBlock = Base<"text"> & { html: string };
/** `at` is an ISO instant; "" = the funnel start. */
export type EventBlock = Base<"event"> & { eyebrow: string; title: string; when: string; at: string; minutes: number; countdown: boolean; calendar: boolean };
/** target "episode" = when the module on screen stops being available (access window). */
export type CountdownBlock = Base<"countdown"> & { heading: string; target: "start" | "end" | "custom" | "episode"; at: string };
export type AgendaBlock = Base<"agenda"> & { heading: string; layout: "list" | "cards"; linkModules: boolean };
/** mode "sms": `smsFormId` is one of the funnel's SMS opt-in forms. */
export type OptinBlock = Base<"optin"> & { heading: string; intro: string; mode: "email" | "form" | "sms"; formSlug: string; smsFormId: string; buttonText: string };
export type HostsBlock = Base<"hosts"> & { heading: string; layout: "grid" | "stacked" };
/** `target` = an http(s) URL, `module:<n>` or `page:<slug>`. */
export type ButtonBlock = Base<"button"> & { label: string; target: string; newTab: boolean; tone: Tone };
export type ImageBlock = Base<"image"> & { assetId: string; src: string; alt: string; href: string; newTab: boolean; widthPercent: number };
export type HtmlBlock = Base<"html"> & { title: string; html: string; height: number };
export type DividerBlock = Base<"divider">;
/**
 * features / bonuses: one per line; a bonus line is "Name | value" (value optional).
 * A line starting with "~" is shown crossed off (what this package does NOT include).
 */
export type PricingTier = { name: string; price: string; was: string; badge: string; features: string; bonuses: string; buttonText: string; url: string; highlight: boolean; newTab: boolean; tone: Tone; imageAssetId: string; imageSrc: string };
export type PricingBlock = Base<"pricing"> & { heading: string; tiers: PricingTier[]; footnote: string };
export type Testimonial = { quote: string; name: string; role: string; rating: number; photoAssetId: string; photoSrc: string };
export type TestimonialsBlock = Base<"testimonials"> & { heading: string; items: Testimonial[] };
export type LogoItem = { assetId: string; src: string; alt: string };
export type LogosBlock = Base<"logos"> & { heading: string; items: LogoItem[] };
export type FaqItem = { q: string; a: string };
export type FaqBlock = Base<"faq"> & { heading: string; items: FaqItem[] };
/** `target`: where each card's button goes (normalizeTarget; "#offer" = this page's offer section). */
export type EpisodesBlock = Base<"episodes"> & { heading: string; buttonText: string; target: string; showSummary: boolean };
/** score e.g. "4.9" (0–outOf); count e.g. "2,341 reviews"; note e.g. "on Trustpilot". */
export type RatingBlock = Base<"rating"> & { heading: string; score: string; outOf: number; count: string; note: string };

export type Block =
  | HeadlineBlock
  | TextBlock
  | EventBlock
  | CountdownBlock
  | AgendaBlock
  | OptinBlock
  | HostsBlock
  | ButtonBlock
  | ImageBlock
  | HtmlBlock
  | DividerBlock
  | PricingBlock
  | TestimonialsBlock
  | LogosBlock
  | FaqBlock
  | EpisodesBlock
  | RatingBlock;

export const MAX_TIERS = 3;
export const MAX_ITEMS = 30;

export const MAX_BLOCKS = 60;
export const MAX_RICH = 50_000;
export const MAX_RAW_HTML = 100_000;

export const DEFAULT_STYLE: BlockStyle = { bg: null, text: null, padding: "medium", width: "standard", align: "left" };

const STYLE_BY_TYPE: Partial<Record<BlockType, Partial<BlockStyle>>> = {
  headline: { align: "center", width: "narrow" },
  event: { align: "center", bg: "#111827", text: "#ffffff" },
  countdown: { align: "center" },
  optin: { align: "center", width: "narrow" },
  button: { align: "center", padding: "small" },
  image: { align: "center" },
  divider: { padding: "small" },
  pricing: { align: "center", width: "wide" },
  testimonials: { width: "wide" },
  logos: { align: "center", width: "wide", padding: "small" },
  faq: { width: "narrow" },
  episodes: { align: "center", width: "wide" },
  rating: { align: "center", padding: "small" },
};

/** Per-type field defaults (without id, type and style). */
export const BLOCK_DEFAULTS = {
  headline: { eyebrow: "", heading: "Welcome to", accent: "", sub: "", accentTone: "accent" },
  text: { html: "" },
  event: { eyebrow: "The main event", title: "", when: "", at: "", minutes: 60, countdown: true, calendar: true },
  countdown: { heading: "", target: "start", at: "" },
  agenda: { heading: "Schedule", layout: "cards", linkModules: true },
  optin: { heading: "Save your seat", intro: "", mode: "email", formSlug: "", smsFormId: "", buttonText: "Sign me up" },
  hosts: { heading: "Meet your hosts", layout: "grid" },
  button: { label: "Watch the first video", target: "module:1", newTab: false, tone: "accent" },
  image: { assetId: "", src: "", alt: "", href: "", newTab: false, widthPercent: 100 },
  html: { title: "Embed", html: "", height: 0 },
  divider: {},
  pricing: {
    heading: "Choose your package",
    tiers: [
      { name: "Basic", price: "", was: "", badge: "", features: "", bonuses: "", buttonText: "Buy now", url: "", highlight: false, newTab: false, tone: "accent", imageAssetId: "", imageSrc: "" },
      { name: "Gold", price: "", was: "", badge: "Most popular", features: "", bonuses: "", buttonText: "Yes, I want this now", url: "", highlight: true, newTab: false, tone: "accent", imageAssetId: "", imageSrc: "" },
    ],
    footnote: "",
  },
  testimonials: { heading: "What viewers are saying", items: [{ quote: "", name: "", role: "", rating: 5, photoAssetId: "", photoSrc: "" }] },
  logos: { heading: "As featured in", items: [] },
  faq: { heading: "Frequently asked questions", items: [{ q: "", a: "" }] },
  episodes: { heading: "The complete series", buttonText: "Unlock now", target: "#offer", showSummary: true },
  rating: { heading: "", score: "4.9", outOf: 5, count: "", note: "" },
} satisfies { [K in BlockType]: Omit<Extract<Block, { type: K }>, "id" | "type" | "style"> };

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

/** A short random block id: "b" + 8 base-36 characters. */
export function newBlockId(random: () => number = Math.random): string {
  let id = "b";
  for (let index = 0; index < 8; index += 1) id += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
  return id;
}

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && /^b[a-z0-9]{6,16}$/.test(value);
}

export function newBlock(type: BlockType, id: string = newBlockId()): Block {
  return { id, type, style: { ...DEFAULT_STYLE, ...STYLE_BY_TYPE[type] }, ...structuredClone(BLOCK_DEFAULTS[type]) } as Block;
}

function str(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").slice(0, max) : fallback;
}

function line(value: unknown, max: number, fallback = ""): string {
  return str(value, max, fallback).replace(/\s*\n\s*/g, " ").trim();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function colorOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null || value === "") return null;
  return typeof value === "string" && isHexColor(value) ? value.trim().toLowerCase() : fallback;
}

function isoOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A button target: an http(s) URL, `module:<n>` or `page:<slug>`. Anything else is "". */
export function normalizeTarget(value: unknown): string {
  const text = line(value, 500);
  if (text === "#offer") return text;
  if (/^module:\d{1,3}$/.test(text)) return text;
  if (/^page:[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(text)) return text;
  return isHttpUrl(text) ? text : "";
}

export function normalizeStyle(raw: unknown, type: BlockType): BlockStyle {
  const base = { ...DEFAULT_STYLE, ...STYLE_BY_TYPE[type] };
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    bg: "bg" in input ? colorOrNull(input.bg, base.bg) : base.bg,
    text: "text" in input ? colorOrNull(input.text, base.text) : base.text,
    padding: oneOf(input.padding, BLOCK_PADDINGS, base.padding),
    width: oneOf(input.width, BLOCK_WIDTHS, base.width),
    align: oneOf(input.align, BLOCK_ALIGNS, base.align),
  };
}

export type NormalizeOptions = {
  /** Cleans the Text block's rich HTML (the server passes the sanitizer; the builder leaves it as typed). */
  sanitizeRich?: (html: string) => string;
};

/** One block, cleaned: unknown fields dropped, every field typed, clamped and defaulted. Null for an unknown type. */
export function normalizeBlock(raw: unknown, options: NormalizeOptions = {}): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (!isBlockType(input.type)) return null;
  const type = input.type;
  const id = isBlockId(input.id) ? input.id : newBlockId();
  const style = normalizeStyle(input.style, type);
  const d = BLOCK_DEFAULTS;
  switch (type) {
    case "headline":
      return { id, type, style, eyebrow: line(input.eyebrow, 120), heading: line(input.heading, 200, d.headline.heading), accent: line(input.accent, 200), sub: str(input.sub, 600).trim(), accentTone: tone(input.accentTone) };
    case "text": {
      const html = str(input.html, MAX_RICH);
      return { id, type, style, html: options.sanitizeRich ? options.sanitizeRich(html) : html };
    }
    case "event":
      return {
        id,
        type,
        style,
        eyebrow: line(input.eyebrow, 120, d.event.eyebrow),
        title: line(input.title, 200),
        when: line(input.when, 200),
        at: isoOrEmpty(input.at),
        minutes: num(input.minutes, d.event.minutes, 5, 24 * 60),
        countdown: flag(input.countdown, d.event.countdown),
        calendar: flag(input.calendar, d.event.calendar),
      };
    case "countdown":
      return { id, type, style, heading: line(input.heading, 200), target: oneOf(input.target, ["start", "end", "custom", "episode"] as const, "start"), at: isoOrEmpty(input.at) };
    case "agenda":
      return { id, type, style, heading: line(input.heading, 200, d.agenda.heading), layout: oneOf(input.layout, ["list", "cards"] as const, "cards"), linkModules: flag(input.linkModules, true) };
    case "optin":
      return {
        id,
        type,
        style,
        heading: line(input.heading, 200, d.optin.heading),
        intro: str(input.intro, 1000).trim(),
        mode: oneOf(input.mode, ["email", "form", "sms"] as const, "email"),
        formSlug: /^[a-z0-9-]{1,60}$/.test(String(input.formSlug ?? "")) ? String(input.formSlug) : "",
        smsFormId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.smsFormId ?? "")) ? String(input.smsFormId).toLowerCase() : "",
        buttonText: line(input.buttonText, 40, d.optin.buttonText) || d.optin.buttonText,
      };
    case "hosts":
      return { id, type, style, heading: line(input.heading, 200, d.hosts.heading), layout: oneOf(input.layout, ["grid", "stacked"] as const, "grid") };
    case "button":
      return { id, type, style, label: line(input.label, 80, d.button.label), target: normalizeTarget(input.target), newTab: flag(input.newTab, false), tone: tone(input.tone) };
    case "image": {
      const src = line(input.src, 1000);
      const href = normalizeTarget(input.href);
      return {
        id,
        type,
        style,
        assetId: typeof input.assetId === "string" && UUID_RE.test(input.assetId) ? input.assetId.toLowerCase() : "",
        src: /^https:\/\//i.test(src) && isHttpUrl(src) ? src : "",
        alt: line(input.alt, 300),
        href,
        newTab: flag(input.newTab, false),
        widthPercent: num(input.widthPercent, 100, 10, 100),
      };
    }
    case "html":
      return { id, type, style, title: line(input.title, 120, d.html.title) || "Embed", html: str(input.html, MAX_RAW_HTML), height: num(input.height, 0, 0, 4000) };
    case "divider":
      return { id, type, style };
    case "pricing":
      return {
        id,
        type,
        style,
        heading: line(input.heading, 200),
        tiers: list(input.tiers, MAX_TIERS).map((tier) => ({
          name: line(tier.name, 80),
          price: line(tier.price, 40),
          was: line(tier.was, 40),
          badge: line(tier.badge, 40),
          features: str(tier.features, 3000).trim(),
          bonuses: str(tier.bonuses, 3000).trim(),
          buttonText: line(tier.buttonText, 60),
          url: normalizeTarget(tier.url),
          highlight: flag(tier.highlight, false),
          newTab: flag(tier.newTab, false),
          tone: tone(tier.tone),
          imageAssetId: assetIdOf(tier.imageAssetId),
          imageSrc: httpsSrc(tier.imageSrc),
        })),
        footnote: str(input.footnote, 600).trim(),
      };
    case "testimonials":
      return {
        id,
        type,
        style,
        heading: line(input.heading, 200),
        items: list(input.items, MAX_ITEMS).map((item) => ({ quote: str(item.quote, 2000).trim(), name: line(item.name, 120), role: line(item.role, 120), rating: num(item.rating, 0, 0, 5), photoAssetId: assetIdOf(item.photoAssetId), photoSrc: httpsSrc(item.photoSrc) })),
      };
    case "logos":
      return {
        id,
        type,
        style,
        heading: line(input.heading, 200),
        items: list(input.items, MAX_ITEMS).map((item) => {
          const src = line(item.src, 1000);
          return { assetId: typeof item.assetId === "string" && UUID_RE.test(item.assetId) ? item.assetId.toLowerCase() : "", src: /^https:\/\//i.test(src) && isHttpUrl(src) ? src : "", alt: line(item.alt, 200) };
        }),
      };
    case "faq":
      return { id, type, style, heading: line(input.heading, 200), items: list(input.items, MAX_ITEMS).map((item) => ({ q: line(item.q, 300), a: str(item.a, 4000).trim() })) };
    case "episodes":
      return { id, type, style, heading: line(input.heading, 200), buttonText: line(input.buttonText, 60), target: normalizeTarget(input.target), showSummary: flag(input.showSummary, true) };
    case "rating": {
      const outOf = num(input.outOf, 5, 1, 10);
      return { id, type, style, heading: line(input.heading, 200), score: ratingScore(input.score, outOf), outOf, count: line(input.count, 80), note: line(input.note, 120) };
    }
  }
}

function tone(value: unknown): Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value) ? (value as Tone) : "accent";
}

function assetIdOf(value: unknown): string {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : "";
}

function httpsSrc(value: unknown): string {
  const src = line(value, 1000);
  return /^https:\/\//i.test(src) && isHttpUrl(src) ? src : "";
}

/** "4.9" style score, clamped to 0–outOf, one decimal; "" when not a number. */
export function ratingScore(value: unknown, outOf = 5): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".").trim()) : NaN;
  if (!Number.isFinite(n) || (typeof value === "string" && !value.trim())) return "";
  return String(Math.round(Math.max(0, Math.min(outOf, n)) * 10) / 10);
}

/** A features / bonuses line: "~ text" = crossed off (not included in this package). */
export function offerLine(value: string): { text: string; off: boolean } {
  const off = value.startsWith("~");
  return { text: off ? value.slice(1).trim() : value, off };
}

/** An array of plain objects, capped. Anything else is dropped. */
function list(value: unknown, max: number): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, max) : [];
}

/** A bonus line: "Name | value" -> { name, value }. */
export function parseBonus(line: string): { name: string; value: string } {
  const [name, ...rest] = line.split("|");
  return { name: (name ?? "").trim(), value: rest.join("|").trim() };
}

/** Non-empty lines of a multi-line field. */
export function lines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

/** Every block, cleaned, in order, capped at MAX_BLOCKS, with duplicate ids replaced. */
export function normalizeBlocks(raw: unknown, options: NormalizeOptions = {}): Block[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const item of raw) {
    if (blocks.length >= MAX_BLOCKS) break;
    const block = normalizeBlock(item, options);
    if (!block) continue;
    while (seen.has(block.id)) block.id = newBlockId();
    seen.add(block.id);
    blocks.push(block);
  }
  return blocks;
}

/** Move a block to a new index (clamped). Unknown id: unchanged. */
export function moveBlockTo(blocks: readonly Block[], id: string, toIndex: number): Block[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from < 0) return [...blocks];
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved!);
  return next;
}

/** Move a block up (-1) or down (+1). At an edge: unchanged. */
export function moveBlockBy(blocks: readonly Block[], id: string, delta: -1 | 1): Block[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from < 0 || from + delta < 0 || from + delta >= blocks.length) return [...blocks];
  return moveBlockTo(blocks, id, from + delta);
}

/** A copy of the block (new id) right after it. */
export function duplicateBlock(blocks: readonly Block[], id: string, newId: string = newBlockId()): Block[] {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0 || blocks.length >= MAX_BLOCKS) return [...blocks];
  const copy = { ...structuredClone(blocks[index]!), id: newId };
  return [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)];
}

export function removeBlock(blocks: readonly Block[], id: string): Block[] {
  return blocks.filter((block) => block.id !== id);
}

export function updateBlock(blocks: readonly Block[], id: string, patch: Record<string, unknown>): Block[] {
  return blocks.map((block) => (block.id === id ? ({ ...block, ...patch, id: block.id, type: block.type } as Block) : block));
}

/** A starter layout for a new microsite. */
export function starterBlocks(funnelName: string, makeId: () => string = newBlockId): Block[] {
  const make = <T extends BlockType>(type: T, patch: Partial<Extract<Block, { type: T }>> = {}) => ({ ...newBlock(type, makeId()), ...patch }) as Block;
  const escape = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return [
    make("headline", { heading: "Welcome to", accent: funnelName }),
    make("text", { html: `<p>This is the home of <strong>${escape(funnelName)}</strong>. Add the event to your calendar so you don't miss it.</p>` }),
    make("event", { title: funnelName }),
    make("agenda"),
    make("optin"),
    make("hosts"),
  ];
}

/** Padding in px for a block band (top and bottom). */
export const PADDING_PX: Record<BlockPadding, number> = { none: 0, small: 16, medium: 32, large: 56 };
/** Max content width in px for a block. "full" = no cap. */
export const WIDTH_PX: Record<BlockWidth, number | null> = { narrow: 680, standard: 960, wide: 1200, full: null };

/** The inline style for a block band. Every value is validated, so it is safe to hand to React. */
export function blockBandStyle(style: BlockStyle): { background?: string; color?: string; paddingTop: number; paddingBottom: number; textAlign: BlockAlign } {
  const clean = normalizeStyle(style, "text");
  return {
    ...(clean.bg ? { background: clean.bg } : {}),
    ...(clean.text ? { color: clean.text } : {}),
    paddingTop: PADDING_PX[clean.padding],
    paddingBottom: PADDING_PX[clean.padding],
    textAlign: clean.align,
  };
}

/** A one-line summary for the collapsed block card in the builder. */
export function blockSummary(block: Block): string {
  const strip = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  switch (block.type) {
    case "headline":
      return [block.heading, block.accent].filter(Boolean).join(" ") || "No headline yet";
    case "text":
      return strip(block.html).slice(0, 80) || "Empty text";
    case "event":
      return block.title || "Event";
    case "countdown":
      return block.heading || `Counts down to the ${block.target === "custom" ? "set time" : block.target}`;
    case "agenda":
      return `${block.heading || "Agenda"} · ${block.layout === "cards" ? "cards" : "list"}`;
    case "optin":
      return `${block.heading || "Opt-in"} · ${block.mode === "form" ? block.formSlug || "pick a form" : block.mode === "sms" ? "SMS" : "email"}`;
    case "hosts":
      return block.heading || "Hosts";
    case "button":
      return block.label ? `${block.label} → ${block.target || "no link yet"}` : "No label yet";
    case "image":
      return block.alt || (block.assetId || block.src ? "Image" : "No image yet");
    case "html":
      return block.html.trim() ? `${block.title} · ${block.html.length} characters` : "No HTML yet";
    case "divider":
      return "Line";
    case "pricing":
      return block.tiers.map((tier) => [tier.name, tier.price].filter(Boolean).join(" ")).join(" · ") || "No packages yet";
    case "testimonials":
      return `${block.heading || "Testimonials"} · ${block.items.length}`;
    case "logos":
      return `${block.heading || "Logos"} · ${block.items.length}`;
    case "faq":
      return `${block.heading || "FAQ"} · ${block.items.length} questions`;
    case "episodes":
      return block.heading || "Episode grid";
    case "rating":
      return block.score ? `${block.score} out of ${block.outOf}${block.count ? ` · ${block.count}` : ""}` : "No score yet";
  }
}
