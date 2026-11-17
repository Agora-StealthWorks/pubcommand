import { Resvg } from "@resvg/resvg-js";
import { tenantDb } from "@pubcommand/db";
import { svgArtworkBackground, toneFromPixels, type LogoBackground } from "../../../../../modules/pubsetup/logos";

/**
 * Which background an uploaded logo is made for. resvg (already used by chart exports)
 * rasterizes SVG and decodes PNG, JPEG and GIF wrapped in an SVG <image>. WebP cannot be
 * decoded here (sharp is not a dependency), so it returns null and the caller files it
 * for light backgrounds. Never throws.
 */
export function classifyLogo(data: Uint8Array, mime: string): LogoBackground | null {
  const size = 96;
  try {
    let svg: string;
    if (mime === "image/svg+xml") {
      svg = Buffer.from(data).toString("utf8");
    } else if (/^image\/(png|jpeg|gif)$/.test(mime)) {
      const href = `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="${href}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></svg>`;
    } else {
      return null;
    }
    const rendered = new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: false } }).render();
    // Letterboxing adds transparent margins; only a tone over visible pixels counts.
    const tone = toneFromPixels(rendered.pixels, rendered.width, rendered.height, { premultiplied: true });
    if (tone.background) return tone.background;
    return mime === "image/svg+xml" ? svgArtworkBackground(svg) : null;
  } catch {
    if (mime === "image/svg+xml") return svgArtworkBackground(Buffer.from(data).toString("utf8"));
    return null;
  }
}

/**
 * Logos uploaded before there were two slots sit in logo_* with logo_sorted = false. Check
 * each once: a light (white) logo moves to the dark-background slot when that is empty.
 * Cheap when there is nothing to do (one indexed query); runs from the read API.
 */
export async function sortLegacyLogos(organizationId: string, brandId: string): Promise<void> {
  try {
    const db = tenantDb(organizationId);
    const [pubs, brand] = await Promise.all([
      db.calendarPublication.findMany({ where: { brandId, logoSorted: false, logoMime: { not: null } }, select: { id: true } }),
      db.pubBrandBranding.findFirst({ where: { brandId, logoSorted: false, logoMime: { not: null } }, select: { id: true } }),
    ]);
    for (const { id } of pubs) {
      const row = await db.calendarPublication.findFirst({ where: { id }, select: { logoData: true, logoMime: true, logoFilename: true, logoOnDarkMime: true } });
      if (!row?.logoData || !row.logoMime) continue;
      const move = !row.logoOnDarkMime && classifyLogo(row.logoData, row.logoMime) === "dark";
      await db.calendarPublication.updateMany({
        where: { id, logoSorted: false },
        data: move
          ? { logoOnDarkData: row.logoData, logoOnDarkMime: row.logoMime, logoOnDarkFilename: row.logoFilename, logoData: null, logoMime: null, logoFilename: null, logoSorted: true }
          : { logoSorted: true },
      });
    }
    if (brand) {
      const row = await db.pubBrandBranding.findFirst({ where: { id: brand.id }, select: { logoData: true, logoMime: true, logoFilename: true, logoOnDarkMime: true } });
      if (row?.logoData && row.logoMime) {
        const move = !row.logoOnDarkMime && classifyLogo(row.logoData, row.logoMime) === "dark";
        await db.pubBrandBranding.updateMany({
          where: { id: brand.id, logoSorted: false },
          data: move
            ? { logoOnDarkData: row.logoData, logoOnDarkMime: row.logoMime, logoOnDarkFilename: row.logoFilename, logoData: null, logoMime: null, logoFilename: null, logoSorted: true }
            : { logoSorted: true },
        });
      }
    }
  } catch (error) {
    console.error("[pubsetup] sorting legacy logos failed", error);
  }
}
