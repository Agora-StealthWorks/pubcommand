import { Resvg } from "@resvg/resvg-js";
import { tenantDb } from "@pubcommand/db";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PDF_TYPE = "application/pdf";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type StoredAsset = { id: string; mimeType: string };

/**
 * SVG is never stored or served as SVG (it can carry script on our host).
 * It is rasterized to a PNG instead: logos stay sharp at `height` px tall (≈3× the header).
 */
function rasterizeSvg(data: Uint8Array, height: number): Uint8Array<ArrayBuffer> | null {
  try {
    const rendered = new Resvg(Buffer.from(data).toString("utf8"), { fitTo: { mode: "height", value: height }, font: { loadSystemFonts: false } }).render();
    return new Uint8Array(rendered.asPng()) as Uint8Array<ArrayBuffer>;
  } catch {
    return null;
  }
}

/** Store an uploaded file in the site's media library. Images (SVG becomes PNG) and, when allowed, PDFs. */
export async function storeAsset(
  organizationId: string,
  siteId: string,
  file: FormDataEntryValue | null,
  options: { actorId?: string | null; alt?: string; allowPdf?: boolean; svgHeight?: number } = {},
): Promise<StoredAsset | { error: string } | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  let mimeType = file.type;
  let filename = file.name.slice(0, 200) || "file";
  let data: Uint8Array<ArrayBuffer> = new Uint8Array(await file.arrayBuffer());
  if (mimeType === "image/svg+xml" || /\.svg$/i.test(filename)) {
    if (file.size > MAX_IMAGE_BYTES) return { error: "Images must be 5 MB or smaller." };
    const png = rasterizeSvg(data, options.svgHeight ?? 360);
    if (!png) return { error: "That SVG could not be read. Try a PNG instead." };
    data = png;
    mimeType = "image/png";
    filename = filename.replace(/\.svg$/i, "") + ".png";
  } else if (mimeType === PDF_TYPE) {
    if (!options.allowPdf) return { error: "Choose an image (PNG, JPG, WebP, GIF or SVG)." };
    if (file.size > MAX_PDF_BYTES) return { error: "PDFs must be 20 MB or smaller." };
  } else if (!IMAGE_TYPES.has(mimeType)) {
    return { error: options.allowPdf ? "Upload an image (PNG, JPG, WebP, GIF, SVG) or a PDF." : "Choose an image (PNG, JPG, WebP, GIF or SVG)." };
  } else if (file.size > MAX_IMAGE_BYTES) {
    return { error: "Images must be 5 MB or smaller." };
  }
  return tenantDb(organizationId).webAsset.create({
    data: { organizationId, siteId, filename, mimeType, size: data.byteLength, data, alt: (options.alt ?? "").slice(0, 300), createdById: options.actorId ?? null },
    select: { id: true, mimeType: true },
  });
}
