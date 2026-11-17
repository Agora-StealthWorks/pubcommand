import { zipSync } from "fflate";
import { renderChartSvg } from "../../../../../modules/charts/render";
import { normalizeSpec } from "../../../../../modules/charts/spec";
import { EXPORT_FORMATS, MIME, svgToJpeg, svgToPdf, svgToPng, type ExportFormat } from "./export";
import { todayIso, unpackBars } from "./market";
import { assetDataUris } from "./server";

type ChartRow = { id: string; name: string; symbol: string; spec: unknown; bars: unknown; source: string; seriesName: string; unit: string };

export function parseFormat(value: string | null): ExportFormat | "thumb" | null {
  if (value === "thumb") return "thumb";
  return (EXPORT_FORMATS as readonly string[]).includes(value ?? "") ? (value as ExportFormat) : null;
}

export function fileBase(name: string, symbol: string): string {
  return (name || symbol).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "chart";
}

/** Render a stored chart from its saved spec and bars: the same function the editor previews with. */
export async function renderStored(organizationId: string, rows: ChartRow[], format: ExportFormat | "thumb") {
  const specs = rows.map((row) => normalizeSpec(row.spec, todayIso()));
  const imageHref = await assetDataUris(organizationId, specs);
  return rows.map((row, index) => {
    const spec = specs[index]!;
    const svg = renderChartSvg({ spec, bars: unpackBars(row.bars), meta: { ticker: row.symbol, name: row.seriesName, source: row.source, unit: row.unit }, imageHref, idPrefix: `x${index}` });
    const base = `${fileBase(row.name, row.symbol)}-${spec.size.w}x${spec.size.h}`;
    if (format === "thumb") return { body: svgToPng(svg, spec.size.w, 560 / spec.size.w).png, mime: "image/png", filename: `${base}.png` };
    if (format === "svg") return { body: Buffer.from(svg), mime: MIME.svg, filename: `${base}.svg` };
    if (format === "jpg") return { body: svgToJpeg(svg, spec.size.w), mime: MIME.jpg, filename: `${base}.jpg` };
    if (format === "pdf") return { body: svgToPdf(svg, spec.size.w, spec.size.h), mime: MIME.pdf, filename: `${base}.pdf` };
    return { body: svgToPng(svg, spec.size.w).png, mime: MIME.png, filename: `${base}.png` };
  });
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
