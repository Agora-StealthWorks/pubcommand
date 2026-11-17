/**
 * Logo slots. A publication (and the brand defaults) can hold two logos:
 *
 * - "light": the logo for LIGHT backgrounds (dark artwork). Stored in logo_*.
 * - "dark":  the logo for DARK backgrounds (light artwork). Stored in logo_on_dark_*.
 *
 * Slots are named by the background they sit on, everywhere: forms, the import file
 * (`logoLight` / `logoDark`) and logoFor(). An upload into "either" is sorted by its
 * artwork: toneFromPixels() for raster images, svgArtworkBackground() as the SVG fallback.
 * Pure: the server decodes pixels (features/pubsetup/logo-tone.ts) and calls these.
 */

export type LogoBackground = "light" | "dark";
export type LogoSlots = { light: boolean; dark: boolean };

export const LOGO_SLOT_LABELS: Record<LogoBackground, string> = {
  light: "For light backgrounds",
  dark: "For dark backgrounds",
};

export const LOGO_SLOT_HINTS: Record<LogoBackground, string> = {
  light: "Dark artwork. Shown on white pages and light headers.",
  dark: "Light or white artwork. Shown on dark headers.",
};

/** Relative luminance of a gamma-encoded sRGB channel triple (0-255). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Near-white page vs a near-black header: which one does artwork of this luminance read better on? */
export function backgroundForLuminance(luminance: number): LogoBackground {
  const onWhite = 1.05 / (luminance + 0.05);
  const onDark = (luminance + 0.05) / (0.012 + 0.05);
  return onDark > onWhite ? "dark" : "light";
}

export type ToneResult = {
  /** The background this logo is made for, or null when there is nothing to judge (blank image). */
  background: LogoBackground | null;
  /** Mean relative luminance of what was measured (0 black - 1 white). */
  luminance: number;
  /** True when the image has no transparency: judged by its own background (the border). */
  opaque: boolean;
};

/**
 * Sort a logo from RGBA pixels. With transparency, the artwork is the visible pixels: dark
 * artwork is for light backgrounds. A fully opaque image (a JPEG, a logo on a box) carries
 * its own background, so the border decides: a light border means it was made for light pages.
 */
export function toneFromPixels(pixels: ArrayLike<number>, width: number, height: number, options: { premultiplied?: boolean } = {}): ToneResult {
  const count = width * height;
  if (!count || pixels.length < count * 4) return { background: null, luminance: 0, opaque: false };
  let transparent = 0;
  for (let i = 0; i < count; i += 1) if (pixels[i * 4 + 3]! < 250) transparent += 1;
  const opaque = transparent / count < 0.02;

  let sum = 0;
  let weight = 0;
  const add = (i: number) => {
    const a = pixels[i * 4 + 3]!;
    if (a < 32) return;
    const un = options.premultiplied ? 255 / a : 1;
    const r = Math.min(255, pixels[i * 4]! * un);
    const g = Math.min(255, pixels[i * 4 + 1]! * un);
    const b = Math.min(255, pixels[i * 4 + 2]! * un);
    sum += relativeLuminance(r, g, b) * a;
    weight += a;
  };
  if (opaque) {
    for (let x = 0; x < width; x += 1) {
      add(x);
      add((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      add(y * width);
      add(y * width + width - 1);
    }
  } else {
    for (let i = 0; i < count; i += 1) add(i);
  }
  if (!weight) return { background: null, luminance: 0, opaque };
  const luminance = sum / weight;
  // Opaque: the border IS the background it was made for. Transparent: the artwork reads on the opposite.
  const background = opaque ? (backgroundForLuminance(luminance) === "dark" ? "light" : "dark") : backgroundForLuminance(luminance);
  return { background, luminance, opaque };
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  maroon: "#800000",
  gold: "#ffd700",
};

function parseColor(raw: string): [number, number, number] | null {
  const value = raw.trim().toLowerCase();
  if (!value || value === "none" || value === "transparent" || value.startsWith("url(") || value === "currentcolor" || value === "inherit") return null;
  const hex = NAMED[value] ?? value;
  let m = /^#([0-9a-f]{3})$/.exec(hex);
  if (m) return [0, 1, 2].map((i) => Number.parseInt(m![1]![i]! + m![1]![i]!, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(hex);
  if (m) return [0, 2, 4].map((i) => Number.parseInt(m![1]!.slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((c) => Math.min(255, c)) as [number, number, number];
  return null;
}

/**
 * SVG fallback when it cannot be rasterized: average the fill, stroke and stop colors it
 * names (attributes and inline styles). No color at all means the default black fill.
 */
export function svgArtworkBackground(svg: string): LogoBackground {
  const colors: [number, number, number][] = [];
  const re = /(?:fill|stroke|stop-color|color)\s*(?:=\s*["']([^"']+)["']|:\s*([^;"'}]+))/gi;
  for (const match of svg.matchAll(re)) {
    const color = parseColor(match[1] ?? match[2] ?? "");
    if (color) colors.push(color);
  }
  if (!colors.length) return "light";
  const luminance = colors.reduce((s, [r, g, b]) => s + relativeLuminance(r, g, b), 0) / colors.length;
  return backgroundForLuminance(luminance);
}

export type LogoOwner = { id: string; logos: LogoSlots; updatedAt?: Date | string | number | null };
export type LogoChoice = {
  /** Image kind for the owner's image route. */
  kind: "pub-logo" | "pub-logo-dark" | "brand-logo" | "brand-logo-dark";
  id: string;
  version: number | string | null;
  /** The slot actually used. Differs from the background asked for when only the other one exists. */
  slot: LogoBackground;
  /** "own" = the publication's logo, "fallback" = the brand default. */
  from: "own" | "fallback";
};

function version(v: LogoOwner["updatedAt"]): number | string | null {
  if (v == null) return null;
  return v instanceof Date ? v.getTime() : v;
}

/**
 * The best logo for a background: the owner's matching slot, then its other slot, then the
 * fallback's (the brand defaults) in the same order. Null means none: show a text wordmark.
 */
export function logoFor(owner: LogoOwner | null | undefined, background: LogoBackground, fallback?: LogoOwner | null, kinds: "pub" | "brand" = "pub"): LogoChoice | null {
  const other: LogoBackground = background === "light" ? "dark" : "light";
  const pick = (o: LogoOwner, kindBase: "pub-logo" | "brand-logo", from: LogoChoice["from"]): LogoChoice | null => {
    for (const slot of [background, other]) {
      if (o.logos[slot]) return { kind: (slot === "dark" ? `${kindBase}-dark` : kindBase) as LogoChoice["kind"], id: o.id, version: version(o.updatedAt), slot, from };
    }
    return null;
  };
  return (owner ? pick(owner, kinds === "brand" ? "brand-logo" : "pub-logo", "own") : null) ?? (fallback ? pick(fallback, "brand-logo", "fallback") : null);
}

/** Where an auto-sorted upload lands: its own tone, or the light-background slot when it cannot be told. */
export function slotForUpload(tone: LogoBackground | null): LogoBackground {
  return tone ?? "light";
}
