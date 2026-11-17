import { zipSync } from "fflate";
import { renderChartSvg } from "../../../../../modules/charts/render";
import { normalizeSpec } from "../../../../../modules/charts/spec";
import { EXPORT_FORMATS, MAX_EXPORT_PIXELS, MIME, embedSvgFonts, svgToJpeg, svgToPdf, svgToPng, type ExportFormat } from "./export";
import { todayIso, unpackBars, unpackCompare } from "./market";
import { assetDataUris } from "./server";

type ChartRow = { id: string; name: string; symbol: string; spec: unknown; bars: unknown; source: string; seriesName: string; unit: string; compareBars?: unknown };

export type RenderOptions = {
  /** PNG/JPG resolution multiplier, 1-4. */
  scale?: number;
  /** SVG only: embed subset fonts so the file looks right without Inter installed. */
  embedFonts?: boolean;
};

export function parseFormat(value: string | null): ExportFormat | "thumb" | null {
  if (value === "thumb") return "thumb";
  return (EXPORT_FORMATS as readonly string[]).includes(value ?? "") ? (value as ExportFormat) : null;
}

export function fileBase(name: string, symbol: string): string {
  return (name || symbol).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "chart";
}

/** The SVG of a stored chart: its saved spec, bars and compare lines through the same renderer the editor uses. */
export async function storedSvgs(organizationId: string, rows: ChartRow[]) {
  const specs = rows.map((row) => normalizeSpec(row.spec, todayIso()));
  const imageHref = await assetDataUris(organizationId, specs);
  return rows.map((row, index) => {
    const spec = specs[index]!;
    const compare = unpackCompare(row.compareBars);
    const svg = renderChartSvg({ spec, bars: unpackBars(row.bars), compare, meta: { ticker: row.symbol, name: row.seriesName, source: row.source, unit: row.unit }, imageHref, idPrefix: `x${index}` });
    return { row, spec, svg };
  });
}

/** Render stored charts to files. Every format is drawn from the same SVG. */
export async function renderStored(organizationId: string, rows: ChartRow[], format: ExportFormat | "thumb", options: RenderOptions = {}) {
  const scale = Math.min(4, Math.max(1, Math.round(options.scale ?? 1)));
  const drawn = await storedSvgs(organizationId, rows);
  return Promise.all(
    drawn.map(async ({ row, spec, svg }) => {
      const base = `${fileBase(row.name, row.symbol)}-${spec.size.w}x${spec.size.h}`;
      const pixels = spec.size.w * spec.size.h * scale * scale;
      const safeScale = pixels > MAX_EXPORT_PIXELS ? Math.sqrt(MAX_EXPORT_PIXELS / (spec.size.w * spec.size.h)) : scale;
      if (format === "thumb") return { body: svgToPng(svg, spec.size.w, 560 / spec.size.w).png, mime: "image/png", filename: `${base}.png` };
      if (format === "svg") return { body: Buffer.from(options.embedFonts ? await embedSvgFonts(svg) : svg), mime: MIME.svg, filename: `${base}${options.embedFonts ? "-fonts" : ""}.svg` };
      if (format === "jpg") return { body: svgToJpeg(svg, spec.size.w, safeScale), mime: MIME.jpg, filename: `${base}.jpg` };
      if (format === "pdf" || format === "ai") {
        const body = await svgToPdf(svg, spec.size.w, spec.size.h, { title: row.name || row.symbol, ai: format === "ai" });
        return { body, mime: MIME[format], filename: `${base}.${format}` };
      }
      return { body: svgToPng(svg, spec.size.w, safeScale).png, mime: MIME.png, filename: `${base}.png` };
    }),
  );
}

export function zipFiles(files: Array<{ body: Buffer; filename: string; mime: string }>): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const used = new Map<string, number>();
  for (const file of files) {
    const count = used.get(file.filename) ?? 0;
    used.set(file.filename, count + 1);
    const name = count ? file.filename.replace(/(\.\w+)$/, `-${count + 1}$1`) : file.filename;
    // PNG/JPG are already compressed; store them. Deflate the vector formats.
    entries[name] = [new Uint8Array(file.body), { level: /\.(png|jpg)$/.test(name) ? 0 : 6 }];
  }
  return zipSync(entries);
}

export function download(body: Uint8Array | Buffer, mime: string, filename: string, inline = false): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...(mime === MIME.svg ? { "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'" } : {}),
    },
  });
}
