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

/**
 * A one-page PDF holding the chart as a high-resolution JPEG (DCTDecode), sized in points to the
 * chart's aspect. Raster, not vector: good for print proofs and email; designers wanting live vectors
 * use the SVG.
 */
export function svgToPdf(svg: string, width: number, height: number): Buffer {
  const scale = Math.min(2, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)));
  const { pixels, width: w, height: h } = svgToPng(svg, width, scale);
  const jpg = jpeg.encode({ data: pixels, width: w, height: h }, 94).data;
  const pageW = 792;
  const pageH = Math.round((pageW * height) / width);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`),
      jpg,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
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

export const EXPORT_FORMATS = ["png", "jpg", "svg", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};
