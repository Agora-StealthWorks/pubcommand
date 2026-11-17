// Minimal types for the two untyped export libraries ChartBuilder uses.
declare module "svg-to-pdfkit" {
  type Options = {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    fontCallback?: (family: string, bold: boolean, italic: boolean, options: Record<string, unknown>) => string;
    imageCallback?: (href: string) => string;
  };
  export default function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x?: number, y?: number, options?: Options): void;
}

declare module "subset-font" {
  export default function subsetFont(font: Buffer | Uint8Array, text: string, options?: { targetFormat?: "sfnt" | "woff" | "woff2"; preserveNameIds?: number[] }): Promise<Buffer>;
}
