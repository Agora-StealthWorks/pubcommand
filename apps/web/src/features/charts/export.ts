import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";


/** The bundled Inter files (modules/charts/fonts). The same files back the browser preview. */
export const FONT_FILES: Record<string, string> = {
  "400": "Inter-Regular.otf",
  "600": "Inter-SemiBold.otf",
  "700": "Inter-Bold.otf",
  "800": "Inter-ExtraBold.otf",
};

let fontDir: string | null = null;
export function fontDirectory(): string {
  if (fontDir) return fontDir;
  const candidates = [
    path.join(process.cwd(), "modules/charts/fonts"),
    path.join(process.cwd(), "../../modules/charts/fonts"),
    path.join(process.cwd(), "../modules/charts/fonts"),
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, FONT_FILES["400"] as string)));
  if (!found) throw new Error("ChartBuilder fonts are missing (modules/charts/fonts).");
  fontDir = found;
  return found;
}

export function fontFile(name: string): Buffer | null {
  if (!Object.values(FONT_FILES).includes(name)) return null;
  return readFileSync(path.join(fontDirectory(), name));
}

export const MAX_EXPORT_PIXELS = 4000 * 4000 * 2;

/** SVG → PNG at `scale`, with only the bundled fonts so every server renders identically. */
export function svgToPng(svg: string, width: number, scale = 1): { png: Buffer; pixels: Buffer; width: number; height: number } {
  const target = Math.round(width * scale);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: target },
    font: {
      fontFiles: Object.values(FONT_FILES).map((file) => path.join(fontDirectory(), file)),
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
    background: "#ffffff",
  });
  const image = resvg.render();
  return { png: image.asPng(), pixels: image.pixels, width: image.width, height: image.height };
}

export function svgToJpeg(svg: string, width: number, scale = 1, quality = 92): Buffer {
  const { pixels, width: w, height: h } = svgToPng(svg, width, scale);
  return jpeg.encode({ data: pixels, width: w, height: h }, quality).data;
}

/** The bundled Inter file for a weight (400/600/700/800), nearest available. */
function fontPathFor(weight: string): string {
  const file = FONT_FILES[weight] ?? FONT_FILES["400"];
  return path.join(fontDirectory(), file as string);
}

/**
 * Our renderer writes `font-family="Inter, …" font-size="…" font-weight="W"` on every text. PDF fonts are
 * picked per family, so give each weight its own family name ("Inter-700") for the font callback.
 */
export function pdfFontFamilies(svg: string): string {
  return svg.replace(/font-family="[^"]*" font-size="([^"]+)" font-weight="(\d+)"/g, (_m, size: string, weight: string) => `font-family="Inter-${weight}" font-size="${size}" font-weight="${weight}"`);
}

/**
 * A vector PDF of the chart from the same SVG: paths stay paths, text stays live text in the bundled Inter
 * (pdfkit embeds only the glyphs used). Page size is the chart in points (1px = 0.75pt). `ai` writes the
 * same file with Illustrator in mind: Illustrator opens PDF-compatible .ai files natively.
 */
export async function svgToPdf(svg: string, width: number, height: number, options: { title?: string; ai?: boolean } = {}): Promise<Buffer> {
  const [{ default: PDFDocument }, { default: SVGtoPDF }] = await Promise.all([import("pdfkit"), import("svg-to-pdfkit")]);
  const pageW = width * 0.75;
  const pageH = height * 0.75;
  const doc = new PDFDocument({
    size: [pageW, pageH],
    margin: 0,
    autoFirstPage: true,
    pdfVersion: "1.5",
    info: { Title: options.title ?? "Chart", Creator: "PubCommand ChartBuilder", Producer: "PubCommand ChartBuilder" },
  });
  for (const weight of Object.keys(FONT_FILES)) doc.registerFont(`Inter-${weight}`, fontPathFor(weight));
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  SVGtoPDF(doc, pdfFontFamilies(svg), 0, 0, {
    width: pageW,
    height: pageH,
    preserveAspectRatio: "xMidYMid meet",
    fontCallback: (family: string) => {
      const match = /Inter-(\d+)/.exec(family);
      return match && FONT_FILES[match[1] as string] ? `Inter-${match[1]}` : "Inter-400";
    },
  });
  doc.end();
  return done;
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** The characters each font weight draws in the SVG, for subsetting. */
export function glyphsByWeight(svg: string): Map<string, string> {
  const out = new Map<string, Set<string>>();
  for (const match of svg.matchAll(/<text\b[^>]*font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)) {
    const weight = match[1] as string;
    const text = (match[2] as string).replace(/&(amp|lt|gt|quot|#39);/g, (entity) => XML_ENTITIES[entity] ?? entity);
    const set = out.get(weight) ?? new Set<string>();
    for (const char of text) set.add(char);
    out.set(weight, set);
  }
  return new Map([...out].map(([weight, set]) => [weight, [...set].join("")]));
}

/**
 * The SVG with its fonts inside: one @font-face per weight used, subset to the glyphs drawn (WOFF2,
 * data: URI), so the file looks the same on a machine without Inter. Falls back to the plain SVG.
 */
export async function embedSvgFonts(svg: string): Promise<string> {
  const glyphs = glyphsByWeight(svg);
  if (!glyphs.size) return svg;
  try {
    const { default: subsetFont } = await import("subset-font");
    const faces: string[] = [];
    for (const [weight, text] of glyphs) {
      const font = await subsetFont(readFileSync(fontPathFor(weight)), `${text} `, { targetFormat: "woff2" });
      faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${Buffer.from(font).toString("base64")}) format("woff2")}`);
    }
    const style = `<style>${faces.join("")}</style>`;
    return svg.includes("<defs>") ? svg.replace("<defs>", `<defs>${style}`) : svg.replace(/(<svg\b[^>]*>)/, `$1<defs>${style}</defs>`);
  } catch (error) {
    console.error("[charts] font embedding failed", error);
    return svg;
  }
}

/** Width/height of a PNG or JPEG, or null if it is neither. */
export function imageSize(data: Uint8Array): { width: number; height: number; mime: "image/png" | "image/jpeg" } | null {
  const b = Buffer.from(data);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR") {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), mime: "image/png" };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) return null;
      const marker = b[offset + 1] as number;
      const size = b.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7), mime: "image/jpeg" };
      }
      offset += 2 + size;
    }
  }
  return null;
}

export const EXPORT_FORMATS = ["png", "jpg", "svg", "pdf", "ai"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  // An Illustrator-compatible PDF; browsers and Illustrator both read it as PDF.
  ai: "application/pdf",
};
