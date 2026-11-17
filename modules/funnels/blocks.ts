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

export const BLOCK_TYPES = ["headline", "text", "event", "countdown", "agenda", "optin", "hosts", "button", "image", "html", "divider"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_INFO: Record<BlockType, { label: string; description: string }> = {
  headline: { label: "Headline", description: "Eyebrow, a big headline with an accent part, and a subhead" },
  text: { label: "Text", description: "Paragraphs, lists, links and images" },
  event: { label: "Event box", description: "Title, date, countdown and add-to-calendar" },
  countdown: { label: "Countdown", description: "Counts down to the start, the close or a set time" },
  agenda: { label: "Agenda", description: "The schedule, built from your modules: a list or thumbnail cards" },
  optin: { label: "Opt-in", description: "A published form, or the simple email capture" },
  hosts: { label: "Meet your hosts", description: "The hosts from the Hosts tab" },
  button: { label: "Button", description: "A button to any web address, a module or a page" },
  image: { label: "Image", description: "One image, optionally linked" },
  html: { label: "Custom HTML", description: "Embed code, run in a sandbox" },
  divider: { label: "Divider", description: "A thin line between sections" },
};

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

export type HeadlineBlock = Base<"headline"> & { eyebrow: string; heading: string; accent: string; sub: string };
export type TextBlock = Base<"text"> & { html: string };
/** `at` is an ISO instant; "" = the funnel start. */
export type EventBlock = Base<"event"> & { eyebrow: string; title: string; when: string; at: string; minutes: number; countdown: boolean; calendar: boolean };
export type CountdownBlock = Base<"countdown"> & { heading: string; target: "start" | "end" | "custom"; at: string };
export type AgendaBlock = Base<"agenda"> & { heading: string; layout: "list" | "cards"; linkModules: boolean };
export type OptinBlock = Base<"optin"> & { heading: string; intro: string; mode: "email" | "form"; formSlug: string; buttonText: string };
export type HostsBlock = Base<"hosts"> & { heading: string; layout: "grid" | "stacked" };
/** `target` = an http(s) URL, `module:<n>` or `page:<slug>`. */
export type ButtonBlock = Base<"button"> & { label: string; target: string; newTab: boolean };
export type ImageBlock = Base<"image"> & { assetId: string; src: string; alt: string; href: string; newTab: boolean; widthPercent: number };
export type HtmlBlock = Base<"html"> & { title: string; html: string; height: number };
export type DividerBlock = Base<"divider">;

export type Block = HeadlineBlock | TextBlock | EventBlock | CountdownBlock | AgendaBlock | OptinBlock | HostsBlock | ButtonBlock | ImageBlock | HtmlBlock | DividerBlock;

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
};

/** Per-type field defaults (without id, type and style). */
export const BLOCK_DEFAULTS = {
  headline: { eyebrow: "", heading: "Welcome to", accent: "", sub: "" },
  text: { html: "" },
  event: { eyebrow: "The main event", title: "", when: "", at: "", minutes: 60, countdown: true, calendar: true },
  countdown: { heading: "", target: "start", at: "" },
  agenda: { heading: "Schedule", layout: "cards", linkModules: true },
  optin: { heading: "Save your seat", intro: "", mode: "email", formSlug: "", buttonText: "Sign me up" },
  hosts: { heading: "Meet your hosts", layout: "grid" },
  button: { label: "Watch the first video", target: "module:1", newTab: false },
  image: { assetId: "", src: "", alt: "", href: "", newTab: false, widthPercent: 100 },
  html: { title: "Embed", html: "", height: 0 },
  divider: {},
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
      return { id, type, style, eyebrow: line(input.eyebrow, 120), heading: line(input.heading, 200, d.headline.heading), accent: line(input.accent, 200), sub: str(input.sub, 600).trim() };
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
      return { id, type, style, heading: line(input.heading, 200), target: oneOf(input.target, ["start", "end", "custom"] as const, "start"), at: isoOrEmpty(input.at) };
    case "agenda":
      return { id, type, style, heading: line(input.heading, 200, d.agenda.heading), layout: oneOf(input.layout, ["list", "cards"] as const, "cards"), linkModules: flag(input.linkModules, true) };
    case "optin":
      return {
        id,
        type,
        style,
        heading: line(input.heading, 200, d.optin.heading),
        intro: str(input.intro, 1000).trim(),
        mode: oneOf(input.mode, ["email", "form"] as const, "email"),
        formSlug: /^[a-z0-9-]{1,60}$/.test(String(input.formSlug ?? "")) ? String(input.formSlug) : "",
        buttonText: line(input.buttonText, 40, d.optin.buttonText) || d.optin.buttonText,
      };
    case "hosts":
      return { id, type, style, heading: line(input.heading, 200, d.hosts.heading), layout: oneOf(input.layout, ["grid", "stacked"] as const, "grid") };
    case "button":
      return { id, type, style, label: line(input.label, 80, d.button.label), target: normalizeTarget(input.target), newTab: flag(input.newTab, false) };
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
  }
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
      return `${block.heading || "Opt-in"} · ${block.mode === "form" ? block.formSlug || "pick a form" : "email"}`;
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
  }
}
