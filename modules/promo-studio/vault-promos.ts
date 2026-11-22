/**
 * The brain vault's promo library → Promo Analyzer promos and Packager training.
 *
 * Layout: Resources/Promos/{FE's|BE's}/{CODE}/{Tier} {CODE} {Format}s/[promo folder/]file
 *   e.g. "Resources/Promos/FE's/TPU/Winning TPU VSLs/TPU Unicorn Promo_LEGAL_….docx"
 * Tier is the result the team gave it: Winning, Average, Under Performing, Untested.
 * Files named like order forms ("OF", "Order Form") are Packager training examples,
 * not promos. Pure: paths, titles and text only.
 */
import { unzipSync } from "fflate";

export type VaultTier = "winning" | "average" | "under" | "untested";
export type VaultFunnel = "FE" | "BE";
export type VaultFormat = "VSL" | "Live Webinar" | "Evergreen Webinar";

export type VaultPromoPath = {
  funnel: VaultFunnel;
  code: string;
  tier: VaultTier | null;
  format: VaultFormat | null;
  /** Files in the same promo folder belong to one promo; null when the file sits directly in the tier folder. */
  group: string | null;
};

const PROMO_EXTENSIONS = /\.(docx|doc|pptx|pdf|txt|md)$/i;

export function parseVaultPromoPath(path: string): VaultPromoPath | null {
  const parts = path.split("/");
  const at = parts.findIndex((part, i) => part === "Promos" && parts[i - 1] === "Resources");
  if (at < 0) return null;
  const funnelPart = parts[at + 1];
  const funnel: VaultFunnel | null = funnelPart === "FE's" ? "FE" : funnelPart === "BE's" ? "BE" : null;
  if (!funnel) return null;
  const code = parts[at + 2];
  if (!code || !/^[A-Z][A-Z0-9]{1,7}$/.test(code) || parts.length < at + 5) return null;
  if (!PROMO_EXTENSIONS.test(parts[parts.length - 1] ?? "")) return null;
  const bucket = parts[at + 3] ?? "";
  const lower = bucket.toLowerCase();
  const tier: VaultTier | null = lower.startsWith("winning") ? "winning" : lower.startsWith("average") ? "average" : lower.startsWith("under") ? "under" : lower.startsWith("untested") ? "untested" : null;
  const format: VaultFormat | null = /evergreen/.test(lower) ? "Evergreen Webinar" : /webinar/.test(lower) ? "Live Webinar" : /\bvsl/.test(lower) ? "VSL" : null;
  const inner = parts.slice(at + 4, -1);
  return { funnel, code, tier, format, group: inner.length ? [...parts.slice(0, at + 4), inner[0]].join("/") : null };
}

export function isOrderForm(path: string): boolean {
  const file = (path.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  return /(^|[\s_\-(])(OF|O\.F\.)([\s_\-).]|$)/.test(file) || /order\s*form/i.test(file);
}

/** "TPU Unicorn Promo_LEGAL_provisional final….docx" → "TPU Unicorn Promo". Legal/version suffixes go. */
export function cleanPromoTitle(fileName: string): string {
  let title = fileName.replace(/\.[a-z0-9]+$/i, "");
  // Cut where the legal / editor initials trail begins ("_LEGALfinal_RB", "_CSLegal3", "_legaledits_ek1"), keep other underscores as spaces.
  const cut = title.search(/_(?=(?:o?legal|cs ?legal|ci ?edits?|cl?edits|rb|ek\d|cf\d|cw\d|dd|mk\b|kb\b|sp\b|jo\b|ap\b|lkb|final|provisional|cm\b)|[A-Z]{2}\d?\b)/i);
  if (cut > 0) title = title.slice(0, cut);
  title = title.replace(/_/g, " ");
  title = title
    .replace(/\s+(?:for|to)\s+legal\b.*$/i, "")
    .replace(/\s*\((?:\d+|eng)\)\s*/gi, " ")
    .replace(/(?:\.LK\w*|\.SP\w*|\.JD\w*|\.LFK\w*)+/g, "")
    .replace(/\s+-\s+(?:copy|legal.*|tf|sp|ts edit)$/i, "")
    .replace(/\b(?:for legal|legal final|legalfinal|legal|final|copy)\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || fileName;
}

export const TIER_LABEL: Record<VaultTier, string> = { winning: "Winning", average: "Average", under: "Under performing", untested: "Untested" };

/** Promo Analyzer fields from where the file sat in the vault. */
export function promoFieldsFromVault(path: VaultPromoPath): {
  promoType: string | null;
  promoStatus: string;
  isBestPerformer: boolean;
  performanceScore: number | null;
  trainingNotes: string;
} {
  const promoType = path.funnel === "FE" ? "Front-end" : path.format === "VSL" ? "Backend VSL" : path.format ? "Backend Live Webinar" : null;
  const tier = path.tier;
  return {
    promoType,
    promoStatus: tier === "untested" ? "Draft (Untested)" : "Old (Inactive)",
    isBestPerformer: tier === "winning",
    performanceScore: tier === "winning" ? 9 : tier === "average" ? 6 : tier === "under" ? 3 : null,
    trainingNotes: [
      `Results from the team's promo library: ${tier ? TIER_LABEL[tier] : "not rated"}.`,
      `${path.code} ${path.funnel === "FE" ? "front-end" : "back-end"} ${path.format ?? "promo"}.`,
    ].join(" "),
  };
}

/** Publication code at the start of a file name ("WAR Evergreen Retail OF…" → "WAR"). */
export function codeFromFileName(fileName: string): string | null {
  return /^([A-Z]{2,5})\b/.exec(fileName)?.[1] ?? null;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Slide text from a .pptx (slides in order, one paragraph per line, speaker notes after each slide). */
export function pptxText(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(file.name) });
  } catch {
    return "";
  }
  const number = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  const textOf = (xml: string) =>
    xml
      .split(/<\/a:p>/)
      .map((paragraph) => [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlText(m[1] ?? "")).join(""))
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  const decoder = new TextDecoder();
  const slides = Object.keys(files)
    .filter((name) => name.startsWith("ppt/slides/"))
    .sort((a, b) => number(a) - number(b));
  return slides
    .map((name) => {
      const n = number(name);
      const body = textOf(decoder.decode(files[name]!));
      const notesXml = files[`ppt/notesSlides/notesSlide${n}.xml`];
      const notes = notesXml ? textOf(decoder.decode(notesXml)).replace(/^\d+$/gm, "").trim() : "";
      return [`[Slide ${n}]`, body, notes ? `Notes: ${notes}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .trim();
}
