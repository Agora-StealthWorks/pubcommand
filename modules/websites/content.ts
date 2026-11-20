/**
 * Pure rules for the Websites app: slugs, post states, access, teasers and paths.
 * No database; unit tested in websites.test.ts.
 */

export const POST_KINDS = ["post", "page"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_STATUSES = ["draft", "pending", "scheduled", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const ACCESS_LEVELS = [
  { key: "public", label: "Public", hint: "Anyone, on the public website" },
  { key: "members", label: "Members of this publication", hint: "Readers whose product includes the publication" },
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number]["key"];

export const CONTENT_TYPES = [
  { key: "article", label: "Article" },
  { key: "issue", label: "Issue" },
  { key: "alert", label: "Trade alert" },
  { key: "update", label: "Portfolio update" },
  { key: "report", label: "Special report" },
  { key: "guide", label: "Getting started" },
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number]["key"];

/** Posts are public or for members. There are no free accounts: "free" (older rows) reads as public. */
export function isAccessLevel(value: string): value is AccessLevel {
  return ACCESS_LEVELS.some((level) => level.key === value);
}

export function isContentType(value: string): value is ContentType {
  return CONTENT_TYPES.some((type) => type.key === value);
}

export function contentTypeLabel(value: string): string {
  return CONTENT_TYPES.find((type) => type.key === value)?.label ?? "Article";
}

export function normalizeSlug(input: string, max = 80): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug);
}

/** First path segments the public site uses itself; a post or page cannot take them. */
export const RESERVED_SLUGS = [
  "latest",
  "category",
  "tag",
  "newsletters",
  "research",
  "editors",
  "editor",
  "subscribe",
  "sign-in",
  "sign-out",
  "my",
  "media",
  "logo",
  "pub-logo",
  "editor-photo",
  "search",
  "feed",
  "sitemap.xml",
  "robots.txt",
  "api",
  "login",
  "admin",
  "settings",
  "auth",
  // Public prefixes: on a custom domain "/f/…", "/w/…" etc. are read as absolute paths.
  "f",
  "embed",
  "p",
  "l",
  "b",
  "t",
  "w",
] as const;

export function safePostSlug(wanted: string, fallback = "post"): string {
  let slug = normalizeSlug(wanted) || fallback;
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) slug = `${slug}-1`;
  return slug;
}

/** What a post's state is right now. A "scheduled" post whose time has passed is live. */
export function effectiveStatus(post: { status: string; publishedAt: Date | null }, now: Date): PostStatus {
  if (post.status === "scheduled" && post.publishedAt && post.publishedAt <= now) return "published";
  if (post.status === "published" && post.publishedAt && post.publishedAt > now) return "scheduled";
  return (POST_STATUSES as readonly string[]).includes(post.status) ? (post.status as PostStatus) : "draft";
}

export function isLive(post: { status: string; publishedAt: Date | null; deletedAt?: Date | null }, now: Date): boolean {
  return !post.deletedAt && effectiveStatus(post, now) === "published";
}

/** Status chosen in the editor + date → what to store. */
export function statusForSave(input: { wanted: string; publishAt: Date | null; canPublish: boolean; now: Date }): { status: PostStatus; publishedAt: Date | null } {
  const { wanted, publishAt, canPublish, now } = input;
  if (wanted === "publish" || wanted === "schedule") {
    if (!canPublish) return { status: "pending", publishedAt: publishAt };
    const when = publishAt ?? now;
    return { status: when > now ? "scheduled" : "published", publishedAt: when };
  }
  if (wanted === "pending") return { status: "pending", publishedAt: publishAt };
  return { status: "draft", publishedAt: publishAt };
}

// ---------------------------------------------------------------------------
// Access

export type Entitlement = { productId: string; status: string; startsAt: Date; endsAt: Date | null };
export type Product = { id: string; publicationIds: readonly string[]; allPublications: boolean; active: boolean };

/** Entitlements that give access today. "past_due" keeps access until its end date (the grace period). */
export function entitlementActive(entitlement: Entitlement, now: Date): boolean {
  if (entitlement.startsAt > now) return false;
  if (entitlement.endsAt && entitlement.endsAt <= now) return false;
  return entitlement.status === "active" || entitlement.status === "past_due";
}

export type Access = { all: boolean; publicationIds: Set<string>; paid: boolean };

/** The publications a member can read today, from their entitlements and the product grid. */
export function memberAccess(entitlements: readonly Entitlement[], products: readonly Product[], now: Date): Access {
  const byId = new Map(products.map((product) => [product.id, product]));
  const access: Access = { all: false, publicationIds: new Set(), paid: false };
  for (const entitlement of entitlements) {
    if (!entitlementActive(entitlement, now)) continue;
    const product = byId.get(entitlement.productId);
    if (!product) continue;
    access.paid = true;
    if (product.allPublications) access.all = true;
    for (const id of product.publicationIds) access.publicationIds.add(id);
  }
  return access;
}

export type Viewer = { signedIn: false } | { signedIn: true; access: Access };

export type ReadDecision = { allowed: true } | { allowed: false; reason: "sign-in" | "upgrade" };

/** May this viewer read the whole post? */
export function canRead(post: { access: string; publicationId: string | null }, viewer: Viewer): ReadDecision {
  if (post.access !== "members") return { allowed: true };
  if (!viewer.signedIn) return { allowed: false, reason: "upgrade" };
  const { access } = viewer;
  if (access.all) return { allowed: true };
  if (post.publicationId ? access.publicationIds.has(post.publicationId) : access.paid) return { allowed: true };
  return { allowed: false, reason: "upgrade" };
}

/** Does the viewer own this publication (for the "My subscriptions" grid)? */
export function ownsPublication(access: Access, publicationId: string): boolean {
  return access.all || access.publicationIds.has(publicationId);
}

// ---------------------------------------------------------------------------
// Teasers

/**
 * The first `paragraphs` top-level blocks of sanitized HTML, for the part of a
 * locked post everyone may see. Splits on closing block tags only, so it never
 * cuts inside an element.
 */
export function teaserHtml(html: string, paragraphs: number): string {
  const count = Math.max(0, Math.min(10, Math.round(paragraphs)));
  if (count === 0) return "";
  const blocks = html.match(/<(p|h[2-6]|blockquote|ul|ol|figure)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  return blocks.slice(0, count).join("");
}

/** Plain-text excerpt for cards and meta descriptions. */
export function excerptFrom(html: string, max = 200): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export function readingMinutes(html: string): number {
  const words = excerptFrom(html, 1_000_000).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

// ---------------------------------------------------------------------------
// Paths

export const SITE_PREFIX = "w";

/** Canonical path of a site page on the org host: `/w/<site>` or `/w/<site>/<rest>`. */
export function sitePath(siteSlug: string, rest = ""): string {
  const tail = rest.replace(/^\/+/, "");
  return `/${SITE_PREFIX}/${siteSlug}${tail ? `/${tail}` : ""}`;
}

/** Link prefix for pages: `/w/<site>` on the org host, "" on a custom domain whose root is the site. */
export function publicBaseFor(pathname: string, siteSlug: string): string {
  const own = sitePath(siteSlug);
  return pathname === own || pathname.startsWith(`${own}/`) ? own : "";
}

/** A safe same-site return path from a form or query ("/my", "/w/x/post"). */
export function safeReturnPath(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  const [path = "", hash] = text.split("#", 2);
  const okPath = /^\/(?!\/)[A-Za-z0-9/_.-]{0,300}$/.test(path) && !path.includes("..");
  const okHash = hash === undefined || /^[A-Za-z0-9_-]{1,60}$/.test(hash);
  return okPath && okHash ? text : fallback;
}

// ---------------------------------------------------------------------------
// Theme

export type SiteTheme = { primary: string; accent: string; accentOnLight: string; cream: string; ink: string };

export const DEFAULT_THEME: SiteTheme = { primary: "#10213a", accent: "#c49a4e", accentOnLight: "#8a6a2e", cream: "#f3ede1", ink: "#111111" };

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function themeFrom(value: unknown): SiteTheme {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof SiteTheme) => (isHexColor(input[key]) ? String(input[key]).toLowerCase() : DEFAULT_THEME[key]);
  return { primary: pick("primary"), accent: pick("accent"), accentOnLight: pick("accentOnLight"), cream: pick("cream"), ink: pick("ink") };
}

/** A menu as the site renders it: top-level items with optional dropdown children (one level). */
export type MenuItem = { label: string; href: string; children?: MenuItem[] };

/** Header menu from "Label | /path" lines. Only same-site paths and http(s) links. */
export function parseMenu(text: string, max = 12): MenuItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts): parts is [string, string] => parts.length >= 2 && Boolean(parts[0]) && Boolean(parts[1]))
    .map(([label, href]) => ({ label: label.slice(0, 40), href: href.slice(0, 300) }))
    .filter((item) => /^\/(?!\/)/.test(item.href) || /^https?:\/\//i.test(item.href))
    .slice(0, max);
}

export function menuToText(items: unknown): string {
  return Array.isArray(items)
    ? items
        .filter((item): item is MenuItem => Boolean(item) && typeof item === "object" && typeof (item as MenuItem).label === "string" && typeof (item as MenuItem).href === "string")
        .map((item) => `${item.label} | ${item.href}`)
        .join("\n")
    : "";
}

/**
 * A menu as stored (Websites → Menus, like WordPress): a flat list in order; an item
 * with a `parent` sits in that top-level item's dropdown. `kind` records where it came
 * from (page, category, publication, builtin, custom) for the editor.
 */
export type NavItem = { id: string; label: string; href: string; parent: string | null; kind: string };

export const NAV_MAX = 40;

function navHref(value: unknown): string {
  const text = typeof value === "string" ? value.trim().slice(0, 300) : "";
  if (/^\/(?!\/)/.test(text)) return text;
  return /^https?:\/\//i.test(text) ? text : "";
}

export function newNavId(): string {
  return `n${Math.random().toString(36).slice(2, 10)}`;
}

/** Stored JSON → clean flat items. Older menus ({label, href}) get ids; bad links, loops and deep nesting are dropped. */
export function navItemsFrom(value: unknown): NavItem[] {
  const rows = Array.isArray(value) ? value : [];
  const items: NavItem[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const raw = row as Record<string, unknown>;
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 40) : "";
    const href = navHref(raw.href);
    if (!label || !href) return;
    let id = typeof raw.id === "string" && /^[a-z0-9]{2,20}$/i.test(raw.id) ? raw.id : `n${index}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    items.push({ id, label, href, parent: typeof raw.parent === "string" ? raw.parent : null, kind: typeof raw.kind === "string" ? raw.kind.slice(0, 20) : "custom" });
  });
  // Parents must be top-level items in this menu (one level of dropdown).
  const topLevel = new Set(items.filter((item) => !item.parent).map((item) => item.id));
  for (const item of items) if (item.parent && (!topLevel.has(item.parent) || item.parent === item.id)) item.parent = null;
  return items.slice(0, NAV_MAX);
}

/** Flat items → the tree the site renders. */
export function navTree(items: readonly NavItem[]): MenuItem[] {
  return items
    .filter((item) => !item.parent)
    .map((item) => {
      const children = items.filter((child) => child.parent === item.id).map((child) => ({ label: child.label, href: child.href }));
      return children.length ? { label: item.label, href: item.href, children } : { label: item.label, href: item.href };
    });
}

export function menuFrom(value: unknown): MenuItem[] {
  return navTree(navItemsFrom(value));
}

/** "Add to menu": new items go at the end, skipping links already in the menu. */
export function addNavItems(items: readonly NavItem[], added: { label: string; href: string; kind: string }[]): NavItem[] {
  const out = [...items];
  for (const item of added) {
    const href = navHref(item.href);
    const label = item.label.trim().slice(0, 40);
    if (!href || !label || out.some((existing) => existing.href === href && !existing.parent)) continue;
    out.push({ id: newNavId(), label, href, parent: null, kind: item.kind });
  }
  return navItemsFrom(out);
}

export type NavFormRow = { id: string; label: string; href: string; position: number; parent: string | null; remove: boolean };

/**
 * The editor's "Save menu": labels, links, order (position numbers), dropdown parent and
 * removals. Children of a removed item move to the top level. An item that has children
 * stays top-level (dropdowns are one level deep). Children follow their parent.
 */
export function applyNavForm(items: readonly NavItem[], rows: readonly NavFormRow[]): NavItem[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept = items
    .map((item, index) => ({ item, row: byId.get(item.id), index }))
    .filter(({ row }) => !row?.remove)
    .map(({ item, row, index }) => ({
      item: { ...item, label: row?.label.trim().slice(0, 40) || item.label, href: navHref(row?.href) || item.href, parent: row ? row.parent : item.parent },
      position: row?.position ?? index + 1,
      index,
    }));
  const ids = new Set(kept.map(({ item }) => item.id));
  const parents = new Set(kept.filter(({ item }) => item.parent).map(({ item }) => item.parent));
  for (const entry of kept) {
    const parent = entry.item.parent;
    const parentEntry = kept.find(({ item }) => item.id === parent);
    if (!parent || !ids.has(parent) || parent === entry.item.id || parents.has(entry.item.id) || parentEntry?.item.parent) entry.item.parent = null;
  }
  const sorted = [...kept].sort((a, b) => a.position - b.position || a.index - b.index).map(({ item }) => item);
  const ordered: NavItem[] = [];
  for (const top of sorted.filter((item) => !item.parent)) {
    ordered.push(top, ...sorted.filter((item) => item.parent === top.id));
  }
  return navItemsFrom(ordered);
}

/** Header link: site paths get the site prefix, full URLs stay as they are. */
export function menuHref(base: string, href: string): string {
  return href.startsWith("/") ? `${base}${href === "/" && base ? "" : href}` || "/" : href;
}

// ---------------------------------------------------------------------------
// Members

export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export const ENTITLEMENT_SOURCES = ["manual", "comp", "import", "purchase"] as const;
export const ENTITLEMENT_STATUSES = ["active", "past_due", "cancelled"] as const;

/** CSV cell, quoted when needed and protected against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// ---------------------------------------------------------------------------
// Market ticker (prices come from Massive through PubCommand; only symbols are chosen)

export type TickerSymbol = { label: string; symbol: string };

/** Massive's plan has no index values (I:SPX), so the defaults are the funds that track them, labelled as such. */
export const DEFAULT_TICKER: TickerSymbol[] = [
  { label: "S&P 500 (SPY)", symbol: "SPY" },
  { label: "Dow (DIA)", symbol: "DIA" },
  { label: "Nasdaq 100 (QQQ)", symbol: "QQQ" },
  { label: "Gold (GLD)", symbol: "GLD" },
  { label: "Bitcoin", symbol: "X:BTCUSD" },
];

/** "Label | SYMBOL" per line (or just "SYMBOL"). Empty text means the defaults. */
export function parseTickerSymbols(text: string, max = 10): TickerSymbol[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map((parts) => (parts.length >= 2 ? { label: parts[0]!, symbol: parts[1]! } : { label: parts[0]!, symbol: parts[0]! }))
    .map((row) => ({ label: row.label.slice(0, 30), symbol: row.symbol.toUpperCase() }))
    .filter((row) => /^[A-Z0-9][A-Z0-9.:^-]{0,14}$/.test(row.symbol));
  return rows.length ? rows.slice(0, max) : DEFAULT_TICKER;
}

/** Last close vs the one before, from daily bars sorted oldest first. */
export function quoteFromBars(bars: readonly { t: number; c: number }[]): { price: number; change: number; changePct: number; asOf: string } | null {
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!last || !prev || !(prev.c > 0)) return null;
  const change = last.c - prev.c;
  return { price: last.c, change, changePct: (change / prev.c) * 100, asOf: new Date(last.t).toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Member passwords

export const PASSWORD_MIN = 10;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > 200) return "That password is too long.";
  if (/^\s|\s$/.test(password)) return "Remove spaces at the start or end.";
  return null;
}

// ---------------------------------------------------------------------------
// Homepage builder (Site settings → Homepage): sections, each on/off, in any order.

export const HOME_SECTIONS = [
  { key: "hero", label: "Hero banner", hint: "Your own headline, text, image, buttons and an optional email box" },
  { key: "featured", label: "Featured story + latest headlines", hint: "The post ticked \"Feature on the homepage\" (or the newest), with the four latest beside it" },
  { key: "signup", label: "Newsletter sign-up bar", hint: "The newsletter chosen in Site settings" },
  { key: "picks", label: "Editors' picks", hint: "Four article cards" },
  { key: "latest", label: "Latest articles + free newsletters box", hint: "A list of recent articles with a multi-newsletter sign-up" },
  { key: "research", label: "Premium research", hint: "Your paid publications from Publication Setup" },
  { key: "editors", label: "Meet our editors", hint: "Editors from Publication Setup" },
] as const;
export type HomeSectionKey = (typeof HOME_SECTIONS)[number]["key"];
export type HomeSection = { key: HomeSectionKey; on: boolean };

export type Hero = {
  kicker: string;
  headline: string;
  text: string;
  imageAssetId: string | null;
  buttonLabel: string;
  buttonHref: string;
  button2Label: string;
  button2Href: string;
  /** Free newsletter whose email form sits in the hero (null = no form). */
  signupPublicationId: string | null;
};

export type Homepage = { sections: HomeSection[]; hero: Hero };

/** Today's layout, used until someone saves the builder. */
export const DEFAULT_HOME_ORDER: HomeSectionKey[] = ["hero", "featured", "signup", "picks", "latest", "research", "editors"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A same-site path or an http(s) link; anything else is dropped. */
export function safeHref(value: unknown): string {
  const text = str(value, 500);
  if (/^\/(?!\/)/.test(text)) return text;
  return /^https?:\/\//i.test(text) ? text : "";
}

/** Stored JSON → a complete layout: every section once, known keys only, in the saved order. */
export function homepageFrom(value: unknown): Homepage {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const hero = input.hero && typeof input.hero === "object" ? (input.hero as Record<string, unknown>) : {};
  const saved = Array.isArray(input.sections) ? input.sections : [];
  const keys = new Set<string>(HOME_SECTIONS.map((section) => section.key));
  const sections: HomeSection[] = [];
  for (const row of saved) {
    const key = row && typeof row === "object" ? (row as { key?: unknown }).key : undefined;
    if (typeof key === "string" && keys.has(key) && !sections.some((section) => section.key === key)) {
      sections.push({ key: key as HomeSectionKey, on: (row as { on?: unknown }).on !== false });
    }
  }
  for (const key of DEFAULT_HOME_ORDER) if (!sections.some((section) => section.key === key)) sections.push({ key, on: key !== "hero" });
  return {
    sections,
    hero: {
      kicker: str(hero.kicker, 60),
      headline: str(hero.headline, 160),
      text: str(hero.text, 600),
      imageAssetId: typeof hero.imageAssetId === "string" && UUID.test(hero.imageAssetId) ? hero.imageAssetId : null,
      buttonLabel: str(hero.buttonLabel, 40),
      buttonHref: safeHref(hero.buttonHref),
      button2Label: str(hero.button2Label, 40),
      button2Href: safeHref(hero.button2Href),
      signupPublicationId: typeof hero.signupPublicationId === "string" && UUID.test(hero.signupPublicationId) ? hero.signupPublicationId : null,
    },
  };
}

/** Builder form rows (key, on, position) → ordered sections. Ties keep the current order. */
export function orderSections(rows: { key: string; on: boolean; position: number }[]): HomeSection[] {
  const keys = new Set<string>(HOME_SECTIONS.map((section) => section.key));
  return rows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => keys.has(row.key))
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((row) => ({ key: row.key as HomeSectionKey, on: row.on }));
}
