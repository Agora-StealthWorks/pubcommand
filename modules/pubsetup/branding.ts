import type { LogoSlots } from "./logos";

/**
 * Branding inheritance. A publication's branding field is its own value when set,
 * else the brand default, else the platform default. Logos follow the same rule
 * (pick one with logoFor() in logos.ts). Every app that renders a publication's look calls this.
 */

export const BRANDING_KEYS = [
  "primaryColor",
  "accentColor",
  "textColor",
  "backgroundColor",
  "headingFont",
  "bodyFont",
  "tagline",
] as const;

export type BrandingKey = (typeof BRANDING_KEYS)[number];
export type BrandingValues = Partial<Record<BrandingKey, string | null>>;
export type BrandingSource = "publication" | "brand" | "default";

export type BrandingInput = BrandingValues & { logos?: LogoSlots };

export type ResolvedBranding = {
  values: Record<BrandingKey, string>;
  sources: Record<BrandingKey, BrandingSource>;
  /** Whose logo to show, or null for none (fall back to a text wordmark). */
  logo: "publication" | "brand" | null;
  /** Which logo slots each level fills. Pass these to logoFor(). */
  logos: { publication: LogoSlots; brand: LogoSlots };
};

export function platformDefaults(_brandName: string): Record<BrandingKey, string> {
  return {
    primaryColor: "#1f2a44",
    accentColor: "#1d4ed8",
    textColor: "#1f2937",
    backgroundColor: "#ffffff",
    headingFont: "Georgia",
    bodyFont: "Arial",
    tagline: "",
  };
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Resolve a publication's branding over its brand's defaults. Pass publication null for the brand alone. */
export function resolveBranding(publication: BrandingInput | null, brand: BrandingInput | null, brandName: string): ResolvedBranding {
  const fallback = platformDefaults(brandName);
  const values = {} as Record<BrandingKey, string>;
  const sources = {} as Record<BrandingKey, BrandingSource>;
  for (const key of BRANDING_KEYS) {
    const own = publication?.[key];
    const inherited = brand?.[key];
    if (present(own)) {
      values[key] = own;
      sources[key] = "publication";
    } else if (present(inherited)) {
      values[key] = inherited;
      sources[key] = "brand";
    } else {
      values[key] = fallback[key];
      sources[key] = "default";
    }
  }
  const none: LogoSlots = { light: false, dark: false };
  const pubLogos = publication?.logos ?? none;
  const brandLogos = brand?.logos ?? none;
  const any = (l: LogoSlots) => l.light || l.dark;
  return {
    values,
    sources,
    logo: any(pubLogos) ? "publication" : any(brandLogos) ? "brand" : null,
    logos: { publication: pubLogos, brand: brandLogos },
  };
}

/** Readable text on a colored background: dark or white. */
export function contrastText(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return "#ffffff";
  const n = Number.parseInt(match[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#111827" : "#ffffff";
}
