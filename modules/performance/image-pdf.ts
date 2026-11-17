/**
 * Wrap a screenshot (PNG or JPEG) in a one-page PDF, so the AI reads it through the same PDF input as every other
 * backup document. Pure, no dependencies beyond fflate.
 *
 * JPEG bytes are embedded as-is (DCTDecode). PNG is decoded (8/16-bit gray, RGB, gray+alpha, RGBA and palette;
 * not interlaced), flattened onto white and re-compressed (FlateDecode).
 */
import { unzlibSync, zlibSync } from "fflate";

export class ImageError extends Error {}

const enc = new TextEncoder();

type Raster = { width: number; height: number; filter: "DCTDecode" | "FlateDecode"; colorSpace: "DeviceRGB" | "DeviceGray" | "DeviceCMYK"; data: Uint8Array; invertCmyk?: boolean };

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** Width, height and component count from a JPEG's start-of-frame marker. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number; adobe: boolean } {
  let i = 2;
  let adobe = false;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
    if (marker === 0xee) adobe = true;
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = ((bytes[i + 5] as number) << 8) | (bytes[i + 6] as number);
      const width = ((bytes[i + 7] as number) << 8) | (bytes[i + 8] as number);
      const components = bytes[i + 9] as number;
      if (!width || !height) break;
      return { width, height, components, adobe };
    }
    i += 2 + length;
  }
  throw new ImageError("This JPEG could not be read.");
}

function u32(bytes: Uint8Array, at: number): number {
  return (((bytes[at] as number) << 24) >>> 0) + ((bytes[at + 1] as number) << 16) + ((bytes[at + 2] as number) << 8) + (bytes[at + 3] as number);
}

/** Decode a PNG to 8-bit RGB on white. */
export function decodePng(bytes: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  if (!isPng(bytes)) throw new ImageError("Not a PNG.");
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let alphaTable: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = u32(data, 0);
      height = u32(data, 4);
      depth = data[8] as number;
      colorType = data[9] as number;
      interlace = data[12] as number;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alphaTable = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!width || !height || width * height > 40_000_000) throw new ImageError("This PNG is empty or too large.");
  if (interlace) throw new ImageError("Interlaced PNGs are not supported. Save the screenshot again as a normal PNG or JPEG.");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || (colorType !== 3 && colorType !== 0 && depth < 8)) throw new ImageError("This PNG format is not supported.");
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of idat) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = unzlibSync(joined);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  if (raw.length < height * (stride + 1)) throw new ImageError("This PNG is truncated.");
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] as number;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? (row[x - bpp] as number) : 0;
      const b = prev ? (prev[x] as number) : 0;
      const c = prev && x >= bpp ? (prev[x - bpp] as number) : 0;
      let value = src[x] as number;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = value & 0xff;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  const sample = (row: Uint8Array, index: number): number => {
    if (depth === 8) return row[index] as number;
    if (depth === 16) return row[index * 2] as number;
    const perByte = 8 / depth;
    const byte = row[Math.floor(index / perByte)] as number;
    const shift = 8 - depth * ((index % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const maxSample = depth >= 8 ? 255 : (1 << depth) - 1;
  for (let y = 0; y < height; y += 1) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x += 1) {
      let r: number;
      let g: number;
      let b: number;
      let alpha = 255;
      if (colorType === 3) {
        const index = sample(row, x);
        r = palette?.[index * 3] ?? 0;
        g = palette?.[index * 3 + 1] ?? 0;
        b = palette?.[index * 3 + 2] ?? 0;
        alpha = alphaTable && index < alphaTable.length ? (alphaTable[index] as number) : 255;
      } else if (colorType === 0 || colorType === 4) {
        const gray = Math.round((sample(row, x * channels) * 255) / maxSample);
        r = g = b = gray;
        if (colorType === 4) alpha = sample(row, x * channels + 1);
      } else {
        r = sample(row, x * channels);
        g = sample(row, x * channels + 1);
        b = sample(row, x * channels + 2);
        if (colorType === 6) alpha = sample(row, x * channels + 3);
      }
      const k = alpha / 255;
      const o = (y * width + x) * 3;
      rgb[o] = Math.round(r * k + 255 * (1 - k));
      rgb[o + 1] = Math.round(g * k + 255 * (1 - k));
      rgb[o + 2] = Math.round(b * k + 255 * (1 - k));
    }
  }
  return { width, height, rgb };
}

function raster(bytes: Uint8Array): Raster {
  if (isJpeg(bytes)) {
    const info = jpegInfo(bytes);
    const colorSpace = info.components === 1 ? "DeviceGray" : info.components === 4 ? "DeviceCMYK" : "DeviceRGB";
    return { width: info.width, height: info.height, filter: "DCTDecode", colorSpace, data: bytes, invertCmyk: info.components === 4 && info.adobe };
  }
  if (isPng(bytes)) {
    const png = decodePng(bytes);
    return { width: png.width, height: png.height, filter: "FlateDecode", colorSpace: "DeviceRGB", data: zlibSync(png.rgb, { level: 6 }) };
  }
  throw new ImageError("Only PNG and JPEG screenshots can be read.");
}

/** A one-page PDF showing the image, page size = image size in points (long side capped at 1600pt). */
export function imageToPdf(bytes: Uint8Array): Uint8Array {
  const image = raster(bytes);
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
  const decode = image.invertCmyk ? " /Decode [1 0 1 0 1 0 1 0]" : "";
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const data = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(data);
    length += data.length;
  };
  const object = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}`);
    if (stream) {
      push("\nstream\n");
      push(stream);
      push("\nendstream");
    }
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter}${decode} /Length ${image.data.length} >>`, image.data);
  object(5, `<< /Length ${content.length} >>`, content);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
