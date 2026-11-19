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
  { key: "free", label: "Free subscribers", hint: "Signed-in readers, including free newsletter subscribers" },
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
  if (post.access === "public") return { allowed: true };
  if (!viewer.signedIn) return { allowed: false, reason: post.access === "free" ? "sign-in" : "upgrade" };
  if (post.access === "free") return { allowed: true };
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
  return /^\/(?!\/)[A-Za-z0-9/_.-]{0,300}$/.test(text) && !text.includes("..") ? text : fallback;
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

export type MenuItem = { label: string; href: string };

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

export function menuFrom(value: unknown): MenuItem[] {
  return parseMenu(menuToText(value));
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
