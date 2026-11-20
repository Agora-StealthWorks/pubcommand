/**
 * Funnel design tokens (Design tab) and the CSS generated from them. PURE and
 * browser-safe.
 *
 * Everything a public funnel page looks like comes from one validated `Design`:
 * header, page, content box (text modules + custom pages), navigation tiles and
 * footer. `normalizeDesign` is the only way in: every colour is a #rrggbb hex,
 * every number is clamped and every choice comes from an allow-list, so
 * `designCss` can write the values straight into a <style> tag with no way to
 * inject CSS or markup. Image addresses go through `cssUrl`, which accepts only
 * same-site paths and https URLs made of safe characters.
 */
import { contrastText, isHexColor, isHttpUrl } from "./checks";

export const FONTS = {
  system: { label: "System (clean sans-serif)", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', google: null },
  serif: { label: "Classic serif", stack: 'Georgia, Cambria, "Times New Roman", Times, serif', google: null },
  inter: { label: "Inter", stack: '"Inter", system-ui, sans-serif', google: "Inter:wght@400;500;600;700;800" },
  montserrat: { label: "Montserrat", stack: '"Montserrat", system-ui, sans-serif', google: "Montserrat:wght@400;500;600;700;800" },
  lato: { label: "Lato", stack: '"Lato", system-ui, sans-serif', google: "Lato:wght@400;700;900" },
  merriweather: { label: "Merriweather (serif)", stack: '"Merriweather", Georgia, serif', google: "Merriweather:wght@400;700;900" },
  playfair: { label: "Playfair Display (serif)", stack: '"Playfair Display", Georgia, serif', google: "Playfair+Display:wght@400;600;700;800" },
} as const;
export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as FontKey[];

export const GRADIENT_DIRS = ["to right", "to bottom", "135deg", "45deg"] as const;
export const IMAGE_FITS = ["fill", "fit", "tile"] as const;
export const IMAGE_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;
export const HEADER_WIDTHS = ["standard", "wide", "full"] as const;
export const ALIGNS = ["left", "center", "right"] as const;
export const LOGO_LINKS = ["none", "home", "url"] as const;
export const BUTTON_STYLES = ["fill", "outline"] as const;
export const THUMB_STYLES = ["rounded", "square", "pill"] as const;
export const ACTIVE_STYLES = ["ring", "underline", "bold"] as const;
export const LOCKED_STYLES = ["lock_dim", "lock", "dim"] as const;
export const NAV_FADES = ["others", "locked", "none"] as const;

type OneOf<T extends readonly string[]> = T[number];

export type FooterLink = { label: string; url: string };

export type Design = {
  header: {
    bg: string;
    /** Second colour: set = a gradient from bg to bg2. */
    bg2: string | null;
    gradientDir: OneOf<typeof GRADIENT_DIRS>;
    imageAssetId: string | null;
    imageUrl: string | null;
    imageFit: OneOf<typeof IMAGE_FITS>;
    imagePos: OneOf<typeof IMAGE_POSITIONS>;
    /** Header colour laid over the image, 0–100 %. */
    dim: number;
    paddingY: number;
    width: OneOf<typeof HEADER_WIDTHS>;
    logoHeight: number;
    /** 0 = automatic (the desktop height, capped to the phone width). */
    logoHeightMobile: number;
    logoAlign: OneOf<typeof ALIGNS>;
    logoLink: OneOf<typeof LOGO_LINKS>;
    logoLinkUrl: string | null;
  };
  page: {
    bg: string;
    imageAssetId: string | null;
    imageUrl: string | null;
    text: string;
    accent: string;
    /** Text on accent buttons; null = automatic contrast. */
    buttonText: string | null;
    buttonRadius: number;
    buttonStyle: OneOf<typeof BUTTON_STYLES>;
    font: FontKey;
  };
  content: {
    bg: string;
    /** null = the page text colour. */
    text: string | null;
    /** null = the accent colour. */
    link: string | null;
    border: string;
    borderWidth: number;
    radius: number;
    padding: number;
  };
  nav: {
    bg: string | null;
    text: string | null;
    thumbWidth: number;
    thumbStyle: OneOf<typeof THUMB_STYLES>;
    activeStyle: OneOf<typeof ACTIVE_STYLES>;
    lockedStyle: OneOf<typeof LOCKED_STYLES>;
    fade: OneOf<typeof NAV_FADES>;
  };
  footer: {
    bg: string;
    text: string;
    showLogo: boolean;
    logoAssetId: string | null;
    logoUrl: string | null;
    /** null = the header logo height. */
    logoHeight: number | null;
    links: FooterLink[];
  };
};

/** Old flat columns on the funnel row, used when the design JSON lacks a value. */
export type LegacyDesign = { headerBg?: string | null; pageBg?: string | null; textColor?: string | null; accentColor?: string | null; logoHeight?: number | null };

export const DEFAULT_DESIGN: Design = {
  header: {
    bg: "#111827",
    bg2: null,
    gradientDir: "to right",
    imageAssetId: null,
    imageUrl: null,
    imageFit: "fill",
    imagePos: "center",
    dim: 40,
    paddingY: 14,
    width: "standard",
    logoHeight: 40,
    logoHeightMobile: 0,
    logoAlign: "center",
    logoLink: "home",
    logoLinkUrl: null,
  },
  page: { bg: "#f5f6f8", imageAssetId: null, imageUrl: null, text: "#1f2937", accent: "#1d4ed8", buttonText: null, buttonRadius: 8, buttonStyle: "fill", font: "system" },
  content: { bg: "#ffffff", text: null, link: null, border: "#e5e7eb", borderWidth: 1, radius: 12, padding: 20 },
  nav: { bg: null, text: null, thumbWidth: 160, thumbStyle: "rounded", activeStyle: "ring", lockedStyle: "lock_dim", fade: "locked" },
  footer: { bg: "#ffffff", text: "#4b5563", showLogo: false, logoAssetId: null, logoUrl: null, logoHeight: null, links: [] },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && isHexColor(value) ? value.trim().toLowerCase() : fallback;
}

/** A colour that may be unset: "" / null = unset; anything invalid keeps the fallback. */
function hexOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null || value === "") return null;
  return typeof value === "string" && isHexColor(value) ? value.trim().toLowerCase() : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function pick<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : fallback;
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function httpsOrNull(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\//i.test(value.trim()) && isHttpUrl(value) ? value.trim().slice(0, 1000) : null;
}

function httpOrNull(value: unknown): string | null {
  return typeof value === "string" && isHttpUrl(value) ? value.trim().slice(0, 1000) : null;
}

function links(value: unknown): FooterLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => obj(item))
    .map((item) => ({ label: typeof item.label === "string" ? item.label.replace(/\s+/g, " ").trim().slice(0, 60) : "", url: httpOrNull(item.url) ?? "" }))
    .filter((item) => item.label && item.url)
    .slice(0, 8);
}

/** The complete, validated design. Missing values fall back to the legacy columns, then defaults. */
export function normalizeDesign(raw: unknown, legacy: LegacyDesign = {}): Design {
  const d = DEFAULT_DESIGN;
  const input = obj(raw);
  const header = obj(input.header);
  const page = obj(input.page);
  const content = obj(input.content);
  const nav = obj(input.nav);
  const footer = obj(input.footer);
  const legacyHeader = hex(legacy.headerBg, d.header.bg);
  const legacyLogo = num(legacy.logoHeight, d.header.logoHeight, 16, 240);
  return {
    header: {
      bg: hex(header.bg, legacyHeader),
      bg2: hexOrNull(header.bg2, null),
      gradientDir: pick(header.gradientDir, GRADIENT_DIRS, d.header.gradientDir),
      imageAssetId: uuidOrNull(header.imageAssetId),
      imageUrl: httpsOrNull(header.imageUrl),
      imageFit: pick(header.imageFit, IMAGE_FITS, d.header.imageFit),
      imagePos: pick(header.imagePos, IMAGE_POSITIONS, d.header.imagePos),
      dim: num(header.dim, d.header.dim, 0, 100),
      paddingY: num(header.paddingY, d.header.paddingY, 0, 120),
      width: pick(header.width, HEADER_WIDTHS, d.header.width),
      logoHeight: num(header.logoHeight, legacyLogo, 16, 240),
      logoHeightMobile: num(header.logoHeightMobile, 0, 0, 200),
      logoAlign: pick(header.logoAlign, ALIGNS, d.header.logoAlign),
      logoLink: pick(header.logoLink, LOGO_LINKS, d.header.logoLink),
      logoLinkUrl: httpOrNull(header.logoLinkUrl),
    },
    page: {
      bg: hex(page.bg, hex(legacy.pageBg, d.page.bg)),
      imageAssetId: uuidOrNull(page.imageAssetId),
      imageUrl: httpsOrNull(page.imageUrl),
      text: hex(page.text, hex(legacy.textColor, d.page.text)),
      accent: hex(page.accent, hex(legacy.accentColor, d.page.accent)),
      buttonText: hexOrNull(page.buttonText, null),
      buttonRadius: num(page.buttonRadius, d.page.buttonRadius, 0, 40),
      buttonStyle: pick(page.buttonStyle, BUTTON_STYLES, d.page.buttonStyle),
      font: pick(page.font, FONT_KEYS, d.page.font) as FontKey,
    },
    content: {
      bg: hex(content.bg, d.content.bg),
      text: hexOrNull(content.text, null),
      link: hexOrNull(content.link, null),
      border: hex(content.border, d.content.border),
      borderWidth: num(content.borderWidth, d.content.borderWidth, 0, 8),
      radius: num(content.radius, d.content.radius, 0, 40),
      padding: num(content.padding, d.content.padding, 0, 64),
    },
    nav: {
      bg: hexOrNull(nav.bg, null),
      text: hexOrNull(nav.text, null),
      thumbWidth: num(nav.thumbWidth, d.nav.thumbWidth, 80, 320),
      thumbStyle: pick(nav.thumbStyle, THUMB_STYLES, d.nav.thumbStyle),
      activeStyle: pick(nav.activeStyle, ACTIVE_STYLES, d.nav.activeStyle),
      lockedStyle: pick(nav.lockedStyle, LOCKED_STYLES, d.nav.lockedStyle),
      fade: pick(nav.fade, NAV_FADES, d.nav.fade),
    },
    footer: {
      bg: hex(footer.bg, d.footer.bg),
      text: hex(footer.text, d.footer.text),
      showLogo: typeof footer.showLogo === "boolean" ? footer.showLogo : d.footer.showLogo,
      logoAssetId: uuidOrNull(footer.logoAssetId),
      logoUrl: httpsOrNull(footer.logoUrl),
      logoHeight: footer.logoHeight === null || footer.logoHeight === "" || footer.logoHeight === undefined ? null : num(footer.logoHeight, 40, 12, 240),
      links: links(footer.links),
    },
  };
}

/**
 * A value safe inside CSS `url("…")`: a same-site path or an https URL, made
 * only of characters that cannot close the string or the function. Null otherwise.
 */
export function cssUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (text.length > 1000) return null;
  const safe = /^[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+$/;
  if (!safe.test(text)) return null;
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  return /^https:\/\//i.test(text) && isHttpUrl(text) ? text : null;
}

/** The Google Fonts stylesheet for the design's font, or null for a system font. */
export function fontHref(design: Pick<Design, "page">): string | null {
  const family = FONTS[design.page.font]?.google;
  return family ? `https://fonts.googleapis.com/css2?family=${family}&display=swap` : null;
}

const FIT_CSS: Record<Design["header"]["imageFit"], string> = { fill: "background-size:cover;background-repeat:no-repeat", fit: "background-size:contain;background-repeat:no-repeat", tile: "background-size:auto;background-repeat:repeat" };
const WIDTH_CSS: Record<Design["header"]["width"], string> = { standard: "960px", wide: "1280px", full: "none" };
const JUSTIFY: Record<Design["header"]["logoAlign"], string> = { left: "flex-start", center: "center", right: "flex-end" };
const THUMB_RADIUS: Record<Design["nav"]["thumbStyle"], string> = { rounded: "10px", square: "0", pill: "999px" };

/** #rrggbb + alpha 0–1 → rgba(). Input already validated. */
function rgba(hexColor: string, alpha: number): string {
  const value = hexColor.slice(1);
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16));
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
}

export type DesignImages = { header?: string | null; page?: string | null };

/**
 * The stylesheet for one public funnel page, scoped under `.pcf`. Re-validates
 * its input, so it is safe even when handed an unchecked object.
 */
export function designCss(input: Design | unknown, images: DesignImages = {}): string {
  const d = normalizeDesign(input);
  const h = d.header;
  const accentText = d.page.buttonText ?? contrastText(d.page.accent);
  const headerText = contrastText(h.bg);
  const headerFill = h.bg2 ? `linear-gradient(${h.gradientDir},${h.bg},${h.bg2})` : h.bg;
  const headerImage = cssUrl(images.header);
  const pageImage = cssUrl(images.page);
  const contentText = d.content.text ?? d.page.text;
  const contentLink = d.content.link ?? d.page.accent;
  const navText = d.nav.text ?? d.page.text;
  const mobileLogo = h.logoHeightMobile > 0 ? `${h.logoHeightMobile}px` : `${Math.min(h.logoHeight, 64)}px`;
  const dim = h.dim / 100;
  const overlay = h.bg2 ? `linear-gradient(${h.gradientDir},${rgba(h.bg, dim)},${rgba(h.bg2, dim)})` : `linear-gradient(${rgba(h.bg, dim)},${rgba(h.bg, dim)})`;

  const rules: string[] = [
    `.pcf{--pcf-page-bg:${d.page.bg};--pcf-text:${d.page.text};--pcf-accent:${d.page.accent};--pcf-accent-text:${accentText};--pcf-radius:${d.page.buttonRadius}px;--pcf-header-bg:${h.bg};--pcf-header-text:${headerText};--pcf-content-bg:${d.content.bg};--pcf-content-text:${contentText};--pcf-content-link:${contentLink};--pcf-content-border:${d.content.border};--pcf-nav-text:${navText};--pcf-thumb-w:${d.nav.thumbWidth}px;--pcf-footer-bg:${d.footer.bg};--pcf-footer-text:${d.footer.text};background-color:${d.page.bg};color:${d.page.text};font-family:${FONTS[d.page.font].stack}}`,
    pageImage ? `.pcf{background-image:url("${pageImage}");background-size:cover;background-position:center top;background-attachment:scroll}` : "",
    headerImage
      ? `.pcf-header{background-color:${h.bg};background-image:${overlay},url("${headerImage}");${FIT_CSS[h.imageFit]};background-position:${h.imagePos};color:${headerText}}`
      : `.pcf-header{background:${headerFill};color:${headerText}}`,
    `.pcf-header-inner{max-width:${WIDTH_CSS[h.width]};margin:0 auto;display:flex;align-items:center;justify-content:${JUSTIFY[h.logoAlign]};padding:${h.paddingY}px 16px}`,
    `.pcf-logo{display:block;height:auto;width:auto;max-width:100%;max-height:${h.logoHeight}px}`,
    `@media (max-width:640px){.pcf-header-inner{padding:${Math.min(h.paddingY, 24)}px 16px}.pcf-logo{max-height:${mobileLogo}}}`,
    `.pcf-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;max-width:100%;padding:12px 24px;border-radius:var(--pcf-radius);font-weight:700;text-align:center;border:2px solid var(--pcf-accent);${d.page.buttonStyle === "outline" ? "background:transparent;color:var(--pcf-accent)" : "background:var(--pcf-accent);color:var(--pcf-accent-text)"}}`,
    `.pcf-btn:hover{opacity:.9}`,
    `.pcf-btn-quiet{display:inline-flex;align-items:center;min-height:44px;padding:8px 18px;border-radius:var(--pcf-radius);border:2px solid var(--pcf-accent);color:var(--pcf-accent);font-weight:700}`,
    `.pcf-content{background:${d.content.bg};color:${contentText};border:${d.content.borderWidth}px solid ${d.content.border};border-radius:${d.content.radius}px;padding:${d.content.padding}px}`,
    `.pcf-content a{color:${contentLink}}`,
    `.pcf-accent{color:var(--pcf-accent)}`,
    `.pcf-nav{${d.nav.bg ? `background:${d.nav.bg};` : ""}color:${navText}}`,
    `.pcf-tile{width:var(--pcf-thumb-w)}@media (max-width:600px){.pcf-tile{width:min(var(--pcf-thumb-w),120px)}}`,
    `.pcf-thumb{border-radius:${THUMB_RADIUS[d.nav.thumbStyle]};overflow:hidden}`,
    d.nav.activeStyle === "ring"
      ? `.pcf-tile[aria-current="page"] .pcf-thumb{box-shadow:0 0 0 3px var(--pcf-accent)}`
      : d.nav.activeStyle === "underline"
        ? `.pcf-tile[aria-current="page"] .pcf-tile-label{border-bottom:3px solid var(--pcf-accent)}`
        : `.pcf-tile[aria-current="page"] .pcf-tile-label{font-weight:800;color:var(--pcf-accent)}`,
    d.nav.fade === "others" ? `.pcf-tile:not([aria-current="page"]){opacity:.7}.pcf-tile:not([aria-current="page"]):hover{opacity:1}` : "",
    d.nav.fade !== "none" ? `.pcf-tile[data-locked="1"]{opacity:${d.nav.lockedStyle === "lock" ? 1 : 0.5}}` : "",
    `.pcf-tile[data-locked="1"] .pcf-lock{display:${d.nav.lockedStyle === "dim" ? "none" : "flex"}}`,
    `.pcf-footer{background:${d.footer.bg};color:${d.footer.text}}`,
    `.pcf-footer a{color:inherit;text-decoration:underline}`,
  ];
  return rules.filter(Boolean).join("\n");
}

/** Copy the design of one funnel onto another (asset ids are remapped by the caller). */
export function remapDesignAssets(design: Design, remap: (id: string) => string | null): Design {
  const map = (id: string | null) => (id ? remap(id) : null);
  return {
    ...design,
    header: { ...design.header, imageAssetId: map(design.header.imageAssetId) },
    page: { ...design.page, imageAssetId: map(design.page.imageAssetId) },
    footer: { ...design.footer, logoAssetId: map(design.footer.logoAssetId) },
  };
}

/** Asset ids the design points at (for copying and serving). */
export function designAssetIds(design: Design): string[] {
  return [design.header.imageAssetId, design.page.imageAssetId, design.footer.logoAssetId].filter((id): id is string => Boolean(id));
}
